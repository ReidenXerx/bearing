#!/usr/bin/env node
/**
 * gitnexus-agent-kit — install / update / uninstall core (vendor-agnostic).
 *
 * This module knows nothing about any specific IDE. Per-IDE wiring lives in
 * lib/adapters/* and is driven through the Adapter contract; this core just
 * resolves the active adapters for a runtime and loops over them.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  isTextCandidate,
  substituteRepoName,
  shouldCopyBundleFile,
} from "./kit-shared.mjs";
import {
  KIT_NAME,
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  GITIGNORE_MARKER,
  GITIGNORE_MARKERS_LEGACY,
  parseRuntime,
} from "./constants.mjs";
import { parseFeatures, FEATURE_IDS, featureOf } from "./features.mjs";
import { activeAdapters, skillLinkDirs } from "./adapters/index.mjs";
import { readJsonSafe } from "./adapters/json-util.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";
import {
  materializeSkillsStore,
  linkSkillsForRuntime,
  unlinkSkillLinks,
} from "./skills.mjs";
import {
  flatGitnexusScripts,
  allManagedScriptKeys,
  mergeIntoPackageJson,
} from "../bundle/scripts/bearing-teaching/script-gates.mjs";
import {
  banner,
  step,
  ok,
  warn,
  nextSteps,
  summaryTable,
} from "../bundle/scripts/lib/setup-ui.mjs";

export {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  substituteRepoName,
  isTextCandidate,
};

export const GITNEXUS_NPM_SCRIPTS = flatGitnexusScripts();

export { GITIGNORE_MARKER };

/** Shared (vendor-neutral) ignore entries; adapters contribute IDE-specific lines. */
const GITIGNORE_BASE = [
  // The graph index is machine-specific (absolute repoPath baked in) + large →
  // regenerated per-machine via agent-refresh. Covers the manifest too.
  ".gitnexus/",
  ".tmp-agent/",
  // .bearing/ holds the TRACKED kit payload (hook lib, policy config, skill store —
  // teammates get these via git). Only per-session runtime state, the derived API
  // profile, and the per-machine config override are ignored; the IDE skill symlink
  // dirs are ignored + regenerated.
  ".bearing/.gitnexus-*",
  ".bearing/gitnexus-api-profile.json",
  // Per-machine hook-config override (e.g. contextWindowTokens for a 1M session) — wins
  // over the team-shared gitnexus-hooks.json; kept local so it doesn't affect teammates.
  ".bearing/hooks.local.json",
  // Derived architecture doc — regenerated from live graph stats on every refresh
  // (machine-specific), so it churns git for every teammate. Kept local.
  "docs/ARCHITECTURE.gitnexus.md",
];

/** @param {import('./constants.mjs').Runtime} runtime */
function buildGitignoreSnippet(runtime) {
  const lines = [...GITIGNORE_BASE];
  for (const a of activeAdapters(runtime)) lines.push(...a.gitignoreLines);
  return `\n${GITIGNORE_MARKER} (safe to remove via bearing-uninstall)\n${lines.join("\n")}\n`;
}

/** @returns {string[]} */
export function listBundleFiles() {
  const files = [];
  function walk(dir, prefix = "") {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else files.push(rel);
    }
  }
  walk(BUNDLE_ROOT);
  return files.sort();
}

/** @param {string} targetRoot */
export function assertGitRepo(targetRoot) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: targetRoot,
    encoding: "utf8",
  });
  if (r.status !== 0 || r.stdout.trim() !== "true") {
    throw new Error(`Not a git repository: ${targetRoot}`);
  }
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} repoName
 */
function copyBundleFile(src, dest, repoName) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isTextCandidate(src)) {
    fs.writeFileSync(
      dest,
      substituteRepoName(fs.readFileSync(src, "utf8"), repoName),
    );
  } else {
    fs.copyFileSync(src, dest);
  }
}

/** @param {string} targetRoot */
function backupIfExists(targetRoot, rel, backupRel) {
  const src = path.join(targetRoot, rel);
  const bak = path.join(targetRoot, backupRel);
  if (!fs.existsSync(src)) return null;
  // Take the backup ONCE. On an update the source is already the kit's own file, so re-copying it
  // overwrites the user's pristine original with kit content — and uninstall then "restores" that,
  // leaving the repo wired to a kit it just removed.
  if (fs.existsSync(bak)) return backupRel;
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(src, bak);
  return backupRel;
}

