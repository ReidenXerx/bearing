/**
 * Migrate legacy cursor-gitnexus-kit and gitnexus-agent-kit installs → the current bearing layout.
 * Safe to run on every install/update (idempotent).
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT } from "./kit-shared.mjs";
import {
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  MANIFEST_PATHS_LEGACY,
  GITIGNORE_MARKER,
  GITIGNORE_MARKER_LEGACY,
  ZED_PROFILE_KEY,
  SKILLS_STORE,
  parseRuntime,
  wantsCursor,
  wantsZed,
} from "./constants.mjs";
import { listSkillNames } from "./skills.mjs";
import { removeZedSettings } from "./adapters/zed.mjs";
/** @typedef {{ actions: string[], legacyManifest: object|null, runtime: import('./constants.mjs').Runtime }} MigrateResult */

/**
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 */
export function migrateLegacyInstall(absTarget, runtime) {
  const actions = [];
  // Failures must NOT ride in `actions` — the installer renders those with a green checkmark and
  // truncates the list, so a failed north-stars move could display as a success or disappear.
  const failures = [];
  const legacyManifest = readAnyManifest(absTarget);
  // Prefer the caller-resolved runtime so update --runtime both can upgrade
  // older cursor-only or zed-only installs instead of being pinned by manifest data.
  const rt = parseRuntime(runtime);

  migrateGnkitDir(absTarget, actions, failures);
  clearRetiredSkillLinks(absTarget, actions);
  repairHooksComment(absTarget, actions);
  migrateBearingFileNames(absTarget, actions, failures);
  cleanupLegacyHookFiles(absTarget, actions);
  migrateGitignore(absTarget, actions);
  cleanupLegacySkills(absTarget, rt, actions);
  cleanupLegacyClaudeSkills(absTarget, actions);
  cleanupLegacyHookLib(absTarget, actions);
  if (!wantsZed(rt)) cleanupOrphanedZed(absTarget, actions);
  migrateZedProfileKey(absTarget, actions);
  cleanupLegacyManifestFile(absTarget, actions);
  // Last: cleanupLegacyManifestFile drops the Cursor-era file when both exist, so by here the
  // only legacy manifest still standing is one genuinely worth moving.
  migrateManifestPath(absTarget, actions, failures);

  if (legacyManifest?.files?.length) {
    cleanupOrphanKitFiles(absTarget, legacyManifest.files, actions);
  }

  return { actions, failures, legacyManifest, runtime: rt };
}

/**
 * `.gnkit/` -> `.bearing/` (the kit was renamed from gitnexus-agent-kit to bearing).
 *
 * This directory is NOT disposable: it holds the user's north-stars, their task-core, the shared
 * hook config and any per-machine override. Re-creating it empty would silently destroy the
 * semantic anchor an installed repo depends on, so MOVE it rather than let the copy step make a
 * fresh one beside it. If both exist (a partial upgrade), keep the new one and leave the old in
 * place rather than guessing which is authoritative.
 * @param {string} absTarget @param {string[]} actions
 */
function migrateGnkitDir(absTarget, actions, failures) {
  const legacy = path.join(absTarget, ".gnkit");
  const next = path.join(absTarget, ".bearing");
  if (!fs.existsSync(legacy)) return;
  if (fs.existsSync(next)) {
    actions.push("gnkit: BOTH .gnkit/ and .bearing/ exist — left .gnkit/ untouched, review manually");
    return;
  }
  try {
    fs.renameSync(legacy, next);
    repointManifestPaths(absTarget, actions);
    actions.push("gnkit: moved .gnkit/ -> .bearing/ (kit renamed; north-stars + task-core preserved)");
  } catch {
    // Cross-device or permission failure — copy then remove, so the data still survives.
    try {
      fs.cpSync(legacy, next, { recursive: true });
      fs.rmSync(legacy, { recursive: true, force: true });
      repointManifestPaths(absTarget, actions);
      actions.push("gnkit: copied .gnkit/ -> .bearing/ (rename failed; contents preserved)");
    } catch {
      failures.push("gnkit: FAILED to move .gnkit/ -> .bearing/ — move it manually to keep north-stars");
    }
  }
}

