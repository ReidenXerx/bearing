#!/usr/bin/env node
/**
 * bearing — install / update / uninstall core (vendor-agnostic).
 *
 * This module knows nothing about any specific IDE. Per-IDE wiring lives in
 * lib/adapters/* and is driven through the Adapter contract; this core just
 * resolves the active adapters for a runtime and loops over them.
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  isTextCandidate,
  substituteRepoName,
  substitutePlaceholders,
  shouldCopyBundleFile,
  SEED_ONCE_FILES,
} from "./kit-shared.mjs";
import {
  KIT_NAME,
  MANIFEST_PATH,
  MANIFEST_PATHS_LEGACY,
  GITIGNORE_MARKER,
  GITIGNORE_MARKERS_LEGACY,
  parseRuntime
} from "./constants.mjs";
import {
  parseFeatures,
  FEATURE_IDS,
  featureOf,
  FEATURES,
  unsupportedFeatures,
  defaultFeatureIds,
  applyFeatureDelta,
} from "./features.mjs";
import { parseMcpTransport, STDIO_TRANSPORT, defaultGitnexusCmd } from "./mcp-config.mjs";
import { detectRuntimes, detectionReason } from "./detect-runtime.mjs";
import { pickRuntimeInteractive } from "./prompt.mjs";
import { activeAdapters } from "./adapters/index.mjs";
import { readJsonSafe } from "./adapters/json-util.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";
import {
  detectPrettier,
  appendPrettierIgnore,
  removePrettierIgnore,
  PRETTIERIGNORE_PATH,
} from "./prettier.mjs";
import { runPostChecks } from "./postcheck.mjs";
import { ensureDomain, DOMAIN_PATH } from "./domain.mjs";
import { personaNoteFor } from "./kit-shared.mjs";
import {
  hasSharedInstall,
  trackedFilesAtRisk,
  stealthLimits,
  writeExclude,
  excludeLines,
  removeExclude
} from "./stealth.mjs";
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
import { versionsSince, readPackagedChangelog } from "./changelog.mjs";
import { mergeGoldPractices } from "./gold-practices.mjs";

/** The one bundle file that is merged rather than copied. */
const GOLD_PRACTICES_REL = ".bearing/gold-practices.md";

/** Where the full notes live. The repo is the one place all of them are readable at once. */
const RELEASES_URL = "https://github.com/ReidenXerx/bearing/releases";

export {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  substituteRepoName,
  isTextCandidate,
};

export const GITNEXUS_NPM_SCRIPTS = flatGitnexusScripts();

export { GITIGNORE_MARKER };

/**
 * Shared (vendor-neutral) ignore entries; adapters contribute IDE-specific lines.
 *
 * CORE only — these are written by modules that ship to every install, so they must not be gated.
 * Graph-only entries live in GITIGNORE_GITNEXUS: naming the index directory in a repo that
 * declined the module is the same NS-13 leak as installing the gates themselves.
 */
const GITIGNORE_BASE = [
  // .bearing/ holds the TRACKED kit payload (hook lib, policy config, skill store —
  // teammates get these via git). Only per-session runtime state, the install manifest,
  // and the per-machine config override are ignored; the IDE skill symlink dirs are
  // ignored + regenerated.
  //
  // Per-session state keeps its `.gitnexus-` prefix because the CORE session-primer writes it —
  // .gitnexus-northstar-counter.json belongs to the northstars module, not the graph — so gating
  // this line would start tracking runtime churn in every intel-only install.
  ".bearing/.gitnexus-*",
  // ...and the session flags written under the NEW prefix. Uninstall has always known about both
  // (`/^\.bearing-|^\.gitnexus-/`); the ignore list only knew the old one, so every install began
  // committing .bearing-session-primed.flag.
  ".bearing/.bearing-*",
  // The task-core is the agent's in-flight save-state for the CURRENT task — per-developer working
  // state, not something teammates should receive. It WAS ignored, as `.gitnexus-task-core.md`
  // under the pattern above; renaming it to `.task-core.md` silently moved it out of coverage and
  // started committing it. This restores the pre-rename behaviour.
  ".bearing/.task-core.md",
  // Task-cores are now ONE PER CHAT, under a directory — several agent sessions run in the same
  // repo and a single file meant they overwrote each other. The directory needs its OWN rule:
  // the pattern above matches a file, not a folder, so every chat's save-state would be
  // committed. The same failure the rename caused, one level up.
  ".bearing/task-cores/",
  // Install stashes a user's colliding file beside ours before overwriting. Those copies are a
  // safety net for THIS machine, never content to publish — and upgrading from the legacy .gnkit/
  // layout produces one per lib file, so a repo picks up ~30 of them in a single update.
  "*.bearing-backup",
  // Install state: records the resolved runtime, module selection, and the gitnexus binary this
  // machine resolved — machine-specific, so it stays out of git exactly as it did when it lived
  // under the (ignored) .gitnexus/ directory.
  ".bearing/manifest.json",
  // Per-machine hook-config override (e.g. taskCoreEveryEdits) — wins
  // over the team-shared gitnexus-hooks.json; kept local so it doesn't affect teammates.
  ".bearing/hooks.local.json",
];

/** Ignore entries for artifacts only the gitnexus module ever creates. */
const GITIGNORE_GITNEXUS = [
  // The graph index is machine-specific (absolute repoPath baked in) + large →
  // regenerated per-machine via agent-refresh.
  ".gitnexus/",
  // Scratch dir used by the graph module's scripts/ wrappers.
  ".tmp-agent/",
  // Derived API profile — written by detect-api-router, a graph-only lib.
  ".bearing/gitnexus-api-profile.json",
  // Derived architecture doc — regenerated from live graph stats on every refresh
  // (machine-specific), so it churns git for every teammate. Kept local.
  "docs/ARCHITECTURE.gitnexus.md",
];

/**
 * Ignore entries for what a RUN of the e2e harness leaves behind.
 *
 * The harness itself is committed — it is team-shared, and the scars in its README are the point.
 * These three are not:
 *   - `node_modules/` — a Playwright install, per machine.
 *   - `shots/` — overwritten on every capture by design, so committing them puts a binary diff in
 *     every PR that ran a verifier, for images whose whole contract is that the newest wins.
 *   - `storage*.json` — a SESSION EXPORT. It holds live access and refresh tokens for a real
 *     account. This is the one line here that is a security control rather than a tidiness one,
 *     and it is listed BEFORE anyone creates the file, because the tool that writes it is
 *     `tools/export-storage.js` and the mistake is only visible after the commit.
 */
const GITIGNORE_E2E = [".e2e/node_modules/", ".e2e/shots/", ".e2e/storage*.json"];

/**
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {Set<string>|null} [features] null = every feature (callers that predate the axis)
 */
function buildGitignoreSnippet(runtime, features = null) {
  const lines = [...GITIGNORE_BASE];
  if (!features || features.has("gitnexus")) lines.push(...GITIGNORE_GITNEXUS);
  if (!features || features.has("e2e")) lines.push(...GITIGNORE_E2E);
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
function copyBundleFile(src, dest, repoName, persona, personaNote) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isTextCandidate(src)) {
    fs.writeFileSync(
      dest,
      substitutePlaceholders(fs.readFileSync(src, "utf8"), { repoName, persona, personaNote }),
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
export function mergePackageScripts(targetRoot, repoName, gitnexusCmd) {
  const name = repoName ?? path.basename(targetRoot);
  return mergeIntoPackageJson(path.join(targetRoot, "package.json"), {
    createIfMissing: true,
    repoName: name,
    gitnexusCmd,
  });
}

const GNI_BEGIN = "# --- begin bearing (managed — edits here are replaced on update) ---";
const GNI_END = "# --- end bearing ---";

/**
 * Refresh bearing's managed block in `.gitnexusignore`, preserving everything outside it.
 *
 * This file decides what enters the graph, so it is per-REPO by nature: one project needed
 * `!build/` and `!src/ui/pages/build/` because that directory is real UI source and gitnexus drops
 * anything named `build` as output. Copying the bundle version over it deleted those, five files
 * silently left the index, and every question about them came back empty in the way that reads as
 * "this code does not exist".
 *
 * Same shape `.gitignore` already uses, and for the same reason its comment gives: a rule appended
 * after the block must survive the next update. Re-includes belong BELOW the block because the last
 * matching pattern wins — putting them above would leave them overridden by our own exclusions.
 *
 * A file with NO markers predates this and is left completely alone: its content is our old
 * baseline and the user's edits mixed together, and nothing can tell them apart. Returns what
 * happened so the caller can say so rather than working silently.
 * @param {string} targetRoot
 * @returns {"created"|"refreshed"|"unmanaged"|"absent"}
 */
export function refreshGitnexusignore(targetRoot) {
  const dest = path.join(targetRoot, ".gitnexusignore");
  const shipped = path.join(BUNDLE_ROOT, ".gitnexusignore");
  if (!fs.existsSync(shipped)) return "absent";
  const fresh = fs.readFileSync(shipped, "utf8");
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, fresh);
    return "created";
  }
  const current = fs.readFileSync(dest, "utf8");
  const b = current.indexOf(GNI_BEGIN);
  const e = current.indexOf(GNI_END);
  if (b < 0 || e < 0 || e < b) return "unmanaged";
  const newBlock = fresh.slice(fresh.indexOf(GNI_BEGIN), fresh.indexOf(GNI_END) + GNI_END.length);
  const next = current.slice(0, b) + newBlock + current.slice(e + GNI_END.length);
  if (next !== current) fs.writeFileSync(dest, next);
  return "refreshed";
}

