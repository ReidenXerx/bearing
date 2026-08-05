#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2] ?? process.cwd();
const lib = pathToFileURL(
  path.join(root, '.bearing/lib/session-primer.mjs')
).href;
const { clearSessionState, setRefreshPending } = await import(lib);
clearSessionState(root);
setRefreshPending(root, false);