/**
 * Re-sync the `comment` in `.bearing/hooks.json` — and ONLY the comment.
 *
 * That file is SEED-ONCE: written at install and never overwritten, because it is team-shared
 * config a user edits and an update must not clobber. That protects their SETTINGS. It also freezes
 * OUR DOCUMENTATION, and the documentation went stale twice.
 *
 * Reported from a real install: the comment told the reader to create
 * `.gnkit/gitnexus-hooks.local.json` — a path from two renames ago — while the code reads
 * `.bearing/hooks.local.json` (hook-helpers.mjs LOCAL_CONFIG_FILE). Following the instruction
 * creates a file NOTHING READS, which fails silently, the worst outcome a config override has. The
 * same vintage worked-examples `"contextWindowTokens": 1000000`, a key NS-19 retired: follow it and
 * you set something that does nothing.
 *
 * Neither could be fixed by `bearing update`, because seed-once means the corrected bundle file
 * never lands. So repair the prose in place and leave every setting exactly as found — the comment
 * is ours, the values are theirs.
 * @param {string} absTarget @param {string[]} actions
 */
function repairHooksComment(absTarget, actions) {
  const rel = ".bearing/hooks.json";
  const target = path.join(absTarget, rel);
  const source = path.join(BUNDLE_ROOT, rel);
  let mine;
  let current;
  try {
    mine = JSON.parse(fs.readFileSync(source, "utf8")).comment;
    current = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return; // no hooks.json here, or it is not ours to reason about
  }
  if (!mine || typeof current !== "object" || current === null) return;
  const old = typeof current.comment === "string" ? current.comment : "";
  if (old === mine) return;

  // Only rewrite prose that is demonstrably STALE. A user who rewrote the comment for their own
  // team has said something we should not overwrite (NS-1); a comment naming a dead path or a
  // retired setting is ours and is wrong.
  const stale = [
    ".gnkit",
    "gitnexus-hooks.local.json",
    "contextWindowTokens",
    "contextPressureThreshold",
    "contextCheckpointEvery",
    "GITNEXUS_CONTEXT_WINDOW",
  ].some((needle) => old.includes(needle));
  if (!stale) return;

  // Rebuild with `comment` first so the file keeps its shape, then every existing key untouched.
  const next = { comment: mine };
  for (const [k, v] of Object.entries(current)) if (k !== "comment") next[k] = v;
  try {
    fs.writeFileSync(target, JSON.stringify(next, null, 2) + "\n");
    actions.push("hooks: repointed hooks.json comment at .bearing/hooks.local.json (settings untouched)");
  } catch {
    /* an unrepaired comment is misleading, not fatal */
  }
}

/**
 * Drop skill symlinks that still name a kit directory bearing has since renamed.
 *
 * The kit dir moved twice — `.gitnexus/agent-kit/` -> `.gnkit/` -> `.bearing/` — and each migration
 * moved the CONTENT while leaving the symlinks that pointed into it. They are not inert:
 * `fs.mkdir(p, { recursive: true })` through a dangling symlink throws ENOENT, so the graph
 * analyzer could not install its own skills into `.claude/skills/` and emitted six "Could not
 * install skill" warnings on every single run — in a log nobody reads. Counted across five real
 * repos before this: 313 of them.
 *
 * Only OUR retired layouts, and only when the link is genuinely broken. A dangling link some other
 * tool left is not bearing's to delete (NS-1), and a live link is not broken.
 * @param {string} absTarget @param {string[]} actions
 */
const RETIRED_LINK_TARGETS = [".gnkit/", ".gitnexus/agent-kit/"];

