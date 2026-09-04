/** @typedef {'zed' | 'claude' | 'codex' | 'both' | 'all' | string} Runtime */

export const KIT_NAME = 'bearing';

/** Primary manifest (IDE-neutral). */
export const MANIFEST_PATH = '.bearing/manifest.json';
/**
 * Manifest paths written by earlier versions, newest first.
 *
 * EVERY reader must consult these, not just the migration: the manifest IS the install's identity.
 * `update`, `uninstall` and `update-all` discovery all key off it, so a reader that knows only the
 * current path reports an installed repo as never installed — and `update-all` would silently stop
 * seeing every repo installed before this rename.
 *
 * `.gitnexus/agent-kit-manifest.json` was worse than a stale name: writing it CREATED the graph
 * tool's index directory in repos that had declined the gitnexus module (NS-13).
 */
export const MANIFEST_PATHS_LEGACY = [
  '.gitnexus/agent-kit-manifest.json',
  '.cursor/gn-kit-manifest.json',
];
/**
 * Legacy Cursor-era manifest path. A `.cursor/` path outliving Cursor support is deliberate: this
 * is how the OLDEST installs are still recognised and migrated. Removing it would not remove
 * Cursor, it would strand every repo that predates the rename.
 */
export const MANIFEST_PATH_LEGACY = '.cursor/gn-kit-manifest.json';

export const SKILLS_STORE = '.bearing/skills';
export const AGENTS_MARKER_BEGIN = '<!-- bearing:BEGIN -->';
export const AGENTS_MARKER_END = '<!-- bearing:END -->';
/**
 * Marker pairs written by earlier versions. Same obligation as GITIGNORE_MARKERS_LEGACY below, and
 * the same failure if skipped: matching only the CURRENT marker leaves the old managed block in
 * place in every already-installed repo and appends a second one beside it. AGENTS.md and CLAUDE.md
 * are user-owned files, so that duplicate is visible and theirs to clean up.
 */
export const AGENTS_MARKERS_LEGACY = [
  { begin: '<!-- gitnexus-agent-kit:BEGIN -->', end: '<!-- gitnexus-agent-kit:END -->' },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex source matching the kit's managed AGENTS.md/CLAUDE.md block under the current marker OR any
 * legacy one. Both the Zed and Claude adapters must build their patterns from this — they each
 * write the block and each has to recognise what a previous version wrote.
 * @param {string} [lead] pattern prefixed to every alternative (e.g. '\\n?' when removing)
 */
export function agentsBlockSource(lead = '') {
  return [
    { begin: AGENTS_MARKER_BEGIN, end: AGENTS_MARKER_END },
    ...AGENTS_MARKERS_LEGACY,
  ]
    .map(({ begin, end }) => `${lead}${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}\\n?`)
    .join('|');
}

/**
 * Adapter ids + aliases. A runtime may also be a comma-list (e.g. "zed,claude").
 *
 * `both` is retained ONLY so an existing manifest recording it keeps updating instead of throwing
 * (NS-15). It named cursor+zed; it now resolves to zed+claude. It is not offered anywhere.
 */
export const VALID_RUNTIMES = ['zed', 'claude', 'codex', 'both', 'all'];

/**
 * Runtimes bearing no longer installs, but must still PARSE.
 *
 * `parseRuntime` is not only the CLI validator — it is the READER for recorded state. 1.1.x's own
 * auto-detection wrote `cursor` into manifests with no user input, and `inferInstallFromDisk`
 * derived it from a committed `.cursor/` rule in any fresh clone. Throwing on it locked those repos
 * out of BOTH `update` and `uninstall`, and `uninstall` takes no `--runtime` to override with — so
 * the only exit was hand-editing JSON (NS-6). Worse, it threw at step 1, before the migration
 * written to delete those very files could run.
 *
 * So a retired token is DROPPED, not rejected — the same obligation `both` was given (NS-15). The
 * CLI still tells a user who TYPES one that it is gone; that belongs at the input, not in here.
 */
export const RETIRED_RUNTIMES = ['cursor'];

/** Zed agent profile — settings key + display name shown in Agent panel. */
export const ZED_PROFILE_KEY = 'zed-gitnexus';
export const ZED_PROFILE_NAME = 'Zed + GitNexus';

export const GITIGNORE_MARKER = '# bearing — generated local state';
/**
 * Markers written by earlier versions. The strip step must recognise these too: matching only the
 * CURRENT marker would leave the old managed block orphaned in every already-installed repo and
 * append a second one beside it.
 */
export const GITIGNORE_MARKER_LEGACY = '# GitNexus + cursor-gitnexus-kit generated local state';
/**
 * Markers written by earlier versions. The strip step must recognise these too.
 *
 * The cursor-era marker was defined OUTSIDE this array, and `stripManagedGitignoreBlock` only reads
 * the array — so `bearing uninstall` returned success on the oldest installs while their entire
 * managed block survived verbatim, `.cursor/skills/` and all. Only `migrateGitignore` knew that
 * name, and uninstall never runs migration. These are precisely the installs `MANIFEST_PATH_LEGACY`
 * is deliberately kept to recognise; the recognition was half-wired (NS-15).
 */
export const GITIGNORE_MARKERS_LEGACY = [
  '# GitNexus + gitnexus-agent-kit generated local state',
  GITIGNORE_MARKER_LEGACY,
];

/** @param {string} v Comma-list of adapter ids and/or aliases (zed,claude,codex,both,all). */
export function parseRuntime(v) {
  const r = String(v || 'all').toLowerCase();
  const tokens = r.split(',').map((t) => t.trim()).filter(Boolean);
  const kept = tokens.filter((t) => !RETIRED_RUNTIMES.includes(t));
  const bad = kept.filter((t) => !VALID_RUNTIMES.includes(/** @type {Runtime} */ (t)));
  if (!tokens.length || bad.length) {
    throw new Error(
      `Invalid runtime "${v}". Use any of: ${VALID_RUNTIMES.join(', ')} (comma-separated allowed).`,
    );
  }
  // Everything they had was retired. `both` is the alias kept for exactly this — it keeps the repo
  // updatable and uninstallable instead of stranding it (NS-15).
  return /** @type {Runtime} */ (kept.length ? kept.join(',') : 'both');
}

/** @param {Runtime} runtime */
export function wantsZed(runtime) {
  return /(^|,)(zed|both|all)(,|$)/.test(String(runtime));
}