/** @param {string} targetRoot @param {string} [repoName] */
export function mergePackageScripts(targetRoot, repoName) {
  const name = repoName ?? path.basename(targetRoot);
  return mergeIntoPackageJson(path.join(targetRoot, "package.json"), {
    createIfMissing: true,
    repoName: name,
  });
}

/** @param {string} targetRoot @param {import('./constants.mjs').Runtime} runtime */
export function appendGitignore(targetRoot, runtime = "both") {
  const gi = path.join(targetRoot, ".gitignore");
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const block = buildGitignoreSnippet(parseRuntime(runtime)).trim();
  // Refresh the managed block on every install/update so upgrades pick up ignore
  // rules added in newer versions (e.g. .agents/skills, .gitnexus/, the tracked
  // store) instead of leaving an older install's stale block untouched.
  const base = stripManagedGitignoreBlock(existing).replace(/\n+$/, "");
  // Terminate the block with a sentinel so a rule appended later with `>>` lands OUTSIDE it.
  // Without this the block is "marker + every contiguous non-blank line", so `echo 'secrets/' >>
  // .gitignore` was absorbed and silently deleted on the next update — turning an ignored
  // directory into a tracked one.
  const next = base ? `${base}\n\n${block}\n${GITIGNORE_END}` : `${block}\n${GITIGNORE_END}`;
  fs.writeFileSync(gi, next);
  return block.split("\n").filter((l) => l && !l.startsWith("#"));
}

/**
 * Remove the managed block (marker comment + its contiguous non-blank lines),
 * absorbing one surrounding blank line so we don't leave doubled blanks.
 * @param {string} text @returns {string}
 */
const GITIGNORE_END = "# --- end bearing ---\n";

function stripManagedGitignoreBlock(text) {
  // Match the current marker OR any historical one, so a rename does not orphan the block a
  // previous version wrote (which would leave two managed blocks side by side).
  const markers = [GITIGNORE_MARKER, ...GITIGNORE_MARKERS_LEGACY];
  const hit = markers.find((m) => text.includes(m));
  if (!hit) return text;
  const lines = text.split("\n");
  let start = lines.findIndex((l) => l.includes(hit));
  if (start === -1) return text;
  let end = start;
  while (end < lines.length && lines[end].trim() !== "") {
    const isSentinel = lines[end].trim() === GITIGNORE_END.trim();
    end++;
    if (isSentinel) break; // block ends here; anything after is the user's
  }
  if (start > 0 && lines[start - 1].trim() === "") start--;
  if (end < lines.length && lines[end].trim() === "") end++;
  lines.splice(start, end - start);
  return lines.join("\n");
}

/** @param {string} targetRoot */
export function removeGitignoreSnippet(targetRoot) {
  const gi = path.join(targetRoot, ".gitignore");
  if (!fs.existsSync(gi)) return;
  const stripped = stripManagedGitignoreBlock(fs.readFileSync(gi, "utf8"));
  fs.writeFileSync(gi, stripped.replace(/\n+$/, "\n"));
}

/** @param {string} targetRoot @param {string[]} [keys] Keys to remove (defaults to all managed). */
export function removePackageScripts(targetRoot, keys) {
  const pkgPath = path.join(targetRoot, "package.json");
  const pkg = readJsonSafe(pkgPath, null);
  if (!pkg?.scripts) return;
  for (const key of keys ?? allManagedScriptKeys()) {
    delete pkg.scripts[key];
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** @param {string} absTarget */
export function readManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, MANIFEST_PATH_LEGACY]) {
    const p = path.join(absTarget, rel);
    if (fs.existsSync(p)) {
      const m = readJsonSafe(p, null);
      if (!m) continue;
      if (!m.runtime) m.runtime = "both";
      return { path: rel, data: m };
    }
  }
  return null;
}

/**
 * @param {string} targetRoot
 * @param {{ repoName?: string, quick?: boolean, runSetup?: boolean, runtime?: import('./constants.mjs').Runtime, update?: boolean, skipVerify?: boolean }} opts
 */