function clearRetiredSkillLinks(absTarget, actions) {
  let removed = 0;
  for (const dir of [".claude/skills", ".cursor/skills", ".agents/skills"]) {
    const abs = path.join(absTarget, dir);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // this runtime was never installed here
    }
    for (const e of entries) {
      if (!e.isSymbolicLink()) continue;
      const link = path.join(abs, e.name);
      let target;
      try {
        target = fs.readlinkSync(link);
      } catch {
        continue;
      }
      if (!RETIRED_LINK_TARGETS.some((t) => target.includes(t))) continue;
      if (fs.existsSync(link)) continue; // resolves — the old layout is somehow still there
      try {
        fs.unlinkSync(link);
        removed++;
      } catch {
        /* a link we cannot remove is a warning, not a failed migration */
      }
    }
  }
  if (removed) {
    actions.push(`skills: removed ${removed} dead symlink(s) pointing at a retired kit layout`);
  }
}

/**
 * Point the recorded file list at the directory the files now live in.
 *
 * The manifest lists what the kit installed, and install treats anything NOT on that list as the
 * user's — backing it up before overwriting. After `.gnkit/` becomes `.bearing/` the files have
 * moved but the list still says `.gnkit/…`, so every single one of bearing's own lib files looked
 * like a user file: one upgrade produced 25-60 `.bearing-backup` copies per repo.
 *
 * That is worse than clutter. Uninstall RESTORES from a `.bearing-backup` instead of deleting,
 * so those spurious copies would make an uninstall put bearing's own old modules back and leave
 * the repo dirtier than it found it — the exact property uninstall is supposed to guarantee.
 * @param {string} absTarget @param {string[]} actions
 */
function repointManifestPaths(absTarget, actions) {
  for (const rel of [MANIFEST_PATH, ...MANIFEST_PATHS_LEGACY]) {
    const p = path.join(absTarget, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!Array.isArray(m.files)) return;
      const before = m.files.filter((f) => f.startsWith(".gnkit/")).length;
      if (!before) return;
      m.files = m.files.map((f) => (f.startsWith(".gnkit/") ? `.bearing/${f.slice(7)}` : f));
      fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
      actions.push(`manifest: repointed ${before} file paths .gnkit/ -> .bearing/`);
    } catch {
      /* unreadable manifest → install falls back to treating them as the user's, which is safe */
    }
    return;
  }
}

/**
 * Data + config files inside .bearing/ dropped their `gitnexus-` prefix when the kit was renamed.
 * Two of these are USER CONTENT — the north-stars (the semantic anchor) and the in-flight task-core
 * — and one is a per-machine override that is gitignored, so it exists on exactly one machine and
 * cannot be recovered from git. Renaming the reader without moving the file would make all three
 * silently "not exist": no error, just an agent that quietly stops being anchored.
 * @param {string} absTarget @param {string[]} actions
 */
function migrateBearingFileNames(absTarget, actions, failures) {
  const dir = path.join(absTarget, ".bearing");
  if (!fs.existsSync(dir)) return;
  const renames = [
    ["gitnexus-northstars.md", "northstars.md"],
    // Also accept the intermediate name, in case an install landed mid-rename.
    ["bearing-northstars.md", "northstars.md"],
    ["gitnexus-hooks.json", "hooks.json"],
    ["gitnexus-hooks.local.json", "hooks.local.json"],
    [".gitnexus-task-core.md", ".task-core.md"],
  ];
  for (const [from, to] of renames) {
    const src = path.join(dir, from);
    const dst = path.join(dir, to);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.renameSync(src, dst);
      actions.push(`bearing: ${from} -> ${to}`);
    } catch {
      failures.push(`bearing: FAILED to rename ${from} -> ${to} — move it manually`);
    }
  }
}

/**
 * Hook FILES renamed gitnexus-* -> bearing-*. The copy step writes the new ones but never removes
 * the old, so an upgraded repo keeps a full set of orphans. They are unwired (settings.json is
 * rewritten to the new names), so nothing misfires — but they are dead files that look live to
 * anyone reading the directory, and a stale settings.json elsewhere could still resolve them.
 * @param {string} absTarget @param {string[]} actions
 */
