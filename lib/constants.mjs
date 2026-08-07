/** @typedef {'cursor' | 'zed' | 'claude' | 'both' | 'all' | string} Runtime */

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
/** Legacy Cursor-only manifest — kept as a named export for readability at its use sites. */
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

/** Adapter ids + aliases. A runtime may also be a comma-list (e.g. "cursor,claude"). */
export const VALID_RUNTIMES = ['cursor', 'zed', 'claude', 'codex', 'both', 'all'];

/** Zed agent profile — settings key + display name shown in Agent panel. */
export const ZED_PROFILE_KEY = 'zed-gitnexus';
export const ZED_PROFILE_NAME = 'Zed + GitNexus';

export const GITIGNORE_MARKER = '# bearing — generated local state';
/**
 * Markers written by earlier versions. The strip step must recognise these too: matching only the
 * CURRENT marker would leave the old managed block orphaned in every already-installed repo and
 * append a second one beside it.
 */
export const GITIGNORE_MARKERS_LEGACY = [
  '# GitNexus + gitnexus-agent-kit generated local state',
];
export const GITIGNORE_MARKER_LEGACY = '# GitNexus + cursor-gitnexus-kit generated local state';

/** @param {string} v Comma-list of adapter ids and/or aliases (cursor,zed,claude,both,all). */
export function parseRuntime(v) {
  const r = String(v || 'both').toLowerCase();
  const tokens = r.split(',').map((t) => t.trim()).filter(Boolean);
  const bad = tokens.filter((t) => !VALID_RUNTIMES.includes(/** @type {Runtime} */ (t)));
  if (!tokens.length || bad.length) {
    throw new Error(
      `Invalid runtime "${v}". Use any of: ${VALID_RUNTIMES.join(', ')} (comma-separated allowed).`,
    );
  }
  return /** @type {Runtime} */ (tokens.join(','));
}

/** @param {Runtime} runtime */
export function wantsCursor(runtime) {
  return /(^|,)(cursor|both|all)(,|$)/.test(String(runtime));
}

/** @param {Runtime} runtime */
export function wantsZed(runtime) {
  return /(^|,)(zed|both|all)(,|$)/.test(String(runtime));
}