export function installKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const mode = opts.update ? "update" : "install";

  banner(`${KIT_NAME} ${mode}`, absTarget);

  step(1, 7, "Validate target repository");
  assertGitRepo(absTarget);
  ok("Git worktree OK");

  const inferredRuntime = parseRuntime(
    opts.runtime ?? readManifest(absTarget)?.data.runtime ?? "both",
  );
  // FEATURE axis (see lib/features.mjs). Inherit the prior selection on update; default to all so
  // an install that never mentions features behaves exactly as before.
  const features = parseFeatures(
    opts.features ?? readManifest(absTarget)?.data.features?.join(",") ?? "all",
  );

  step(2, 7, "Migrate legacy install (if any)");
  const migration = migrateLegacyInstall(absTarget, inferredRuntime);
  if (migration.actions.length) {
    for (const a of migration.actions.slice(0, 8)) ok(a);
    for (const f of migration.failures ?? []) warn(f);
    if (migration.actions.length > 8) {
      ok(`… and ${migration.actions.length - 8} more cleanup steps`);
    }
  } else {
    ok("No legacy artifacts — clean install path");
  }

  const runtime = migration.runtime;
  const adapters = activeAdapters(runtime);
  const repoName =
    opts.repoName ??
    migration.legacyManifest?.repoName ??
    readManifest(absTarget)?.data.repoName ??
    path.basename(absTarget);
  const kitPkg = JSON.parse(
    fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8"),
  );

  step(
    3,
    7,
    `Copy bundle (runtime: ${runtime}${features.size < FEATURE_IDS.length ? `, features: ${[...features].join("+")}` : ""})`,
  );
  const backups = {};
  for (const adapter of adapters) {
    for (const b of adapter.backups) {
      const made = backupIfExists(absTarget, b.rel, b.bak);
      if (made) backups[path.basename(b.rel)] = made;
    }
  }

  const files = [];
  // Files the kit installed last time are ours to replace. Anything else that already exists is
  // the USER'S — .vscode/settings.json and .githooks/pre-commit are ordinary user-owned paths that
  // collide with bundle paths, and copyBundleFile writes unconditionally. Without this, install
  // silently replaced a repo's commit gate and editor config, and uninstall then deleted them.
  const previouslyOurs = new Set(readManifest(absTarget)?.data.files ?? []);
  const preserved = [];
  for (const rel of listBundleFiles()) {
    if (!shouldCopyBundleFile(rel, runtime, features, (r) => fs.existsSync(path.join(absTarget, r)))) continue;
    const dest = path.join(absTarget, rel);
    if (fs.existsSync(dest) && !previouslyOurs.has(rel)) {
      const bak = `${dest}.bearing-backup`;
      if (!fs.existsSync(bak)) {
        try {
          fs.copyFileSync(dest, bak);
          preserved.push(`${rel} → ${rel}.bearing-backup`);
        } catch {
          /* best effort — never block the install on a backup */
        }
      }
    }
    copyBundleFile(
      path.join(BUNDLE_ROOT, rel),
      path.join(absTarget, rel),
      repoName,
    );
    files.push(rel);
  }
  ok(`${files.length} bundle files → ${repoName}`);
  for (const p of preserved) ok(`kept your existing file: ${p}`);

  step(4, 7, "Install skills (canonical store + symlinks)");
  // Skills are materialized by their own step, so it must apply the SAME feature filter as the
  // bundle copy — otherwise an intel-only install still gets all 18 graph task-skills.
  const skillNames = materializeSkillsStore(absTarget, repoName, (name) => {
    const owner = featureOf(`skills/${name}/SKILL.md`);
    return !owner || features.has(owner);
  });
  linkSkillsForRuntime(absTarget, runtime);
  ok(
    `${skillNames.length} skills → .bearing/skills/ (+ IDE symlinks)`,
  );

  step(5, 7, "Wire MCP, npm gates, IDE config");
  let manifestFlags = {};
  for (const adapter of adapters) {
    adapter.wire(absTarget, { repoName, features });
    manifestFlags = { ...manifestFlags, ...adapter.manifestFlags() };
    ok(`${adapter.id}: wired`);
  }
  // Every bearing:* script runs `node scripts/bearing-*.mjs`, and scripts/ is gitnexus-owned. Adding
  // them to an intel-only install produces dozens of commands that all fail with "no such file" —
  // and the installer's own Next steps tell the user to run two of them.
  const wantsScripts = features.has("gitnexus");
  const scriptStats = wantsScripts
    ? mergePackageScripts(absTarget, repoName)
    : { added: 0, updated: 0, total: 0 };
  appendGitignore(absTarget, runtime);
  ok(
    wantsScripts
      ? `package.json: ${scriptStats.added} added, ${scriptStats.updated} updated (${scriptStats.total} entries)`
      : "npm scripts skipped (gitnexus module not selected)",
  );

  step(6, 7, "Write manifest & chmod hooks");
  // Only claim ownership of scripts we actually wrote, or uninstall reports removing what it never added.
  const npmScripts = wantsScripts ? allManagedScriptKeys() : [];
  const manifest = {
    kit: KIT_NAME,
    kitVersion: kitPkg.version,
    installedAt: new Date().toISOString(),
    repoName,
    runtime,
    features: [...features],
    files,
    skills: skillNames,
    npmScripts,
    gitignoreMarker: GITIGNORE_MARKER,
    backups,
    ...manifestFlags,
  };

  try {
    fs.unlinkSync(path.join(absTarget, MANIFEST_PATH_LEGACY));
  } catch {
    /* migrate away from legacy path */
  }

  const manifestPath = path.join(absTarget, MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  chmodScripts(absTarget);
  ok(`Manifest v${kitPkg.version} (${runtime})`);

  if (opts.runSetup !== false) {
    step(7, 7, "Run gitnexus-setup.sh (index + sync)");
    const setupFlags = ["--skip-global-mcp", "--runtime", runtime];
    if (opts.quick) setupFlags.push("--quick");
    // The setup script belongs to the gitnexus module (featureOf claims all of scripts/), so it is
    // not copied for an intel-only install. Running it anyway is a guaranteed ENOENT that aborts
    // AFTER the manifest is written, leaving a half-installed repo.
    if (!features.has("gitnexus")) {
      ok("setup skipped (gitnexus module not selected)");
    } else {
    const r = spawnSync("bash", ["scripts/bearing-setup.sh", ...setupFlags], {
      cwd: absTarget,
      stdio: "inherit",
      env: {
        ...process.env,
        GITNEXUS_REPO_NAME: repoName,
        GITNEXUS_RUNTIME: runtime,
      },
    });
    if (r.status !== 0) {
      throw new Error(`bearing-setup.sh failed with exit ${r.status}`);
    }
    }
  } else {
    step(7, 7, "Skip setup (--no-setup)");
    warn("Run npm run bearing:setup in the target repo");
  }

  if (opts.runSetup !== false && !opts.skipVerify) {
    runVerify(absTarget);
  }

  printInstallComplete(absTarget, repoName, mode, runtime, {
    quick: opts.quick,
    setupSkipped: opts.runSetup === false,
    features,
  });
  return manifest;
}

