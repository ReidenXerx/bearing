#!/usr/bin/env node
/**
 * RETIRED. Do not use.
 *
 * `bundle/skills/` is now the single source of truth for the shipped skill
 * store (it is what `lib/skills.mjs` materializes into target repos via
 * `BUNDLE_ROOT/skills`). Edit `bundle/skills/<name>/SKILL.md` directly.
 *
 * This script used to flatten a separate `bundle/.claude/skills/` tree into
 * `bundle/skills/`, wiping the destination first (`rmSync`). That tree was
 * stale and is gone — running the old flow would REGRESS the shipped store and
 * delete `bearing-local`. The guard below exists so nobody resurrects it.
 */
console.error(
  [
    'sync-bundle-skills.mjs is retired and intentionally does nothing.',
    '',
    'The canonical skill store is bundle/skills/ — edit SKILL.md files there',
    'directly. There is no longer a bundle/.claude/skills/ source tree to sync',
    'from. See docs/SKILLS.md for the skill index.',
  ].join('\n'),
);
process.exit(1);