/**
 * @param {string} targetRoot
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {Set<string>|null} [features]
 */
export function appendGitignore(targetRoot, runtime = "both", features = null) {
  const gi = path.join(targetRoot, ".gitignore");
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const block = buildGitignoreSnippet(parseRuntime(runtime), features).trim();
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

/**
 * @param {string} targetRoot
 * @param {boolean} [weCreatedIt] manifest-recorded: the repo had no .gitignore before we installed
 */
export function removeGitignoreSnippet(targetRoot, weCreatedIt = false) {
  const gi = path.join(targetRoot, ".gitignore");
  if (!fs.existsSync(gi)) return;
  const stripped = stripManagedGitignoreBlock(fs.readFileSync(gi, "utf8"));
  // Taking our block out of a file we created ourselves can leave an empty one the repo never
  // had. Delete it only on the manifest's word — an empty .gitignore the USER committed is still
  // theirs, and guessing from emptiness alone cannot tell the two apart (NS-1).
  if (weCreatedIt && !stripped.trim()) {
    try {
      fs.unlinkSync(gi);
    } catch {
      /* best effort */
    }
    return;
  }
  // `\n*` not `\n+`: stripping the block can consume the file's final newline, and `\n+` has
  // nothing to match then — so a user's `secrets/\n` came back as `secrets/` and every uninstall
  // showed up as a modified .gitignore in their diff.
  fs.writeFileSync(gi, stripped.replace(/\n*$/, "\n"));
}

/**
 * @param {string} targetRoot @param {string[]} [keys] Keys to remove (defaults to all managed).
 * @param {{ dropEngines?: boolean }} [opts] dropEngines: the manifest says the Node floor is OURS.
 */
export function removePackageScripts(targetRoot, keys, opts = {}) {
  const pkgPath = path.join(targetRoot, "package.json");
  const pkg = readJsonSafe(pkgPath, null);
  if (!pkg) return;
  // Write only if we actually take something out. Rewriting reformats the user's package.json —
  // a diff in their repo, produced by a step that had nothing to do.
  let changed = false;
  for (const key of keys ?? allManagedScriptKeys()) {
    if (pkg.scripts && key in pkg.scripts) {
      delete pkg.scripts[key];
      changed = true;
    }
  }
  // Only when the manifest recorded that we added it. A floor the user set is theirs, and a repo
  // that legitimately requires Node 22.9 must not have that requirement quietly deleted.
  if (opts.dropEngines && pkg.engines?.node === ">=22.9.0") {
    delete pkg.engines.node;
    if (Object.keys(pkg.engines).length === 0) delete pkg.engines;
    changed = true;
  }
  if (changed) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** @param {string} absTarget */
export function readManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, ...MANIFEST_PATHS_LEGACY]) {
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
/**
 * The branch this repo's remote considers default (`origin/HEAD`), or null.
 *
 * Used to WARN, not to block: an update writes ~60 files, and landing that diff on a feature branch
 * puts it on top of someone's in-progress work. Reporting the branch passively was not enough —
 * that line was already there when 64 files went onto a live feature branch, because a line you do
 * not read is a line that does not exist (NS-6).
 */
function defaultBranch(absTarget) {
  try {
    const ref = execFileSync("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
      cwd: absTarget,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return ref.replace(/^refs\/remotes\/origin\//, "") || null;
  } catch {
    return null; // no remote, or origin/HEAD never set — no basis to call anything unusual
  }
}

/** The checked-out branch, or null when detached / not a git repo. */
function currentBranch(absTarget) {
  try {
    // `--show-current` and not `rev-parse --abbrev-ref HEAD`: the latter FAILS on a repo with no
    // commits yet, so a fresh clone reported its real branch as "(detached)".
    const b = execFileSync("git", ["branch", "--show-current"], {
      cwd: absTarget,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return b && b !== "HEAD" ? b : null;
  } catch {
    return null;
  }
}

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
  // FEATURE axis (see lib/features.mjs). Inherit the prior selection on update; otherwise take the
  // RECOMMENDED set, not "all" — every opt-out module (today: e2e) writes something into the repo
  // that a user who never mentioned features has not agreed to. `--features all` still means all.
  const features = parseFeatures(
    opts.features ?? readManifest(absTarget)?.data.features?.join(",") ?? defaultFeatureIds().join(","),
  );
  // MCP TRANSPORT, inherited exactly like the feature set. bearing always writes the entry — that
  // is what keeps it predictable — but it writes the RECORDED choice, so a repo deliberately
  // pointed at a shared http server is not silently reverted to spawning its own stdio process on
  // the next update.
  // WHICH gitnexus binary the generated scripts call. Same rule as the transport: bearing always
  // rewrites the scripts, which is what keeps them predictable, but it rewrites them with the
  // RECORDED choice. Without this, a repo whose scripts were deliberately pointed at a local build
  // had all 16 of them reverted to `npx gitnexus@latest` by the next update — so `bearing:refresh`
  // silently rebuilt the index with the published analyzer instead of the one being developed.
  const gitnexusCmd =
    opts.gitnexusCmd ?? readManifest(absTarget)?.data.gitnexusCmd ?? defaultGitnexusCmd();
  const mcpTransport = parseMcpTransport(
    opts.mcpTransport ?? readManifest(absTarget)?.data.mcpTransport ?? STDIO_TRANSPORT,
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

  // A module whose enforcing implementation exists on NO active runtime can do nothing here, and
  // installing it anyway is the parity overstatement NS-14 warns about — `--runtime cursor
  // --features minions` shipped a skill telling a Cursor agent to fan out subagents on a chosen
  // model tier, which only Claude Code can do. Say so and drop it rather than leaving an
  // instruction the agent cannot follow (NS-13). Told plainly, because silently installing less
  // than was asked for is its own defect.
  const inert = unsupportedFeatures(features, adapters.map((a) => a.id));
  for (const id of inert) {
    const f = FEATURES.find((x) => x.id === id);
    features.delete(id);
    warn(
      `${id}: skipped — it needs ${f.runtimes.join(" or ")}, and this install is ${runtime}. ` +
        "Nothing of it would work here.",
    );
  }
  const repoName =
    opts.repoName ??
    migration.legacyManifest?.repoName ??
    readManifest(absTarget)?.data.repoName ??
    path.basename(absTarget);
  const kitPkg = JSON.parse(
    fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8"),
  );

  // WHO is reviewing this project. Resolved BEFORE the copy, not just before the adapters: the
  // Cursor rule is a plain bundle file, so a persona resolved later shipped it with a literal
  // `__BEARING_PERSONA__`. Caught by the post-check rather than by review, which is the point of
  // having one. Never overwrites an existing .bearing/domain.json — once it exists it is the
  // user's answer, not ours (NS-1).
  // STEALTH. Inherited from the manifest like every other recorded choice, so an update never
  // silently un-hides an install (which would put ~80 paths into the next `git status`).
  const stealth = opts.stealth ?? readManifest(absTarget)?.data.stealth ?? false;
  if (stealth) {
    const shared = hasSharedInstall(absTarget);
    if (shared.shared) {
      throw new Error(
        `Cannot install in stealth mode: bearing is already COMMITTED here (${shared.paths.length} tracked paths, e.g. ${shared.paths[0]}).\n` +
          "  Going stealth now would mean removing those files from your teammates' checkouts — a deliberate act, not an install flag.\n" +
          "  Either keep the shared install, or `git rm -r --cached` the bearing paths and commit that yourself first.",
      );
    }
    const atRisk = trackedFilesAtRisk(absTarget);
    if (atRisk.length) ok(`Stealth: leaving ${atRisk.length} tracked file(s) untouched (${atRisk.slice(0, 3).join(", ")}${atRisk.length > 3 ? ", …" : ""})`);
    for (const l of stealthLimits(absTarget, runtime)) warn(`Stealth: ${l.id} skipped — ${l.why}`);
  }

  const domain = ensureDomain(absTarget);
  // Only when nothing could be resolved. A pinned or inferred domain gets no nag.
  const personaNote = domain.domain ? "" : personaNoteFor(domain.suggested ?? null);
  // Three distinct outcomes, and they want three different things from the reader: we resolved it
  // (confirm), we could not (act), or you already answered (nothing).
  if (domain.domain) {
    ok(`Domain: ${domain.domain} — reviewing as ${domain.persona}`);
    if (domain.created && domain.evidence.length) {
      ok(`  inferred from ${domain.evidence.join(", ")}`);
      // A wrong guess biases every later judgement, so make correcting it an obvious option.
      warn(`  wrong domain? edit ${DOMAIN_PATH} — bearing will not overwrite it`);
    } else if (!domain.created) {
      ok(`  pinned in ${DOMAIN_PATH}`);
    }
  } else {
    // The one gap the installer cannot close by itself: it needs someone who knows what this
    // project is. Loud, and specific about the consequence rather than just the fact.
    warn("");
    warn("  ⚑ NO DOMAIN RESOLVED — reviews here will be generic.");
    warn("     Nothing in package.json, README or CLAUDE.md says what this project IS, so");
    warn("     microscope and every review skill fall back to a plain senior engineer.");
    if (domain.suggested) warn(`     Weak signals hinted at "${domain.suggested}".`);
      // Hand over the evidence instead of a dead end. Where the graph has indexed this repo it has
      // already named every area of it, and those names describe the product better than any
      // taxonomy of ours — whoever answers this should not have to go and find them.
      if (domain.areas?.length) {
        warn(`     The graph says the main areas here are: ${domain.areas.slice(0, 8).join(", ")}.`);
        warn("     Name the expertise that covers those and you are done.");
      }
    warn(`     Fix in one line — set "persona" in ${DOMAIN_PATH}, e.g.`);
    warn('       "persona": "staff payments and ledger engineer"');
    warn("     Your agent will also offer to do this at the start of its next session.");
    warn("");
  }

  step(
    3,
    7,
    `Copy bundle (runtime: ${runtime}${features.size < FEATURE_IDS.length ? `, features: ${[...features].join("+")}` : ""})`,
  );
  // A backup answers "was there a file of the USER'S here before bearing?" — and only a FIRST
  // install can observe that. By the second run the file exists because we wrote it, so re-deriving
  // backs up our own artifact and uninstall faithfully restores it: a `.cursor/hooks.json` still
  // registering hooks whose scripts uninstall just deleted, and the MCP server still configured.
  // Same trap as `createdGitignore` and `addedEngines` — an earlier install's answer is the
  // authoritative one. Keyed per ADAPTER, not blanket: a runtime added later (claude first, then
  // cursor) meets a genuinely user-owned file for the first time and must still back it up.
  const prevInstall = readManifest(absTarget)?.data;
  const prevAdapterIds = new Set(
    prevInstall ? activeAdapters(prevInstall.runtime).map((a) => a.id) : [],
  );
  const backups = {};
  for (const adapter of adapters) {
    for (const b of adapter.backups) {
      const base = path.basename(b.rel);
      if (prevAdapterIds.has(adapter.id)) {
        if (prevInstall?.backups?.[base]) backups[base] = prevInstall.backups[base];
        continue;
      }
      const made = backupIfExists(absTarget, b.rel, b.bak);
      if (made) backups[base] = made;
    }
  }

  let files = [];
  // Files the kit installed last time are ours to replace. Anything else that already exists is
  // the USER'S — .vscode/settings.json and .githooks/pre-commit are ordinary user-owned paths that
  // collide with bundle paths, and copyBundleFile writes unconditionally. Without this, install
  // silently replaced a repo's commit gate and editor config, and uninstall then deleted them.
  const previouslyOurs = new Set(readManifest(absTarget)?.data.files ?? []);
  const preserved = [];
  for (const rel of listBundleFiles()) {
    // Stealth installs no git hooks: .githooks/pre-commit runs `npm run bearing:full-pdg`, and
    // stealth cannot add npm scripts (package.json is tracked). Installing it anyway would put a
    // pre-commit hook in place that fails on every commit — caught by the dangling-reference check.
    if (stealth && rel.startsWith(".githooks/")) continue;
    if (!shouldCopyBundleFile(rel, runtime, features, (r) => fs.existsSync(path.join(absTarget, r)))) {
      // A seed-once file is skipped on every update precisely BECAUSE it is already there. That is
      // not a reason to stop claiming it: dropping it from files[] told uninstall the kit had never
      // installed it, so `install; update; uninstall` left .bearing/hooks.json behind forever.
      // Only re-claim what a previous manifest says we wrote — a hooks.json the user created before
      // the first install was never ours and must stay untouched (NS-1).
      if (SEED_ONCE_FILES.has(rel) && previouslyOurs.has(rel)) files.push(rel);
      continue;
    }
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
    // Gold practices are a MERGE, not a copy: bearing rewrites its own block and never touches the
    // project's rules below it. Copying wholesale here deleted work agents had been accumulating
    // for weeks, silently, on a file whose own header invited the mistake.
    if (rel === GOLD_PRACTICES_REL) {
      const dest = path.join(absTarget, rel);
      const before = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
      const { content, adopted } = mergeGoldPractices(
        before,
        fs.readFileSync(path.join(BUNDLE_ROOT, rel), "utf8"),
      );
      fs.writeFileSync(dest, content);
      if (adopted.length) {
        ok(`gold practices: kept your ${adopted.length} own rule(s), renumbered PP-1..PP-${adopted.length}`);
      }
      files.push(rel);
      continue;
    }
    copyBundleFile(
      path.join(BUNDLE_ROOT, rel),
      path.join(absTarget, rel),
      repoName,
      domain.persona,
      personaNote,
    );
    files.push(rel);
  }
  ok(`${files.length} bundle files → ${repoName}`);
  for (const p of preserved) ok(`kept your existing file: ${p}`);

  // FEATURE DOWNGRADE. The feature axis was only ever applied when COPYING, so re-installing with
  // fewer modules left every previously-installed file in place: the user turned GitNexus off and
  // the guards kept enforcing, the MCP server stayed configured, and 32 npm scripts stayed in
  // package.json. Remove what the dropped modules own — but ONLY paths the previous manifest says
  // this kit installed, never a user file that happens to collide with a bundle path (NS-1).
  const removed = [];
  const restored = [];
  // A file the BUNDLE no longer ships is also ours to take back. The rule below only fires when a
  // MODULE was deselected, so a file we renamed or dropped stayed on disk forever — unregistered
  // and inert, but present, and indistinguishable from a live part of the install to anyone reading
  // the directory. Same principle as the feature downgrade: if we put it there and we no longer
  // ship it, removing it is finishing the job.
  const shipped = new Set(listBundleFiles());
  for (const rel of previouslyOurs) {
    const owner = featureOf(rel);
    const dropped = !shipped.has(rel);
    if (!dropped && (!owner || features.has(owner))) continue;
    const abs = path.join(absTarget, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      // If install had to overwrite a file of the user's at this path, it stashed the original
      // beside it. Deleting ours would then leave NOTHING where their file used to be — so put
      // theirs back rather than removing (NS-1: this runs in someone else's repository).
      const bak = `${abs}.bearing-backup`;
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, abs);
        fs.unlinkSync(bak);
        restored.push(rel);
      } else {
        fs.unlinkSync(abs);
        removed.push(rel);
      }
    } catch {
      /* best effort — a file we cannot remove must not fail the install */
    }
  }
  // The manifest must list what we LEFT BEHIND, not what we wrote earlier in this same run. A
  // seed-once file is re-claimed above so uninstall can still clean it up — but a feature downgrade
  // then deletes it a few lines later, and the manifest went on promising it. The installer's own
  // postcheck caught that as "recorded files are on disk: 1 missing" (NS-20).
  if (removed.length) {
    const gone = new Set(removed);
    files = files.filter((rel) => !gone.has(rel));
  }

  // Prune directories the removals emptied, so no orphaned .cursor/hooks/ or .githooks/ is left
  // looking like a live install. Deepest first, and rmdir only succeeds when genuinely empty.
  for (const dir of [...new Set(removed.map((r) => path.dirname(r)))].sort(
    (a, b) => b.length - a.length,
  )) {
    for (let d = dir; d && d !== "."; d = path.dirname(d)) {
      try {
        fs.rmdirSync(path.join(absTarget, d));
      } catch {
        break; // not empty (or gone) → stop climbing
      }
    }
  }
  if (removed.length) ok(`removed ${removed.length} files for deselected modules`);
  for (const rel of restored) ok(`restored your original ${rel}`);

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
    // An adapter may WRITE bundle-path files itself (Cursor renders its contract rule filtered to
    // the installed features). Those are kit-owned like any copied file, so record them: the backup
    // step treats anything absent from the manifest as the user's, and would otherwise "preserve"
    // our own output as a .bearing-backup on every re-install.
    const wrote = adapter.wire(absTarget, {
      repoName,
      features,
      mcpTransport,
      gitnexusCmd,
      persona: domain.persona,
      personaNote,
      stealth,
    });
    if (Array.isArray(wrote)) for (const rel of wrote) if (!files.includes(rel)) files.push(rel);
    manifestFlags = { ...manifestFlags, ...adapter.manifestFlags() };
    ok(`${adapter.id}: wired`);
  }
  // Every bearing:* script runs `node scripts/bearing-*.mjs`, and scripts/ is gitnexus-owned. Adding
  // them to an intel-only install produces dozens of commands that all fail with "no such file" —
  // and the installer's own Next steps tell the user to run two of them.
  // Stealth cannot add npm scripts: package.json is tracked, and editing it is the leak.
  const wantsScripts = features.has("gitnexus") && !stealth;
  // Deselecting the module must also take its scripts back out. Every bearing:* script runs a file
  // under scripts/, which the removal above just deleted, so leaving them behind means a
  // package.json full of commands that all fail with "no such file".
  if (!wantsScripts) removePackageScripts(absTarget);
  // Sticky, like createdGitignore: by the second run the file exists BECAUSE WE MADE IT, and a
  // fresh reading would call it the user's — so uninstall would strand it forever (NS-22).
  const createdPackageJsonPrev = readManifest(absTarget)?.data.createdPackageJson === true;
  const scriptStats = wantsScripts
    ? mergePackageScripts(absTarget, repoName, gitnexusCmd)
    : { added: 0, updated: 0, total: 0 };
  const createdPackageJson = createdPackageJsonPrev || scriptStats.createdPackageJson === true;
  // Record whether the .gitignore is ours BEFORE we write to it, and keep an earlier install's
  // answer — by the second run the file exists because WE made it, which would otherwise read as
  // "the user's" and strand an empty file at uninstall.
  const createdGitignore =
    readManifest(absTarget)?.data.createdGitignore ??
    !fs.existsSync(path.join(absTarget, ".gitignore"));
  // Same trap one field over: by the second install `engines.node` is already there BECAUSE WE
  // ADDED IT, so a fresh reading says "theirs" and uninstall would leave our floor in their
  // manifest forever. An earlier YES is the authoritative answer.
  const addedEngines =
    readManifest(absTarget)?.data.addedEngines || scriptStats.addedEngines === true;
  if (stealth) {
    // .git/info/exclude is per-clone and itself untracked, so these rules can never travel.
    writeExclude(absTarget, excludeLines(features));
    ok(`Stealth: ${excludeLines(features).length} paths hidden via .git/info/exclude`);
  } else {
  appendGitignore(absTarget, runtime, features);
  // .gitnexusignore is seed-once for the blind copy, so refresh only its MANAGED BLOCK here —
  // that keeps bearing's baseline current without touching a repo's own re-includes below it.
  if (!features || features.has("gitnexus")) {
    const gni = refreshGitnexusignore(absTarget);
    if (gni === "unmanaged") {
      // Predates managed blocks: its content is our old baseline and the user's edits mixed
      // together, and nothing can tell them apart. Say so rather than guess (GP-21) — reported
      // HERE because the per-file notes above have already printed by this point.
      ok(
        ".gitnexusignore left untouched — it has no managed block, so your edits and our old " +
          "baseline cannot be told apart. To adopt the current baseline, wrap ours in the " +
          "`# --- begin bearing` / `# --- end bearing ---` markers; updates then refresh it in place.",
      );
    }
  }
  }

  // Prettier and bearing both claim the same ~90 tracked files — the hook lib, the skill store, the
  // rules — and whichever ran last wins until the other runs again. Exempting them ends the loop.
  //
  // Only ever on an explicit yes. `.prettierignore` is the repo's own configuration, read by the
  // team's tooling, and editing it uninvited is precisely what bearing does not do.
  // stealthLimits() already reports this whenever Prettier is DETECTED, so this covers only the
  // other case: the flag was passed in a repo with no Prettier, where staying silent would let a
  // flag the user typed do nothing at all without saying so (GP-8).
  if (stealth && opts.prettierIgnore === true && !detectPrettier(absTarget).found) {
    warn(
      "Stealth: --prettierignore skipped — stealth never writes the repo's own config",
    );
  }
  const prettierIgnore = stealth
    ? false
    : (opts.prettierIgnore ?? readManifest(absTarget)?.data.prettierIgnore ?? false);
  // Undefined inherits the recorded answer, exactly like prettierIgnore — an update must not
  // silently switch CI behaviour a team already chose.
  const testOrder = opts.testOrder ?? readManifest(absTarget)?.data.testOrder ?? false;
  // The ANSWER lives in hooks.json, which is tracked. The manifest is gitignored, so a setting kept
  // only there is absent from every CI checkout and the feature never fires — reading as "off" on a
  // repo that said yes. hooks.json is seed-once, so an existing one is the team's file: set the key
  // when we are creating it, and hand over the one-line edit otherwise rather than writing into it
  // uninvited (NS-1, GP-21).
  if (testOrder) {
    const hj = path.join(absTarget, ".bearing/hooks.json");
    let cfg = null;
    try {
      cfg = JSON.parse(fs.readFileSync(hj, "utf8"));
    } catch {
      /* absent or unreadable */
    }
    if (cfg && cfg.ciTestOrder !== true) {
      warn(
        'PR test order: add `"ciTestOrder": true` to .bearing/hooks.json — that file is yours and ' +
          "committed, and CI reads it there (the manifest is gitignored and never reaches CI).",
      );
    }
  }
  // Same trap as createdGitignore: by the second run the file exists BECAUSE WE MADE IT, which a
  // fresh reading calls "the user's" — and uninstall would then strand an empty file (NS-1).
  const createdPrettierIgnore =
    readManifest(absTarget)?.data.createdPrettierIgnore ??
    !fs.existsSync(path.join(absTarget, PRETTIERIGNORE_PATH));
  if (prettierIgnore) {
    const exempted = appendPrettierIgnore(absTarget, runtime, features);
    ok(`.prettierignore: ${exempted.length} bearing-owned paths exempted from formatting`);
  } else if (readManifest(absTarget)?.data.prettierIgnore) {
    // Saying no after having said yes has to TAKE THE BLOCK OUT. Leaving it would go on exempting
    // files for a repo that just asked us to stop, and the manifest written below stops claiming
    // it — so nothing would ever remove it, including uninstall.
    removePrettierIgnore(absTarget, createdPrettierIgnore);
    ok(".prettierignore: bearing block removed");
  }
  ok(
    wantsScripts
      ? `package.json: ${scriptStats.added} added, ${scriptStats.updated} updated (${scriptStats.total} entries)`
      : "npm scripts skipped (gitnexus module not selected)",
  );

  // Task-cores live one-per-chat in a directory, so the directory has to exist before the agent is
  // handed a path inside it. The SessionStart hook also creates it, but only Claude Code fires one
  // — and an install should not leave a documented path that does not resolve. Gated: a repo that
  // declined the module gets no directory for it (NS-13).
  if (features.has("taskcore")) {
    fs.mkdirSync(path.join(absTarget, ".bearing/task-cores"), { recursive: true });
  }

  step(6, 7, "Write manifest & chmod hooks");
  // Only claim ownership of scripts we actually wrote, or uninstall reports removing what it never added.
  const npmScripts = wantsScripts ? allManagedScriptKeys() : [];

  // How to run each command WITHOUT the npm alias. A stealth install writes the scripts but adds no
  // npm scripts — editing package.json is the thing that mode exists to avoid — so every message
  // reading "npm run bearing:…" named something the repo did not have. The mapping cannot be derived
  // from the name (`bearing:agent-refresh` runs the `refresh` subcommand), so it is written here from
  // the same definitions that produce the aliases, and read back by howToRun().
  if (features.has("gitnexus")) {
    fs.mkdirSync(path.join(absTarget, ".bearing"), { recursive: true });
    fs.writeFileSync(
      path.join(absTarget, ".bearing/commands.json"),
      `${JSON.stringify(GITNEXUS_NPM_SCRIPTS, null, 2)}\n`,
    );
    // Recorded as an installed file, or uninstall walks past it and leaves `.bearing/` standing —
    // which is the whole of NS-1: this runs in other people's repositories, so anything written
    // has to be removable by the same manifest that recorded it.
    if (!files.includes(".bearing/commands.json")) files.push(".bearing/commands.json");
  }

  const manifest = {
    kit: KIT_NAME,
    kitVersion: kitPkg.version,
    installedAt: new Date().toISOString(),
    repoName,
    runtime,
    features: [...features],
    mcpTransport,
    gitnexusCmd: gitnexusCmd ?? null,
    files,
    skills: skillNames,
    npmScripts,
    gitignoreMarker: GITIGNORE_MARKER,
    stealth,
    createdGitignore,
    prettierIgnore,
    createdPrettierIgnore,
    testOrder,
    addedEngines,
    createdPackageJson,
    backups,
    ...manifestFlags,
  };

  // Leave exactly one manifest behind. Two that disagree is worse than one that is stale: every
  // reader picks the first path it finds, so uninstall could read a different module selection
  // than update just wrote.
  for (const rel of MANIFEST_PATHS_LEGACY) {
    try {
      fs.unlinkSync(path.join(absTarget, rel));
    } catch {
      /* absent (the common case) or not ours to remove */
    }
    // Removing the old manifest can empty the graph tool's index dir in a repo that never had a
    // graph — rmdir only succeeds when it is genuinely empty, so a real index is never touched.
    pruneEmptyDirs(path.join(absTarget, path.dirname(rel)), absTarget);
  }

  const manifestPath = path.join(absTarget, MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  chmodScripts(absTarget);
  ok(`Manifest v${kitPkg.version} (${runtime})`);

  if (opts.runSetup !== false) {
    step(7, 7, "Run bearing-setup.sh (index + sync)");
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
      // Setup is step 7 of 7 — the manifest and every kit file are already written by now, so this
      // is "the index did not build", not "the install failed". Saying the latter made `update-all`
      // report a whole repo as failed when only the reindex needed rerunning, and left the user
      // with no idea what to do about it (NS-6).
      throw new Error(
        `kit files updated, but the index build failed (bearing-setup.sh exit ${r.status}) — run \`npm run bearing:refresh\` in this repo`,
      );
    }
    }
  } else {
    step(7, 7, "Skip setup (--no-setup)");
    warn(
      wantsScripts
        ? "Run npm run bearing:setup in the target repo"
        : "Run bash scripts/bearing-setup.sh in the target repo",
    );
  }

  if (opts.runSetup !== false && !opts.skipVerify) {
    runVerify(absTarget);
  }

  // POST-CONDITIONS. Deliberately NOT behind --skip-verify, and not behind runSetup: those flags
  // exist to skip the slow index build, and every automated path in this repo passes them — which
  // is precisely how nine defects reached a real machine unnoticed. These checks read the disk
  // we just wrote and cost milliseconds, so there is no reason to ever skip them.
  const findings = runPostChecks(absTarget, { features, mcpTransport, gitnexusCmd, manifest });
  const failed = findings.filter((f) => !f.ok);
  // SPLIT the two, because they are not the same claim and must not share an outcome.
  //
  // `environmental` used to change only the wording. An install whose one problem was "no MCP
  // server listening" still announced "this install is not what it claims" and exited 1 — which is
  // false: the files are exactly what they claim, and the machine is missing a service the check
  // names and tells you how to start. It cost main SIXTY-PLUS consecutive red CI runs, since CI
  // never has that server, and a pipeline that is always red is a pipeline nobody can read a real
  // regression out of (NS-5).
  const defects = failed.filter((f) => !f.environmental);
  const environmental = failed.filter((f) => f.environmental);

  if (environmental.length) {
    console.log("");
    for (const f of environmental) {
      warn(`  ! ${f.label}: ${f.detail}`);
      if (f.hint) warn(`      fix: ${f.hint}`);
    }
    warn("  Your machine needs something — the install itself is correct.");
  }

  if (defects.length) {
    console.log("");
    warn(`${defects.length} post-install check${defects.length > 1 ? "s" : ""} FAILED — this install is not what it claims:`);
    for (const f of defects) {
      warn(`  ✗ ${f.label}: ${f.detail}`);
      if (f.hint) warn(`      fix: ${f.hint}`);
    }
    warn("  The unhinted items above are bearing's fault, not yours — please report them.");
    // A caller must be able to detect this. Not a throw: the files ARE installed, and aborting
    // would strand `update-all` partway through a batch. But the process must not exit 0 while
    // reporting a failure — that is the same "claimed success we never checked" this guards.
    //
    // Only when we ARE the CLI. A library that mutates the host process's exit code poisons every
    // embedder: the test suite called installKit in-process, every assertion passed, and the run
    // still reported failure because one fixture tripped a check on purpose.
    if (opts.cli) process.exitCode = 1;
  }

  const newModules = printInstallComplete(absTarget, repoName, mode, runtime, {
    quick: opts.quick,
    setupSkipped: opts.runSetup === false,
    features,
    mcpTransport,
    failedChecks: failed.length,
    // PASSED, not re-derived. The summary computed its own `features.has("gitnexus")` and missed
    // the `&& !stealth` half, so a stealth install — which installs no npm scripts at all — told
    // the user to run five of them. Same shape as the uninstall defect: the writer knew about
    // stealth and the reporter did not. One fact, one source.
    hasScripts: wantsScripts,
    stealth,
    // Captured BEFORE the manifest was rewritten — by now the file on disk says the new version.
    prevKitVersion: prevInstall?.kitVersion,
    kitVersion: kitPkg.version,
  });
  return { ...manifest, newModules };
}

/**
 * Is the e2e harness ready to run, or is it 10 files that throw `Cannot find module 'playwright'`?
 * @param {string} root
 */
export function e2eNeedsDeps(root) {
  return (
    fs.existsSync(path.join(root, ".e2e/package.json")) &&
    !fs.existsSync(path.join(root, ".e2e/node_modules/playwright"))
  );
}

/**
 * Install the harness's own dependencies and a browser to drive.
 *
 * Shipping the files is not shipping a working harness: without this the first thing a user runs
 * fails on a missing module, which reads as "bearing installed something broken" rather than "two
 * more commands to go". Doing it for them is the difference between a module people try and one
 * they abandon at the first error.
 *
 * NEVER silently: it downloads a browser (~150MB) into their repo, so every caller asks first. It
 * is also idempotent — an existing node_modules means there is nothing to do (NS-3).
 *
 * @param {string} root @returns {{ok: boolean, why: string}}
 */
export function bootstrapE2e(root) {
  const dir = path.join(root, ".e2e");
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    return { ok: false, why: "no .e2e/package.json — the module is not installed here" };
  }
  const run = (cmd, args) =>
    spawnSync(cmd, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });

  const install = run("npm", ["install", "--no-audit", "--no-fund"]);
  if (install.status !== 0) {
    return { ok: false, why: `npm install failed in .e2e/ (exit ${install.status ?? "spawn error"})` };
  }
  // Chromium only. The harness drives one browser and every extra engine is another few hundred
  // megabytes for a capability nothing here uses.
  const browser = run("npx", ["--yes", "playwright", "install", "chromium"]);
  if (browser.status !== 0) {
    return {
      ok: false,
      // Deps ARE installed at this point, so say what is actually left rather than implying the
      // whole thing failed (NS-20).
      why: `dependencies installed, but the browser download failed (exit ${browser.status ?? "spawn error"}) — run 'npx playwright install chromium' in .e2e/`,
    };
  }
  return { ok: true, why: "playwright + chromium ready" };
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
  // Without the gitnexus module there is no indexer, so there is no index to report on. This row
  // used to say "built" for intel-only repos — claiming graph work happened in a repo that has no
  // graph, which is exactly the impression the feature split exists to remove (NS-13).
  const hasGraph = !indexState.features || indexState.features.has("gitnexus");
  const indexValue = !hasGraph
    ? "n/a (gitnexus module not installed)"
    : indexState.setupSkipped
      ? "not changed (--no-setup)"
      : indexState.quick
        ? "skipped (--quick)"
        : "built";
  const indexStatus = !hasGraph
    ? "info"
    : indexState.setupSkipped || indexState.quick
      ? "warn"
      : "ok";
  // Never head the summary "complete" when a post-condition failed — the headline is the part a
  // user actually reads, and a green one directly contradicts the warnings printed just above it.
  const nFailed = indexState.failedChecks ?? 0;
  // Say plainly when the diff is landing somewhere unexpected.
  const branchNow = currentBranch(absTarget);
  const branchDefault = defaultBranch(absTarget);
  const branchOdd = Boolean(branchNow && branchDefault && branchNow !== branchDefault);
  const branchLabel = branchNow
    ? branchOdd
      ? `${branchNow} — NOT ${branchDefault}; this diff lands here`
      : branchNow
    : "(detached)";

  summaryTable({
    title: nFailed
      ? `${mode === "update" ? "Update" : "Install"} finished with ${nFailed} FAILED check${nFailed > 1 ? "s" : ""}`
      : `${mode === "update" ? "Update" : "Install"} complete`,
    rows: [
      { label: "Repository", value: repoName, status: "ok" },
      { label: "Runtime", value: runtime, status: "ok" },
      { label: "Path", value: absTarget, status: "info" },
      // WHICH BRANCH this just modified. An update writes ~60 files into the working tree and says
      // nothing about where they landed; run it with a feature branch checked out and the diff is
      // sitting on someone's in-progress work. That happened — 64 files, including a build
      // artifact, committed onto an active branch and pushed, because the only clue was a path
      // that looks identical on every branch.
      { label: "Branch", value: branchLabel, status: branchOdd ? "warn" : "info" },
      { label: "Index", value: indexValue, status: indexStatus },
    ],
  });

  const pre = [];
  const post = [];
  // Declared BEFORE the adapter loop that reads it — it used to sit below, and passing it into
  // nextSteps() put a const in its own temporal dead zone: the whole summary threw after the
  // install had already succeeded.
  const hasScripts = indexState.hasScripts ?? (!indexState.features || indexState.features.has("gitnexus"));
  for (const adapter of activeAdapters(runtime)) {
    const ns = adapter.nextSteps({
      repoName,
      features: indexState.features,
      mcpTransport: indexState.mcpTransport,
      // Adapters name npm scripts, and a stealth install has none. Without this each one goes on
      // recommending commands the repo cannot run (NS-20).
      hasScripts,
    });
    pre.push(...(ns.pre ?? []));
    post.push(...(ns.post ?? []));
  }
  // These npm scripts are installed by the gitnexus module. Listing them in a repo that declined
  // it is a first-run instruction that fails — the worst possible moment for it (NS-5).
  nextSteps([
    ...pre,
    ...(hasScripts
      ? [
          "npm run bearing:verify — full kit check",
          "npm run bearing:health — human-friendly status",
        ]
      : indexState.stealth && (!indexState.features || indexState.features.has("gitnexus"))
        ? [
            // Stealth installs the scripts but no npm aliases — adding those would edit
            // package.json, which is tracked, and the whole point is that nothing tracked moves.
            // The files are right there, so name the invocation that works rather than nothing.
            "node scripts/bearing-agent.mjs verify — full kit check",
            "node scripts/bearing-agent.mjs health — human-friendly status",
          ]
        : []),
    ...post,
    ...(hasScripts
      ? ["npm run bearing.__gate.1.session — agent gate docs in package.json"]
      : [
          // Stealth never writes CLAUDE.md — that file is tracked, and the whole point is that
          // nothing tracked moves. The contract is injected from .bearing/contract.md each session.
          indexState.stealth
            ? "Read .bearing/contract.md — the contract your agent now follows (injected per session, not written to CLAUDE.md)"
            : "Read CLAUDE.md / AGENTS.md — the contract your agent now follows",
        ]),
  ]);
  printWhatsNew(indexState.prevKitVersion, indexState.kitVersion);
  // Returned rather than only printed, so the CLI can OFFER it instead of leaving the user to
  // retype a command they just read. `manifest` is not in scope here — this prints the summary, it
  // does not build the record — so installKit does the attaching.
  return printNewModules(indexState.prevKitVersion, indexState.features).map((f) => f.id);
}

