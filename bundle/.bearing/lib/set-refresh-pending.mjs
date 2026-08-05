#!/usr/bin/env node
/** CLI helper for refresh-pending / refresh-failed flags (session primer + guards). */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2] ?? process.cwd();
const action = process.argv[3] ?? 'status';
const detail = process.argv[4] ?? '';

const { setRefreshPending, isRefreshPending, setRefreshFailed, isRefreshFailed } = await import(
  pathToFileURL(path.join(root, '.bearing/lib/session-primer.mjs')).href
);

if (action === 'set') {
  setRefreshPending(root, true, detail);
  setRefreshFailed(root, false);
  process.exit(0);
}
if (action === 'clear') {
  setRefreshPending(root, false);
  setRefreshFailed(root, false);
  process.exit(0);
}
if (action === 'set-failed') {
  setRefreshPending(root, false);
  setRefreshFailed(root, true, detail);
  process.exit(0);
}
if (action === 'clear-failed') {
  setRefreshFailed(root, false);
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({ pending: isRefreshPending(root), failed: isRefreshFailed(root) })
);