function cleanupLegacyHookFiles(absTarget, actions) {
  let removed = 0;
  for (const dir of [".claude/hooks", ".cursor/hooks"]) {
    const abs = path.join(absTarget, dir);
    let entries = [];
    try {
      entries = fs.readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith("gitnexus-")) continue;
      // Only remove it if the CURRENT BUNDLE supersedes it. Checking the target directory instead
      // would be wrong: migration runs BEFORE the copy step, so the replacement is not there yet —
      // that ordering made this a no-op on first run and required a second update to take effect.
      const replacement = name.replace(/^gitnexus-/, "bearing-");
      if (!fs.existsSync(path.join(BUNDLE_ROOT, dir, replacement))) continue;
      try {
        fs.unlinkSync(path.join(abs, name));
        removed++;
      } catch {
        /* best effort */
      }
    }
  }
  if (removed) actions.push(`hooks: removed ${removed} legacy gitnexus-* hook file(s)`);
}

/** @param {string} absTarget */
function readAnyManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, ...MANIFEST_PATHS_LEGACY]) {
    const p = path.join(absTarget, rel);
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/** @param {string} absTarget @param {string[]} actions */
function migrateGitignore(absTarget, actions) {
  const gi = path.join(absTarget, ".gitignore");
  if (!fs.existsSync(gi)) return;
  let text = fs.readFileSync(gi, "utf8");
  if (!text.includes(GITIGNORE_MARKER_LEGACY)) return;
  text = text.split(GITIGNORE_MARKER_LEGACY).join(GITIGNORE_MARKER);
  // Point at a command that still exists. This rewrote one dead name into another (`gn-agent-kit`
  // has not been a binary since the rename), so the managed block told the user to run something
  // that would 404 (NS-6). Both historical spellings collapse to the current one.
  text = text.replace(
    /\(safe to remove via gn-(agent-)?kit uninstall\)/g,
    "(safe to remove via bearing-uninstall)",
  );
  fs.writeFileSync(gi, text);
  actions.push("gitignore: migrated legacy kit marker");
}

/**
 * Remove old rsync'd skill trees before symlinking from canonical store.
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {string[]} actions
 */
function cleanupLegacySkills(absTarget, runtime, actions) {
  const canonical = listSkillNames(path.join(BUNDLE_ROOT, "skills"));
  const store = path.join(absTarget, SKILLS_STORE);

  /** @param {string} p */
  function dropSkillPath(p) {
    if (!fs.existsSync(p)) return;
    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
      else fs.rmSync(p, { recursive: true, force: true });
      actions.push(
        `skills: removed legacy copy ${path.relative(absTarget, p)}`,
      );
    } catch {
      /* ignore */
    }
  }

  if (wantsCursor(runtime)) {
    const nested = path.join(absTarget, ".cursor/skills/gitnexus");
    if (fs.existsSync(nested)) {
      dropSkillPath(nested);
    }
    for (const name of canonical) {
      dropSkillPath(path.join(absTarget, ".cursor/skills", name));
    }
    dropSkillPath(path.join(absTarget, ".cursor/skills/generated"));
  }

  if (wantsZed(runtime)) {
    for (const name of canonical) {
      dropSkillPath(path.join(absTarget, ".agents/skills", name));
    }
  }

  // If store exists but is an old nested layout, wipe before materialize refreshes it
  const oldNested = path.join(store, "gitnexus");
  if (fs.existsSync(oldNested)) {
    try {
      fs.rmSync(store, { recursive: true, force: true });
      actions.push("skills: cleared legacy nested store layout");
    } catch {
      /* ignore */
    }
  }
}

