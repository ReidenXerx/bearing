#!/usr/bin/env node
/**
 * Lightweight GitNexus persistence / database diagnostics for health + doctor.
 * These checks are intentionally conservative: they surface suspicious local state
 * and classify backend probe output, but do not mutate or repair the graph.
 */
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DB_ERROR_RE = /\b(database|db|sqlite|ladybug|persistence|persist|lock|locked|corrupt|corruption|readonly|read-only|permission denied|EACCES|ENOSPC|no space|disk|IO error|I\/O error)\b/i;
const PDG_STAT_KEYS = ['pdgNodes', 'pdgEdges', 'basicBlocks', 'cfgEdges', 'cdgEdges', 'reachingDefEdges', 'taintFindings'];

/** @param {string} text */
export function classifyPersistenceOutput(text = '') {
  const out = String(text || '').trim();
  if (!out) return null;
  if (!DB_ERROR_RE.test(out)) return null;
  return {
    ok: false,
    label: 'Persistence / database probe',
    detail: out.split('\n').slice(0, 3).join(' ').slice(0, 240),
  };
}

/** @param {string} root */
export function inspectPersistence(root) {
  const gitnexusDir = path.join(root, '.gitnexus');
  const metaPath = path.join(gitnexusDir, 'meta.json');
  const checks = [];
  let meta = null;

  checks.push({
    id: 'persistence_dir',
    ok: fs.existsSync(gitnexusDir),
    label: 'GitNexus state dir',
    detail: fs.existsSync(gitnexusDir) ? '.gitnexus present' : '.gitnexus missing — run gitnexus refresh',
  });

  if (!fs.existsSync(metaPath)) {
    checks.push({
      id: 'persistence_meta',
      ok: false,
      label: 'Graph metadata',
      detail: 'meta.json missing — index not built or persistence incomplete',
    });
  } else {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      checks.push({
        id: 'persistence_meta',
        ok: true,
        label: 'Graph metadata',
        detail: `meta.json readable${meta.indexedAt ? ` @ ${meta.indexedAt}` : ''}`,
      });
    } catch (err) {
      checks.push({
        id: 'persistence_meta',
        ok: false,
        label: 'Graph metadata',
        detail: `meta.json invalid JSON — ${err.message}`,
      });
    }
  }

  if (meta?.stats) {
    const s = meta.stats;
    const pdgKeys = PDG_STAT_KEYS.filter((k) => Number(s[k] ?? 0) > 0);
    checks.push({
      id: 'pdg_layer_hint',
      ok: true,
      label: 'PDG layer hint',
      detail: pdgKeys.length
        ? `PDG/taint stats present: ${pdgKeys.map((k) => `${k}=${s[k]}`).join(', ')}`
        : 'No PDG stats advertised in meta.json; pre-commit gitnexus:pdg will build/refresh when supported',
    });
  }

  return {
    healthy: checks.filter((c) => c.id !== 'pdg_layer_hint').every((c) => c.ok),
    checks,
    meta,
  };
}

/**
 * Is the SHARED MCP server telling the truth about this machine?
 *
 * Two failures cost real time in one afternoon, and neither surfaced anywhere:
 *
 * 1. A scratch repo was deleted and removed from `~/.gitnexus/registry.json`, but the RUNNING
 *    server still had it loaded. `context` on it failed with "LadybugDB not found at
 *    /private/tmp/rt/.gitnexus/lbug" — a path that no longer existed. Registry edits do not reach
 *    a server that is already running.
 * 2. `npm i -g gitnexus@rc` upgraded the binary; the launchd server kept serving the OLD one until
 *    it was kickstarted by hand. Every tool schema and behaviour was a version behind the CLI.
 *
 * Both are the same shape — the server's view of the machine has diverged from the machine — and
 * both are cheap to detect. The doctor previously ended with "if MCP tools still fail, restart your
 * editor", which is a guess offered in place of a check.
 *
 * @param {{home?: string, pkgDir?: string, now?: Date}} [opts] injectable for tests
 * @returns {{checks: {id: string, ok: boolean, label: string, detail: string}[]}}
 */
