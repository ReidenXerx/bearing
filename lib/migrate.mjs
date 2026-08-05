/**
 * Migrate legacy cursor-gitnexus-kit installs → unified gitnexus-agent-kit layout.
 * Safe to run on every install/update (idempotent).
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT } from "./kit-shared.mjs";
import {
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
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
  const legacyManifest = readAnyManifest(absTarget);
  // Prefer the caller-resolved runtime so update --runtime both can upgrade
  // older cursor-only or zed-only installs instead of being pinned by manifest data.
  const rt = parseRuntime(runtime);

  migrateGnkitDir(absTarget, actions);
  migrateBearingFileNames(absTarget, actions);
  migrateGitignore(absTarget, actions);
  cleanupLegacySkills(absTarget, rt, actions);
  cleanupLegacyClaudeSkills(absTarget, actions);
  cleanupLegacyHookLib(absTarget, actions);
  if (!wantsZed(rt)) cleanupOrphanedZed(absTarget, actions);
  migrateZedProfileKey(absTarget, actions);
  cleanupLegacyManifestFile(absTarget, actions);

  if (legacyManifest?.files?.length) {
    cleanupOrphanKitFiles(absTarget, legacyManifest.files, actions);
  }

  return { actions, legacyManifest, runtime: rt };
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
function migrateGnkitDir(absTarget, actions) {
  const legacy = path.join(absTarget, ".gnkit");
  const next = path.join(absTarget, ".bearing");
  if (!fs.existsSync(legacy)) return;
  if (fs.existsSync(next)) {
    actions.push("gnkit: BOTH .gnkit/ and .bearing/ exist — left .gnkit/ untouched, review manually");
    return;
  }
  try {
    fs.renameSync(legacy, next);
    actions.push("gnkit: moved .gnkit/ -> .bearing/ (kit renamed; north-stars + task-core preserved)");
  } catch {
    // Cross-device or permission failure — copy then remove, so the data still survives.
    try {
      fs.cpSync(legacy, next, { recursive: true });
      fs.rmSync(legacy, { recursive: true, force: true });
      actions.push("gnkit: copied .gnkit/ -> .bearing/ (rename failed; contents preserved)");
    } catch {
      actions.push("gnkit: FAILED to move .gnkit/ -> .bearing/ — move it manually to keep north-stars");
    }
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
function migrateBearingFileNames(absTarget, actions) {
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
      actions.push(`bearing: FAILED to rename ${from} -> ${to} — move it manually`);
    }
  }
}

/** @param {string} absTarget */
function readAnyManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, MANIFEST_PATH_LEGACY]) {
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
  text = text.replace(
    /\(safe to remove via gn-kit uninstall\)/g,
    "(safe to remove via gn-agent-kit uninstall)",
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
  // skills via git). Held only the store; the manifest is .gitnexus/agent-kit-manifest.json.
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
