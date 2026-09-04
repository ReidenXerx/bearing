#!/usr/bin/env node
/**
 * Load staleness for hooks. Fail closed → stale (refresh required; hooks block classical until refresh succeeds or fails).
 * stdout: JSON from check-staleness.mjs, or { fresh: false, reason: 'check_failed', detail }
 *
 * Perf: a single tool call triggers staleness twice (guard + first-nudge). A short TTL cache
 * (.bearing/.gitnexus-staleness-cache.json) collapses those + rapid tool loops into one git pass.
 * The cache is invalidated on refresh (gitnexus-agent) and on session start (clear-session).
 */
import fs from 'node:fs';
import { howToRun } from './how-to-run.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? process.cwd();
const noCache = process.argv.includes('--no-cache');

const FAIL = {
  fresh: false,
  reason: 'check_failed',
  detail:
    'Staleness check failed — treat index as stale. Hooks block Grep/Read/MCP/shell until refresh succeeds or fails. ' +
    `Agent MUST run ${howToRun('bearing:agent-refresh')} autonomously (required_permissions: ["all"]).`,
};

const cachePath = path.join(root, '.bearing', '.gitnexus-staleness-cache.json');

function ttlMs() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.bearing/hooks.json'), 'utf8'));
    if (typeof cfg.stalenessCacheTtlMs === 'number') return cfg.stalenessCacheTtlMs;
  } catch {
    /* default */
  }
  return 2500;
}

function readCache(ttl) {
  if (noCache || ttl <= 0) return null;
  try {
    const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (c && typeof c.at === 'number' && Date.now() - c.at < ttl && c.data) {
      return c.data;
    }
  } catch {
    /* miss */
  }
  return null;
}

/**
 * @param {object} data @param {number} [shortTtl] cap this entry's life, for a FAILED check
 */
function writeCache(data, shortTtl) {
  if (noCache) return;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // `at` is backdated for a short-lived entry, so the ordinary TTL read expires it early without
    // needing a second code path on the read side.
    const at = shortTtl ? Date.now() - Math.max(0, ttlMs() - shortTtl) : Date.now();
    fs.writeFileSync(cachePath, JSON.stringify({ at, data }));
  } catch {
    /* best effort */
  }
}

const ttl = ttlMs();
const cached = readCache(ttl);
if (cached) {
  process.stdout.write(JSON.stringify(cached));
  process.exit(0);
}

const r = spawnSync(process.execPath, [path.join(here, 'check-staleness.mjs'), root], {
  encoding: 'utf8',
  // Bounded for the same reason the git calls below it are (NS-7): this runs inside a PreToolUse
  // hook, so an unbounded child blocks the tool call.
  timeout: 8000,
});

if (r.status !== 0 || !r.stdout?.trim()) {
  // CACHE THE FAILURE TOO. The cache was written only on success, so a repo where the check keeps
  // timing out re-paid the full cost on EVERY tool call — the slow case, which is the one that
  // needed the cache most. A short TTL is enough: it stops the stampede without making a transient
  // failure sticky.
  writeCache(FAIL, 2000);
  process.stdout.write(JSON.stringify(FAIL));
  process.exit(0);
}

try {
  const parsed = JSON.parse(r.stdout.trim());
  writeCache(parsed);
  process.stdout.write(JSON.stringify(parsed));
} catch {
  process.stdout.write(JSON.stringify(FAIL));
}
