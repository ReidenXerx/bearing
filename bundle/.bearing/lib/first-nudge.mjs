#!/usr/bin/env node
/** Print first-tool nudge once per session (stdout); empty if already primed. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));

// Reuse the staleness the calling guard already computed (exported as
// GITNEXUS_STALENESS) to avoid a second load-staleness spawn per tool call.
// Only fall back to computing it when invoked standalone.
let stale = { fresh: false, reason: 'check_failed' };
if (process.env.GITNEXUS_STALENESS) {
  try {
    stale = JSON.parse(process.env.GITNEXUS_STALENESS);
  } catch {
    /* fall through to spawn */
  }
}
if (stale.reason === 'check_failed' && !process.env.GITNEXUS_STALENESS) {
  const r = spawnSync(process.execPath, [path.join(here, 'load-staleness.mjs'), root], {
    encoding: 'utf8',
  });
  try {
    stale = JSON.parse(r.stdout.trim() || '{}');
  } catch {
    stale = { fresh: false, reason: 'check_failed' };
  }
}

const { firstToolNudge } = await import(pathToFileURL(path.join(here, 'session-primer.mjs')).href);
const nudge = firstToolNudge(root, stale);
process.stdout.write(nudge ?? '');