export function inspectMcpServer(opts = {}) {
  const checks = [];
  const home = opts.home ?? os.homedir();

  // ── stale registry entries ────────────────────────────────────────────────
  let entries = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, '.gitnexus/registry.json'), 'utf8'));
    entries = Array.isArray(raw) ? raw : raw.repositories ?? raw.repos ?? Object.values(raw);
  } catch {
    entries = [];
  }
  const dead = entries
    .map((e) => ({ name: e?.name, dir: e?.path ?? e?.repoPath }))
    .filter((e) => e.dir && !fs.existsSync(e.dir));
  checks.push({
    id: 'registry_paths',
    ok: dead.length === 0,
    label: 'Registry paths exist',
    detail: dead.length
      ? `${dead.length} entry(s) point at a deleted directory (${dead
          .slice(0, 2)
          .map((d) => `${d.name} -> ${d.dir}`)
          .join(', ')}). A running server keeps serving them until it restarts.`
      : `${entries.length} registered repo(s), all present`,
  });

  // ── server older than the binary it should be running ─────────────────────
  const pkgDir = opts.pkgDir ?? null;
  let binMtime = null;
  if (pkgDir) {
    try {
      binMtime = fs.statSync(path.join(pkgDir, 'package.json')).mtime;
    } catch {
      /* not installed globally — nothing to compare against */
    }
  }
  let started = null;
  try {
    const pid = execFileSync('/bin/sh', ['-c', "launchctl list 2>/dev/null | grep gitnexus | awk '{print $1}'"], {
      encoding: 'utf8',
    }).trim();
    if (pid && /^\d+$/.test(pid)) {
      const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', pid], { encoding: 'utf8' }).trim();
      const d = new Date(lstart);
      if (!Number.isNaN(d.getTime())) started = d;
    }
  } catch {
    /* no launchd service — the editor spawns its own, and restarting the editor covers it */
  }
  if (binMtime && started) {
    const stale = started < binMtime;
    checks.push({
      id: 'server_version',
      ok: !stale,
      label: 'MCP server matches the installed binary',
      detail: stale
        ? `server started ${started.toISOString()} but gitnexus was installed ${binMtime.toISOString()} — it is serving the OLD build. Restart: launchctl kickstart -k gui/$(id -u)/dev.bearing.gitnexus-mcp`
        : 'server started after the current install',
    });
  }
  return { checks };
}

/**
 * Is the MCP endpoint bearing RECORDED actually answering?
 *
 * The manifest stores the transport it wrote — `{mode:"http", url:"http://127.0.0.1:39100/mcp"}` —
 * and nothing ever asked that URL a question. When the shared server is down, every MCP tool fails
 * in the editor while `doctor` reports "backend reachable, server current": it probes the CLI and
 * the registry, which are a different process entirely. The reader was then told "If MCP tools still
 * fail, restart your editor" — a guess, in the one line left after the registry and version checks
 * replaced the others.
 *
 * Returns null, not a passing check, when there is nothing to probe: a `stdio` install spawns the
 * server per client and HAS no endpoint, so reporting one would be inventing a subsystem.
 *
 * @param {{mode?: string, url?: string}|null} transport @param {number} [timeoutMs]
 * @returns {Promise<{id:string, ok:boolean, label:string, detail:string}|null>}
 */
export async function probeMcpEndpoint(transport, timeoutMs = 2500) {
  if (!transport || transport.mode !== 'http' || !transport.url) return null;
  let origin;
  try {
    origin = new URL(transport.url).origin;
  } catch {
    return null; // an unparseable URL is a config problem other checks already surface
  }
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      return {
        id: 'mcp_endpoint',
        ok: true,
        label: 'MCP endpoint answering',
        detail: `${origin} responded`,
      };
    }
    return {
      id: 'mcp_endpoint',
      ok: false,
      label: 'MCP endpoint answering',
      detail: `${origin} replied ${res.status} — the shared server is up but unhealthy. Restart: launchctl kickstart -k gui/$(id -u)/dev.bearing.gitnexus-mcp`,
    };
  } catch {
    return {
      id: 'mcp_endpoint',
      ok: false,
      label: 'MCP endpoint answering',
      detail: `${origin} is not answering — every MCP tool will fail until it is back, and restarting your editor will NOT help. Start it: launchctl kickstart -k gui/$(id -u)/dev.bearing.gitnexus-mcp`,
    };
  }
}