/** @param {string} absTarget @param {string[]} actions */
function cleanupLegacyClaudeSkills(absTarget, actions) {
  const claudeRoot = path.join(absTarget, ".claude/skills");
  if (!fs.existsSync(claudeRoot)) return;
  const kitNames = new Set([
    "gitnexus",
    "bearing-workspace",
    "bearing-enforcement",
    ...listSkillNames(path.join(BUNDLE_ROOT, "skills")),
  ]);
  for (const ent of fs.readdirSync(claudeRoot, { withFileTypes: true })) {
    if (!kitNames.has(ent.name)) continue;
    const p = path.join(claudeRoot, ent.name);
    try {
      if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
      actions.push(`skills: removed legacy .claude/skills/${ent.name}`);
    } catch {
      /* ignore */
    }
  }
  try {
    if (fs.readdirSync(claudeRoot).length === 0) {
      fs.rmdirSync(claudeRoot);
      actions.push("skills: removed empty .claude/skills/");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Pre-relocation installs kept the shared hook lib, policy config, and per-session
 * state under .cursor/. Those now live in the neutral .bearing/ namespace, so remove
 * the obsolete copies (they would otherwise sit orphaned next to the new ones).
 * @param {string} absTarget @param {string[]} actions
 */
function cleanupLegacyHookLib(absTarget, actions) {
  const legacyLib = path.join(absTarget, ".cursor/hooks/lib");
  if (fs.existsSync(legacyLib)) {
    try {
      fs.rmSync(legacyLib, { recursive: true, force: true });
      actions.push("hooks: removed legacy .cursor/hooks/lib (moved to .bearing/lib)");
    } catch {
      /* ignore */
    }
  }
  // Old skill-store location (moved to the tracked .bearing/skills so teammates get
  // skills via git). Held only the store; the manifest lives at .bearing/manifest.json.
  const legacyStore = path.join(absTarget, ".gitnexus/agent-kit");
  if (fs.existsSync(legacyStore)) {
    try {
      fs.rmSync(legacyStore, { recursive: true, force: true });
      actions.push("skills: removed legacy .gitnexus/agent-kit store (moved to .bearing/skills)");
    } catch {
      /* ignore */
    }
  }
  for (const rel of [
    ".cursor/gitnexus-hooks.json",
    ".cursor/gitnexus-api-profile.json",
  ]) {
    const abs = path.join(absTarget, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      fs.unlinkSync(abs);
      actions.push(`hooks: removed legacy ${rel} (moved to .bearing)`);
    } catch {
      /* ignore */
    }
  }
  // Per-session state flags/caches relocated from .cursor/ to .bearing/.
  const cursorDir = path.join(absTarget, ".cursor");
  if (fs.existsSync(cursorDir)) {
    let removed = 0;
    for (const f of fs.readdirSync(cursorDir)) {
      if (/^\.gitnexus-.*\.(flag|json)$/.test(f)) {
        try {
          fs.unlinkSync(path.join(cursorDir, f));
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
    if (removed) actions.push(`hooks: cleared ${removed} legacy .cursor session-state file(s)`);
  }
}

/**
 * When Zed is NOT in the active runtime, strip any orphaned gitnexus config left
 * in a committed .zed/settings.json by a prior Zed install — otherwise Zed keeps
 * spawning a stale (possibly absolute-path, teammate-breaking) MCP server.
 * @param {string} absTarget @param {string[]} actions
 */
function cleanupOrphanedZed(absTarget, actions) {
  const p = path.join(absTarget, ".zed/settings.json");
  if (!fs.existsSync(p)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    if (cfg.context_servers?.gitnexus || cfg.agent?.profiles?.[ZED_PROFILE_KEY]) {
      removeZedSettings(absTarget);
      actions.push("zed: removed orphaned gitnexus config (Zed not in runtime)");
    }
  } catch {
    /* ignore malformed settings */
  }
}

/** @param {string} absTarget @param {string[]} actions */
function migrateZedProfileKey(absTarget, actions) {
  const settingsPath = path.join(absTarget, ".zed/settings.json");
  if (!fs.existsSync(settingsPath)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (
      cfg.agent?.profiles?.gitnexus &&
      !cfg.agent?.profiles?.[ZED_PROFILE_KEY]
    ) {
      cfg.agent.profiles[ZED_PROFILE_KEY] = {
        ...cfg.agent.profiles.gitnexus,
        name: "Zed + GitNexus",
      };
      actions.push("zed: migrated profile gitnexus → zed-gitnexus");
    }
    if (cfg.agent?.profiles?.gitnexus) {
      delete cfg.agent.profiles.gitnexus;
      actions.push('zed: removed legacy profile key "gitnexus"');
    }
    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + "\n");
  } catch {
    /* ignore invalid json */
  }
}

/** @param {string} absTarget @param {string[]} actions */
function cleanupLegacyManifestFile(absTarget, actions) {
  const legacy = path.join(absTarget, MANIFEST_PATH_LEGACY);
  const current = path.join(absTarget, MANIFEST_PATH);
  if (fs.existsSync(legacy) && fs.existsSync(current)) {
    try {
      fs.unlinkSync(legacy);
      actions.push("manifest: removed legacy .cursor/gn-kit-manifest.json");
    } catch {
      /* ignore */
    }
  }
}

/**
 * The manifest moved out of the graph tool's index directory into `.bearing/manifest.json`.
 *
 * Two reasons, and the second is the bug: `agent-kit` is the kit's old name, and WRITING the file
 * created `.gitnexus/` in repos that had declined the gitnexus module — an index directory for an
 * indexer that was never installed (NS-13).
 *
 * MOVE rather than let the install write a fresh one: the manifest records the runtime, the module
 * selection, the MCP transport and the resolved gitnexus binary. Leaving the old copy behind is
 * worse than not migrating, because every reader takes the first path it finds — so a later
 * uninstall could act on a different module selection than the update just wrote.
 * @param {string} absTarget @param {string[]} actions @param {string[]} failures
 */
function migrateManifestPath(absTarget, actions, failures) {
  const current = path.join(absTarget, MANIFEST_PATH);
  for (const rel of MANIFEST_PATHS_LEGACY) {
    const legacy = path.join(absTarget, rel);
    if (!fs.existsSync(legacy)) continue;
    try {
      if (fs.existsSync(current)) {
        // Both present (a half-finished upgrade): the new path already won, so just drop the old.
        fs.unlinkSync(legacy);
        actions.push(`manifest: removed superseded ${rel}`);
      } else {
        fs.mkdirSync(path.dirname(current), { recursive: true });
        fs.copyFileSync(legacy, current);
        fs.unlinkSync(legacy);
        actions.push(`manifest: moved ${rel} -> ${MANIFEST_PATH}`);
      }
    } catch {
      // Not fatal: readManifest still consults the legacy paths, so the install proceeds and the
      // stale copy is retried next time. Surface it rather than logging a green checkmark.
      failures.push(`manifest: FAILED to move ${rel} -> ${MANIFEST_PATH} — remove it by hand`);
      continue;
    }
    // The old location may now be an empty `.gitnexus/` in a repo with no index. rmdir only
    // succeeds on a genuinely empty directory, so a real index is never at risk (NS-1).
    pruneEmptyDirs(path.join(absTarget, path.dirname(rel)), absTarget);
  }
}

/** Remove `dir` and its now-empty parents, stopping at (and never removing) `stopAt`. */
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

/**
 * Remove kit files listed in an old manifest that are no longer part of the bundle
 * (e.g. duplicated .claude/skills paths).
 * @param {string} absTarget
 * @param {string[]} legacyFiles
 * @param {string[]} actions
 */
function cleanupOrphanKitFiles(absTarget, legacyFiles, actions) {
  const orphans = [
    ".claude/skills/gitnexus",
    ".claude/skills/bearing-workspace",
    ".claude/skills/bearing-enforcement",
  ];
  for (const rel of legacyFiles) {
    if (rel.includes(".claude/skills/")) orphans.push(rel);
  }
  for (const rel of [...new Set(orphans)]) {
    const abs = path.join(absTarget, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      actions.push(`orphan: removed ${rel}`);
    } catch {
      /* ignore */
    }
  }
}
