/**
 * WHICH gitnexus this repo runs, resolved at RUNTIME.
 *
 * The generated npm scripts get the answer baked in at install time, but the shipped helpers here
 * spawn gitnexus themselves and used to hardcode `npx -y gitnexus@latest`. That is a different
 * program from the one everything else uses: npx never consults PATH, it downloads and caches its
 * own copy of the published package. So on a machine running a locally linked build,
 * `bearing:agent-status` reported the version of the STOCK npm build while every real operation
 * used the linked one — both printing the same version string, so the health check stayed green
 * even if the two had diverged completely. The doctor was examining a different patient.
 *
 * Order: the recorded choice (what the operator actually configured) → whatever is installed →
 * npx as the last resort so a machine with no global install still works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Manifest locations, newest first. */
const MANIFESTS = ['.gitnexus/agent-kit-manifest.json', '.bearing/manifest.json'];

/** @param {string} root @returns {string|null} the recorded command, if any */
function recordedCmd(root) {
  for (const rel of MANIFESTS) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      if (typeof m.gitnexusCmd === 'string' && m.gitnexusCmd.trim()) return m.gitnexusCmd.trim();
    } catch {
      /* missing or malformed → try the next, then fall through to detection */
    }
  }
  return null;
}

let _resolved;
/** @returns {string} `gitnexus` when it is installed, else `npx -y gitnexus@latest` */
function detectCmd() {
  if (_resolved) return _resolved;
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, ['gitnexus'], { encoding: 'utf8' });
  const hit = (r.stdout || '').trim().split(/\r?\n/)[0];
  _resolved = r.status === 0 && hit ? 'gitnexus' : 'npx -y gitnexus@latest';
  return _resolved;
}

/**
 * The full command string, e.g. `gitnexus` or `npx -y gitnexus@latest`.
 * @param {string} [root] repo root (defaults to cwd)
 */
export function gitnexusCmd(root = process.cwd()) {
  return recordedCmd(root) ?? detectCmd();
}

/**
 * Split into the shape spawnSync wants, with any extra args appended.
 * @param {string[]} args e.g. ['--version']
 * @param {string} [root]
 * @returns {{ command: string, args: string[] }}
 */
export function gitnexusSpawn(args = [], root = process.cwd()) {
  const parts = gitnexusCmd(root).split(/\s+/).filter(Boolean);
  return { command: parts[0], args: [...parts.slice(1), ...args] };
}