/** @param {string} absTarget */
function runVerify(absTarget) {
  console.log("");
  const verifyScript = path.join(absTarget, "scripts/bearing-verify.mjs");
  const fallback = path.join(absTarget, ".bearing/lib/verify-kit.mjs");
  const script = fs.existsSync(verifyScript) ? verifyScript : fallback;
  if (!fs.existsSync(script)) return;
  const r = spawnSync(process.execPath, [script, absTarget], {
    cwd: absTarget,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    warn(
      "Verification reported issues — run npm run bearing:verify after fixing",
    );
  }
}

/** @param {string} absTarget @param {string} repoName @param {string} mode @param {import('./constants.mjs').Runtime} runtime @param {{ quick?: boolean, setupSkipped?: boolean, features?: Set<string>|null }} indexState */
function printInstallComplete(
  absTarget,
  repoName,
  mode,
  runtime,
  indexState = {},
) {
  const indexValue = indexState.setupSkipped
    ? "not changed (--no-setup)"
    : indexState.quick
      ? "skipped (--quick)"
      : "built";
  const indexStatus =
    indexState.setupSkipped || indexState.quick ? "warn" : "ok";
  summaryTable({
    title: `${mode === "update" ? "Update" : "Install"} complete`,
    rows: [
      { label: "Repository", value: repoName, status: "ok" },
      { label: "Runtime", value: runtime, status: "ok" },
      { label: "Path", value: absTarget, status: "info" },
      { label: "Index", value: indexValue, status: indexStatus },
    ],
  });

  const pre = [];
  const post = [];
  for (const adapter of activeAdapters(runtime)) {
    const ns = adapter.nextSteps({ repoName, features: indexState.features });
    pre.push(...(ns.pre ?? []));
    post.push(...(ns.post ?? []));
  }
  // These npm scripts are installed by the gitnexus module. Listing them in a repo that declined
  // it is a first-run instruction that fails — the worst possible moment for it (NS-5).
  const hasScripts = !indexState.features || indexState.features.has("gitnexus");
  nextSteps([
    ...pre,
    ...(hasScripts
      ? [
          "npm run bearing:verify — full kit check",
          "npm run bearing:health — human-friendly status",
        ]
      : []),
    ...post,
    ...(hasScripts
      ? ["npm run bearing.__gate.1.session — agent gate docs in package.json"]
      : ["Read CLAUDE.md / AGENTS.md — the contract your agent now follows"]),
  ]);
}

/** @param {string} targetRoot */
function chmodScripts(targetRoot) {
  function chmodSh(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) chmodSh(abs);
      else if (ent.name.endsWith(".sh")) {
        try {
          fs.chmodSync(abs, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
  for (const dir of ["scripts", ".cursor/hooks", ".githooks"]) {
    chmodSh(path.join(targetRoot, dir));
  }
}

/** @param {string} targetRoot */
export function updateKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const prev = readManifest(absTarget);
  if (!prev) {
    throw new Error(
      `Not installed (missing ${MANIFEST_PATH}). Run install first.`,
    );
  }
  return installKit(absTarget, {
    repoName: opts.repoName ?? prev.data.repoName,
    runtime: opts.runtime ?? prev.data.runtime,
    // Was omitted, so `bearing update --features …` silently kept the old set.
    features: opts.features ?? prev.data.features?.join(","),
    quick: opts.quick ?? true,
    runSetup: opts.runSetup !== false,
    update: true,
    skipVerify: opts.skipVerify,
  });
}

/** @param {string} searchRoot */
export function findInstalledRepos(searchRoot) {
  const root = path.resolve(searchRoot);
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (fs.existsSync(path.join(dir, MANIFEST_PATH))) {
      found.push(dir);
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === ".gitnexus"
      )
        continue;
      if (ent.name.startsWith(".") && ent.name !== ".worktrees") continue;
      walk(path.join(dir, ent.name), depth + 1);
    }
  }
  walk(root);
  return found.sort();
}

export function updateAllInstalled(searchRoot, opts = {}) {
  const repos = findInstalledRepos(searchRoot);
  if (!repos.length) {
    warn(
      `No installed ${KIT_NAME} repos found under ${path.resolve(searchRoot)}`,
    );
    return [];
  }
  const results = [];
  for (const repo of repos) {
    try {
      const manifest = updateKit(repo, opts);
      results.push({ repo, ok: true, runtime: manifest.runtime });
    } catch (err) {
      results.push({ repo, ok: false, error: err.message || String(err) });
      warn(`${repo}: ${err.message || err}`);
    }
  }
  summaryTable({
    title: `Updated ${results.filter((r) => r.ok).length}/${results.length} installed repos`,
    rows: results.map((r) => ({
      label: path.basename(r.repo),
      value: r.ok ? r.runtime : r.error,
      status: r.ok ? "ok" : "fail",
    })),
  });
  return results;
}

/** @param {string} targetRoot */
export function uninstallKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const prev = readManifest(absTarget);
  if (!prev) {
    throw new Error(`Not installed (missing ${MANIFEST_PATH})`);
  }
  const manifest = prev.data;
  const runtime = parseRuntime(manifest.runtime ?? "both");

  for (const rel of manifest.files ?? []) {
    const abs = path.join(absTarget, rel);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
    pruneEmptyDirs(path.dirname(abs), absTarget);
  }

  unlinkSkillLinks(absTarget, runtime);
  try {
    fs.rmSync(path.join(absTarget, ".gitnexus/agent-kit"), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore */
  }
  // Shared neutral kit dir (hook lib + policy config + session state) — kit-owned.
  // NOT kit-owned. .bearing/ holds the user's north-stars (their semantic anchor), their task-core,
  // and hooks.local.json — which this kit's own .gitignore block makes untracked, so it exists on
  // exactly ONE machine and is unrecoverable. Migration goes out of its way to preserve these;
  // uninstall must not undo that. Remove only what the kit put there.
  rmRf(path.join(absTarget, ".bearing/lib"));
  rmRf(path.join(absTarget, ".bearing/skills"));
  for (const f of fs.readdirSync(path.join(absTarget, ".bearing")).filter((n) => /^\.bearing-|^\.gitnexus-/.test(n))) {
    try {
      fs.unlinkSync(path.join(absTarget, ".bearing", f));
    } catch {
      /* transient session state — best effort */
    }
  }
  const kept = (() => {
    try {
      return fs.readdirSync(path.join(absTarget, ".bearing"));
    } catch {
      return [];
    }
  })();
  if (kept.length === 0) rmRf(path.join(absTarget, ".bearing"));
  else console.log(`  kept your files in .bearing/: ${kept.join(", ")}`);

  // Remove exactly the npm scripts we installed (manifest-recorded), falling
  // back to the live managed set for pre-manifest installs.
  removePackageScripts(absTarget, manifest.npmScripts);
  removeGitignoreSnippet(absTarget);

  for (const adapter of activeAdapters(runtime)) {
    adapter.unwire(absTarget, manifest);
  }

  for (const p of [
    MANIFEST_PATH,
    MANIFEST_PATH_LEGACY,
    ".cursor/hooks.json.bearing.bak",
    ".cursor/mcp.json.bearing.bak",
    // Legacy backup names — still cleaned up so an old install does not leave orphans behind.
    ".cursor/hooks.json.gn-kit.bak",
    ".cursor/mcp.json.gn-kit.bak",
  ]) {
    try {
      fs.unlinkSync(path.join(absTarget, p));
    } catch {
      /* ignore */
    }
  }

  if (opts.removeIndex) {
    rmRf(path.join(absTarget, ".gitnexus"));
    rmRf(path.join(absTarget, ".tmp-agent"));
  }

  pruneEmptyDirs(path.join(absTarget, ".cursor"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".agents"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".zed"), absTarget);
}

function pruneEmptyDirs(dir, stopAt) {
  let cur = dir;
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      if (fs.readdirSync(cur).length === 0) fs.rmdirSync(cur);
      else break;
    } catch {
      break;
    }
    cur = path.dirname(cur);
  }
}