/**
 * Modules that did not exist the last time this repo was updated, and are still not enabled.
 *
 * An opt-out module plus a silent update is a module nobody ever finds: `update` correctly inherits
 * the recorded feature set, so a new one can never appear on its own, and nothing else in the run
 * mentions it. The changelog line above says a release happened; this says what is now AVAILABLE
 * and the exact command to take it.
 *
 * Shown on the ONE update that crosses the introducing version — `versionsSince` returns the
 * releases actually being traversed, so a user who reads this and declines is not asked again. A
 * fresh install prints nothing: there is no previous version, and the wizard already listed
 * everything.
 */
function printNewModules(prevVersion, features) {
  const md = readPackagedChangelog();
  if (!md || !prevVersion || !features) return [];
  const crossed = new Set(versionsSince(md, prevVersion).map((e) => e.version));
  const fresh = FEATURES.filter((f) => f.since && crossed.has(f.since) && !features.has(f.id));
  if (!fresh.length) return [];
  console.log(`\n  New since ${prevVersion} — available, not enabled`);
  for (const f of fresh) {
    console.log(`    ${f.title}`);
    console.log(`      ${f.why}`);
  }
  // Printed ONLY when there is nobody to ask. On a terminal the caller offers it directly, and a
  // command to copy next to a prompt asking the same question is just a second thing to read.
  // The delta form, because naming the full replacement list would be a command that silently
  // uninstalls whatever the reader forgets to retype.
  if (!process.stdin.isTTY) {
    console.log(`    Add with: bearing update . --features +${fresh.map((f) => f.id).join(",+")}`);
  }
  return fresh;
}

/**
 * What changed since the version this repo actually had. Nobody visits a changelog; everybody reads
 * the terminal they just typed into, and an update is the one moment the user is asking "what did
 * this just do to my repo?".
 *
 * Titles only, never the bodies — 1.0.7's section alone is 13k characters, and burying the next
 * steps under it would make the useful part unreadable.
 *
 * Silent unless it can be accurate: no previous version, an unknown one, no packaged CHANGELOG, or
 * nothing new all print nothing. An update must never fail because release notes could not be read
 * (NS-8), and inventing a range would be worse than saying nothing (NS-20).
 * @param {string|undefined} prevVersion @param {string} nowVersion
 */
function printWhatsNew(prevVersion, nowVersion) {
  if (!prevVersion || prevVersion === nowVersion) return;
  const md = readPackagedChangelog();
  if (!md) return;
  const entries = versionsSince(md, prevVersion);
  if (!entries.length) return;
  console.log(`\n  What's new since ${prevVersion}`);
  // Oldest first: it reads as the path from where they were to where they are.
  for (const e of [...entries].reverse()) {
    console.log(`    ${e.version}${e.title ? ` — ${e.title}` : ""}`);
  }
  console.log(`    Full notes: ${RELEASES_URL}`);
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

/**
 * Reconstruct install settings from a repo where bearing is COMMITTED but the manifest is not —
 * a fresh clone, which gitignores `.bearing/manifest.json` by design.
 *
 * Derived from what is actually on disk rather than guessed: a runtime counts only if ITS bearing
 * artifacts are there, and a feature only if the file that feature installs is there. Anything it
 * cannot see, it does not claim — the caller then keeps bearing's defaults for that field, which is
 * the same thing a re-install would do.
 * @param {string} root
 */
export function inferInstallFromDisk(root) {
  const has = (rel) => fs.existsSync(path.join(root, rel));
  const anyIn = (dir, prefix) => {
    try {
      return fs.readdirSync(path.join(root, dir)).some((f) => f.startsWith(prefix));
    } catch {
      return false;
    }
  };
  const runtimes = [];
  if (anyIn(".claude/hooks", "bearing-")) runtimes.push("claude");
  if (anyIn(".cursor/hooks", "bearing-") || has(".cursor/rules/00-bearing-enforcement.mdc")) {
    runtimes.push("cursor");
  }
  if (anyIn(".agents/skills", "bearing-")) runtimes.push("zed");
  if (has(".codex/AGENTS.md") || anyIn(".codex", "bearing")) runtimes.push("codex");

  const skill = (name) =>
    has(`.bearing/skills/${name}`) || has(`.claude/skills/${name}`) || has(`.agents/skills/${name}`);
  const features = [];
  if (has(".bearing/northstars.md") || anyIn(".claude/hooks", "bearing-northstar")) {
    features.push("northstars");
  }
  if (skill("bearing-taskcore")) features.push("taskcore");
  if (skill("bearing-microscope")) features.push("microscope");
  if (skill("bearing-consult")) features.push("consult");
  if (skill("bearing-minions")) features.push("minions");
  if (has(".mcp.json") || has(".bearing/lib/gitnexus-cmd.mjs")) features.push("gitnexus");

  return {
    repoName: path.basename(root),
    runtime: runtimes.length ? runtimes.join(",") : undefined,
    features: features.length ? features : undefined,
  };
}

/** @param {string} targetRoot */
export function updateKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const prev = readManifest(absTarget);
  // THE MANIFEST IS GITIGNORED, so a fresh clone of a repo with bearing COMMITTED has none — and
  // that is the ordinary team case, not an edge case: a teammate clones, runs `bearing update`, and
  // was told "Not installed. Run install first." while 60 tracked files sat under `.bearing/`.
  // Install would then re-derive runtime and features instead of preserving the team's choices.
  //
  // `hasSharedInstall` already answered this by asking git's index rather than the manifest — it
  // even says so in its own comment. It just was not wired in here.
  const base = prev?.data ?? (hasSharedInstall(absTarget) ? inferInstallFromDisk(absTarget) : null);
  if (!base) {
    throw new Error(
      `Not installed (missing ${MANIFEST_PATH}, and no tracked .bearing/lib). Run install first.`,
    );
  }
  return installKit(absTarget, {
    repoName: opts.repoName ?? base.repoName,
    runtime: opts.runtime ?? base.runtime,
    // Was omitted, so `bearing update --features …` silently kept the old set. The delta form
    // (`+e2e`) resolves HERE because this is the only place that knows the current selection —
    // installKit sees a finished list and cannot tell an addition from a replacement.
    features: applyFeatureDelta(opts.features, base.features) ?? base.features?.join(","),
      mcpTransport: opts.mcpTransport ?? base.mcpTransport,
      gitnexusCmd: opts.gitnexusCmd ?? base.gitnexusCmd,
    quick: opts.quick ?? true,
    // Undefined inherits the recorded answer; --prettierignore / --no-prettierignore change it.
    prettierIgnore: opts.prettierIgnore,
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
    // Legacy paths count as installed: discovery is how `update-all` finds repos, and repos
    // installed before the manifest moved are exactly the ones that most need the update.
    if (
      [MANIFEST_PATH, ...MANIFEST_PATHS_LEGACY].some((rel) =>
        fs.existsSync(path.join(dir, rel)),
      )
    ) {
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

  const restoredOnRemove = [];
  for (const rel of manifest.files ?? []) {
    const abs = path.join(absTarget, rel);
    try {
      // Install overwrites a colliding file of the user's after stashing the original beside it
      // (.githooks/pre-commit and .vscode/settings.json are ordinary user-owned paths). Deleting
      // ours without putting theirs back leaves a HOLE where their file was, with the content
      // stranded in a .bearing-backup they never asked for. Uninstall must leave the repo as it
      // found it (NS-1).
      const bak = `${abs}.bearing-backup`;
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, abs);
        fs.unlinkSync(bak);
        restoredOnRemove.push(rel);
      } else if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
    } catch {
      /* ignore */
    }
    pruneEmptyDirs(path.dirname(abs), absTarget);
  }
  for (const rel of restoredOnRemove) console.log(`  restored your original ${rel}`);

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
  // Kit-owned, and it lives here now — remove it BEFORE the keep-check below, or .bearing/ always
  // looks like it still holds a user file and the directory is never cleaned up.
  rmRf(path.join(absTarget, MANIFEST_PATH));
  // The persona is bearing's own construct: nothing else reads it, and it is meaningless once the
  // contract that consumes it is gone. Same reasoning as the manifest — created by us, removed by
  // us — unlike north-stars and task-core, which are the user's thinking and always survive.
  rmRf(path.join(absTarget, DOMAIN_PATH));
  for (const f of fs.readdirSync(path.join(absTarget, ".bearing")).filter((n) => /^\.bearing-|^\.gitnexus-/.test(n))) {
    try {
      fs.unlinkSync(path.join(absTarget, ".bearing", f));
    } catch {
      /* transient session state — best effort */
    }
  }
  // The task-core DIRECTORY is ours; the cores inside are the user's in-flight thinking, same as
  // the legacy single file. So: keep it when a chat's save-state is in it, remove it when it is
  // just the empty shell install created — otherwise uninstall always leaves a `.bearing/` behind
  // and the repo is no longer as we found it (NS-1).
  try {
    const coresDir = path.join(absTarget, ".bearing/task-cores");
    if (fs.readdirSync(coresDir).length === 0) fs.rmdirSync(coresDir);
  } catch {
    /* absent, or holds cores we are deliberately keeping */
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
  removePackageScripts(absTarget, manifest.npmScripts, {
    dropEngines: manifest.addedEngines === true,
  });

  // If WE created package.json, take it back — but only when nothing of theirs ended up in it.
  // Leaving `{"name":…,"scripts":{}}` in a Python repo makes npm, Dependabot and CI treat it as a
  // Node package, planted by a tool that has just been removed (NS-1, NS-22). Any key beyond the
  // shell we wrote means they adopted the file, and then it is theirs to keep.
  if (manifest.createdPackageJson === true) {
    const pkgPath = path.join(absTarget, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const ours = new Set(["name", "version", "private", "scripts", "engines"]);
      const theirs = Object.keys(pkg).filter((key) => !ours.has(key));
      const emptyScripts = Object.keys(pkg.scripts ?? {}).length === 0;
      if (!theirs.length && emptyScripts) {
        fs.unlinkSync(pkgPath);
        console.log("  removed package.json — bearing created it, and it held nothing else");
      } else {
        console.log(
          "  kept package.json — it has content beyond what bearing put there",
        );
      }
    } catch {
      /* unreadable or already gone — leave it */
    }
  }
  removeGitignoreSnippet(absTarget, manifest.createdGitignore === true);
  // Only touch .prettierignore if we ever wrote to it. A repo that declined has a file that is
  // entirely the user's, and "strip our block" on it would rewrite a file we never authored.
  if (manifest.prettierIgnore) {
    removePrettierIgnore(absTarget, manifest.createdPrettierIgnore === true);
  }
  // The stealth concealment goes back too, and NOT gated on manifest.stealth: it strips only our
  // marked block and leaves anything the user put there, so calling it always is safe and also
  // covers a repo whose manifest predates the flag. Leaving it was the worst part of the defect —
  // the leftovers stayed invisible, so `git status` came back clean and the user concluded bearing
  // was gone while its hooks were still registered.
  removeExclude(absTarget);


  for (const adapter of activeAdapters(runtime)) {
    // One adapter must never be able to strand the others. A throw here previously aborted the
    // whole uninstall partway through, leaving hooks registered against deleted files.
    try {
      adapter.unwire(absTarget, manifest);
    } catch (e) {
      console.log(`  ! ${adapter.id}: cleanup incomplete (${e.message})`);
    }
  }

  for (const p of [
    MANIFEST_PATH,
    ...MANIFEST_PATHS_LEGACY,
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

  // .claude was missing from this list, so a Claude install always left an empty .claude/ behind
  // once its hooks, skills and settings were gone. Every one of these is rmdir-only.
  pruneEmptyDirs(path.join(absTarget, ".cursor"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".agents"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".zed"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".claude"), absTarget);
  // Older installs parked the manifest under .gitnexus/; in an intel-only repo that directory now
  // holds nothing else. Prune only if empty, so a real index survives (NS-1).
  pruneEmptyDirs(path.join(absTarget, ".gitnexus"), absTarget);
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

/**
 * Split `<cmd> [target] [...flags]`, knowing that A FLAG IS NEVER A TARGET.
 *
 * `bearing install --stealth` reads as "install here, stealthily" — the flag was taken as the path
 * instead, so it died with `Not a git repository: /cwd/--stealth`: a path the user never typed,
 * naming a mistake they did not make. Worse, the eaten flag then vanished — `install --runtime
 * claude` lost the runtime too, because `--runtime` was consumed as the target and no longer
 * appeared in the list the parser searches.
 *
 * A leading `-` is enough to decide; no flag bearing takes is a plausible path.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const [cmd, maybeTarget, ...restArgs] = argv;
  const targetIsFlag = typeof maybeTarget === "string" && maybeTarget.startsWith("-");
  return {
    cmd,
    target: targetIsFlag ? undefined : maybeTarget,
    rest: targetIsFlag ? [maybeTarget, ...restArgs] : restArgs,
  };
}

/**
 * A yes/no on a terminal. Defaults to NO: everything this gates is something that writes to the
 * user's repo or pulls a large download, and a bare Enter must never be the answer that does that.
 * @param {string} question @param {string} detail
 */
async function confirm(question, detail) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question(`\n  ${question}${detail ? `\n  ${detail}` : ""}\n  [y/N] `);
    return /^y(es)?$/i.test(ans.trim());
  } catch {
    // EOF or Ctrl+C. The install or update has ALREADY SUCCEEDED by the time anything asks a
    // question, so a closed stdin must read as "no thanks" and leave the run green — reporting a
    // failure here would blame the whole operation for an unanswered optional extra (NS-8).
    return false;
  } finally {
    rl.close();
  }
}

/**
 * Make an installed e2e harness actually runnable, or say exactly what is left.
 *
 * Ten files and no `node_modules` is not a harness — the first command a user tries dies on a
 * missing module, which reads as a broken install. Asked, never assumed, because the fix downloads
 * a browser; and silent on a non-TTY, where the next-steps lines already carry the two commands.
 */
async function finishE2e(target, manifest, opts) {
  const root = path.resolve(target);
  if (!manifest?.features?.includes("e2e") || !e2eNeedsDeps(root)) return;
  if (!process.stdin.isTTY || opts?.runSetup === false) {
    console.log(
      `\n  The e2e harness needs its dependencies before it can run:` +
        `\n    cd .e2e && npm install && npx playwright install chromium` +
        `\n    node .e2e/verify/smoke.js   # then this should pass\n`,
    );
    return;
  }
  const yes = await confirm(
    "Set up the e2e harness now?",
    "runs npm install in .e2e/ and downloads chromium (~150MB)",
  );
  if (!yes) {
    console.log(`\n  Later:  cd .e2e && npm install && npx playwright install chromium\n`);
    return;
  }
  const r = bootstrapE2e(root);
  console.log(
    r.ok
      ? `\n  ✓ e2e harness ready — try:  node .e2e/verify/smoke.js\n`
      : `\n  ! ${r.why}\n`,
  );
}

export async function cliMain(argv, invokedAs = "node lib/kit.mjs") {
  // `target` is reassigned below: `update` with no path resolves to the current repo.
  // eslint-disable-next-line prefer-const
  let { cmd, target, rest } = parseCliArgs(argv);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const repoIdx = rest.indexOf("--repo-name");
  const runtimeIdx = rest.indexOf("--runtime");
  const featuresIdx = rest.indexOf("--features");
  const featuresFlag =
    featuresIdx >= 0 ? rest[featuresIdx + 1] : process.env.GNKIT_FEATURES;
  // --mcp http | stdio | <port> | <url>. Omitted means "inherit what this repo already chose",
  // which on a first install is stdio — the zero-config default that needs no daemon.
  const gnCmdIdx = rest.indexOf("--gitnexus-cmd");
  const gitnexusCmd = gnCmdIdx >= 0 ? rest[gnCmdIdx + 1] : process.env.BEARING_GITNEXUS_CMD;
  const mcpIdx = rest.indexOf("--mcp");
  const mcpTransport = mcpIdx >= 0 ? rest[mcpIdx + 1] : process.env.BEARING_MCP;
  const repoName =
    repoIdx >= 0 ? rest[repoIdx + 1] : process.env.GITNEXUS_REPO_NAME;
  const runtime =
    runtimeIdx >= 0 ? rest[runtimeIdx + 1] : process.env.GITNEXUS_RUNTIME;
  const fullIndex = flags.has("--full");
  const quick = cmd === "update" ? !fullIndex : flags.has("--quick");
  const noSetup = flags.has("--no-setup");
  const skipVerify = flags.has("--skip-verify");
  const removeIndex = flags.has("--remove-index");
  const stealth = flags.has("--stealth");
  const interactive =
    flags.has("--interactive") || (!target && cmd === "install");

  // `--version` answered "Missing target repo path", which is the one reply that cannot be right:
  // it is not a question about a repo. The first thing anyone asks a CLI it should be able to say.
  if (cmd === "--version" || cmd === "-v") {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8"),
    );
    console.log(pkg.version);
    process.exit(0);
  }

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`Usage:
  ${invokedAs} install <target-repo> [--runtime zed|claude|codex|all] [--features ${FEATURE_IDS.join(",")}|all] [--repo-name NAME] [--stealth] [--mcp http|stdio|PORT] [--gitnexus-cmd CMD] [--quick] [--no-setup] [--skip-verify] [--prettierignore|--no-prettierignore] [--test-order|--no-test-order]
  ${invokedAs} install --interactive
  ${invokedAs} update <target-repo> [--runtime ...] [--features +e2e|-minions|<list>] [--full] [--no-setup] [--skip-verify]
  ${invokedAs} update-all <search-root> [--runtime ...] [--no-setup] [--skip-verify]
  ${invokedAs} uninstall <target-repo> [--remove-index]

  Stealth: install for YOU only — nothing tracked changes, ignores go in .git/info/exclude (per-clone,
           never pushed), and the contract is injected per session instead of written to CLAUDE.md.
  MCP:     http (one shared server for every repo on this machine) | stdio (a child process per client)
           | a bare PORT. Omitted = keep whatever this repo already chose.

  Runtime: claude (hooks + MCP + skills + CLAUDE.md — the only one that ENFORCES) · zed (MCP + skills
           + profile) · codex (contract only) · all = zed+claude+codex · or a comma list e.g. "zed,claude"
  update defaults to --quick (bundle + skills, skip index). Pass --full to rebuild .gitnexus/
  update-all scans for ${MANIFEST_PATH} under the search root.`);
    process.exit(cmd ? 0 : 2);
  }

  if (interactive && cmd === "install") {
    // Forward the flags. Without this the wizard could not see `--stealth`, so the one invocation
    // people actually type for it — `npx bearing --stealth`, no path — silently installed a normal,
    // committed kit into a repo they had chosen precisely because they must not commit to it.
    const r = spawnSync(
      process.execPath,
      [path.join(KIT_ROOT, "lib/interactive.mjs"), ...rest],
      { stdio: "inherit" },
    );
    if (r.status) process.exitCode = r.status;
    return;
  }

  if (!target) {
    // `bearing update` with no argument means THIS repo. Standing in an installed repo and being
    // told "Missing target repo path. Use: install <path>" is wrong twice over: the intent is
    // obvious, and the guidance names a different verb than the one that was typed.
    if ((cmd === "update" || cmd === "uninstall") && readManifest(process.cwd())) {
      target = process.cwd();
    } else if (cmd === "update") {
      // Not an installed repo. Rather than refuse, look for the ones that ARE — most people who
      // land here are one directory away from what they meant.
      const found = findInstalledRepos(process.cwd());
      if (found.length === 1) {
        console.error(
          `Not a ${KIT_NAME} repo. One install found below here:\n  ${found[0]}\n` +
            `Run: ${KIT_NAME} update ${found[0]}`,
        );
      } else if (found.length > 1) {
        console.error(
          `Not a ${KIT_NAME} repo. ${found.length} installs found below here:\n` +
            found.map((r) => `  ${r}`).join("\n") +
            `\n\nUpdate one: ${KIT_NAME} update <path>\n` +
            `Update all:  ${KIT_NAME} update-all .`,
        );
      } else {
        console.error(
          `Not a ${KIT_NAME} repo, and no installs found below ${process.cwd()}.\n` +
            `Update a specific repo: ${KIT_NAME} update <path>\n` +
            `Install here:           ${KIT_NAME} install .`,
        );
      }
      process.exit(2);
    } else {
      console.error(
        `Missing target repo path. Use: ${KIT_NAME} ${cmd} <path> or ${KIT_NAME} ${cmd} --interactive`,
      );
      process.exit(2);
    }
  }

  // NO --runtime FLAG on a fresh install? Look before defaulting.
  //
  // The silent default is `both` — cursor+zed — which covers Claude Code not at all. A user
  // installed for zed, worked in Claude Code, and their agent correctly reported two modules as
  // unavailable: a zed install writes no `.claude/` anything. Nobody had been asked, and nothing
  // had looked at the evidence sitting in the environment.
  //
  // Ask when there is a human to ask. Detect when there is not. Never choose in silence.
  let resolvedRuntime = runtime;
  if (!resolvedRuntime && cmd === "install" && !interactive) {
    const detected = detectRuntimes(target);
    if (detected.length) {
      resolvedRuntime = detected.join(",");
      ok(`Runtime: ${resolvedRuntime} — ${detectionReason(detected)}`);
      console.log(`    Not right? Re-run with --runtime zed|claude|codex|all`);
    } else if (process.stdin.isTTY) {
      resolvedRuntime = await pickRuntimeInteractive();
    } else {
      warn(
        `No agent environment detected and no TTY to ask — installing for "both" (zed+claude).\n` +
          // Name a case, offer the command that serves it. This used to say "If you use Claude Code
          // or Codex" and hand `--runtime claude` — followed literally, a codex user installs for
          // Claude and never receives codex's own contract, which is a different document (57 lines
          // rather than 487, because codex has no tool interception and the gates are advisory).
          `    Claude Code: ${KIT_NAME} update ${target} --runtime claude\n` +
          `    Codex:       ${KIT_NAME} update ${target} --runtime codex\n` +
          `    Both:        ${KIT_NAME} update ${target} --runtime claude,codex`,
      );
    }
  }

  const opts = {
    repoName,
    runtime: resolvedRuntime ? parseRuntime(resolvedRuntime) : undefined,
    features: featuresFlag,
      mcpTransport,
      gitnexusCmd,
    quick,
    runSetup: !noSetup,
    removeIndex,
    stealth,
    // Tri-state on purpose: undefined means "nobody said", which on update inherits the recorded
    // answer instead of silently reverting it to no.
    prettierIgnore: flags.has("--prettierignore")
      ? true
      : flags.has("--no-prettierignore")
        ? false
        : undefined,
    testOrder: flags.has("--test-order")
      ? true
      : flags.has("--no-test-order")
        ? false
        : undefined,
    cli: true,
    skipVerify,
  };

  if (cmd === "install") {
    const m = installKit(target, opts);
    await finishE2e(target, m, opts);
    return;
  }
  if (cmd === "update") {
    let m = updateKit(target, opts);
    // A module the user has just been told about, on a terminal, one keystroke away. Without this
    // the flow is: read a notice, retype a command, then run two more to make it work — four steps
    // to try one thing, which is how an opt-in module stays permanently un-tried.
    if (m?.newModules?.length && process.stdin.isTTY) {
      const ids = m.newModules;
      const yes = await confirm(
        `Enable ${ids.join(" + ")} now?`,
        "installs it and sets up its dependencies — for e2e that is a ~150MB browser download",
      );
      if (yes) m = updateKit(target, { ...opts, features: ids.map((i) => `+${i}`).join(",") });
    }
    await finishE2e(target, m, opts);
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

// Compare REAL paths. `import.meta.url` is always fully resolved, while argv[1] is whatever the
// caller typed — so any symlink on the way in made these differ and the CLI silently did nothing
// and exited 0. macOS makes that the common case, not the exotic one: /tmp is a link to
// /private/tmp, so `node /tmp/checkout/lib/kit.mjs install …` looked like a successful install
// that had installed nothing. An installer that no-ops without a word is the worst failure it has.
const realOrSelf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const isMain =
  process.argv[1] &&
  realOrSelf(fileURLToPath(import.meta.url)) === realOrSelf(process.argv[1]);
if (isMain) {
  // "Not a git repository" is a fact the user needs, not a crash they need to read a stack trace
  // for. Rejections count too: cliMain is sync but hands back a promise for the async commands, so
  // a throw inside install surfaced as an unhandled rejection.
  const fail = (e) => {
    console.error(`\n✗ ${e?.message ?? e}`);
    // A stack is noise for the expected failures above and the only useful thing for a real bug, so
    // it stays one env var away rather than gone.
    if (process.env.BEARING_DEBUG) console.error(e?.stack ?? "");
    else console.error("  (BEARING_DEBUG=1 for the stack trace)");
    process.exitCode = 1;
  };
  try {
    const r = cliMain(process.argv.slice(2));
    if (r && typeof r.then === "function") r.then(undefined, fail);
  } catch (e) {
    fail(e);
  }
}