function rmRf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

export function cliMain(argv, invokedAs = "node lib/kit.mjs") {
  const [cmd, target, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const repoIdx = rest.indexOf("--repo-name");
  const runtimeIdx = rest.indexOf("--runtime");
  const featuresIdx = rest.indexOf("--features");
  const featuresFlag =
    featuresIdx >= 0 ? rest[featuresIdx + 1] : process.env.GNKIT_FEATURES;
  const repoName =
    repoIdx >= 0 ? rest[repoIdx + 1] : process.env.GITNEXUS_REPO_NAME;
  const runtime =
    runtimeIdx >= 0 ? rest[runtimeIdx + 1] : process.env.GITNEXUS_RUNTIME;
  const fullIndex = flags.has("--full");
  const quick = cmd === "update" ? !fullIndex : flags.has("--quick");
  const noSetup = flags.has("--no-setup");
  const skipVerify = flags.has("--skip-verify");
  const removeIndex = flags.has("--remove-index");
  const interactive =
    flags.has("--interactive") || (!target && cmd === "install");

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`Usage:
  ${invokedAs} install <target-repo> [--runtime cursor|zed|claude|both|all] [--features northstars,taskcore,microscope,gitnexus|all] [--repo-name NAME] [--quick] [--no-setup] [--skip-verify]
  ${invokedAs} install --interactive
  ${invokedAs} update <target-repo> [--runtime ...] [--full] [--no-setup] [--skip-verify]
  ${invokedAs} update-all <search-root> [--runtime ...] [--no-setup] [--skip-verify]
  ${invokedAs} uninstall <target-repo> [--remove-index]

  Runtime: cursor (hooks) · zed (MCP + skills + profile) · claude (Claude Code hooks + MCP + skills + CLAUDE.md)
           both = cursor+zed (default) · all = cursor+zed+claude · or a comma list e.g. "cursor,claude"
  update defaults to --quick (bundle + skills, skip index). Pass --full to rebuild .gitnexus/
  update-all scans for .gitnexus/agent-kit-manifest.json under the search root.`);
    process.exit(cmd ? 0 : 2);
  }

  if (interactive && cmd === "install") {
    spawnSync(process.execPath, [path.join(KIT_ROOT, "lib/interactive.mjs")], {
      stdio: "inherit",
    });
    return;
  }

  if (!target) {
    console.error(
      "Missing target repo path. Use: install <path> or install --interactive",
    );
    process.exit(2);
  }

  const opts = {
    repoName,
    runtime: runtime ? parseRuntime(runtime) : undefined,
    features: featuresFlag,
    quick,
    runSetup: !noSetup,
    removeIndex,
    skipVerify,
  };

  if (cmd === "install") {
    installKit(target, opts);
    return;
  }
  if (cmd === "update") {
    updateKit(target, opts);
    return;
  }
  if (cmd === "update-all") {
    updateAllInstalled(target, opts);
    return;
  }
  if (cmd === "uninstall") {
    uninstallKit(target, opts);
    console.log(`Uninstalled ${KIT_NAME} from ${path.resolve(target)}`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  cliMain(process.argv.slice(2));
}
