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
import { fileURLToPath } from 'node:url';

/** Manifest locations, newest first — order matters, the first readable one wins. */
const MANIFESTS = ['.bearing/manifest.json', '.gitnexus/agent-kit-manifest.json'];

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

/**
 * The MCP entry for this repo, matching what lib/mcp-config.mjs writes at install time.
 *
 * Shell callers need this: bearing-setup.sh writes .cursor/mcp.json AFTER the installer has
 * already written it, so hardcoding an entry there silently reverted both the transport and the
 * binary choice on every install.
 * @param {string} [root]
 */
export function mcpEntryFor(root = process.cwd()) {
  let transport = null;
  for (const rel of MANIFESTS) {
    try {
      transport = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')).mcpTransport;
      if (transport) break;
    } catch {
      /* try the next */
    }
  }
  if (transport?.mode === 'http' && transport.url) {
    return { type: 'http', url: transport.url };
  }
  const parts = gitnexusCmd(root).split(/\s+/).filter(Boolean);
  return { command: parts[0], args: [...parts.slice(1), 'mcp'] };
}

// `node .bearing/lib/gitnexus-cmd.mjs [--mcp-entry]` — so shell scripts can ask the same question
// the JS callers do instead of hardcoding an answer that goes stale.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  process.stdout.write(
    (process.argv.includes('--mcp-entry')
      ? JSON.stringify(mcpEntryFor(root))
      : gitnexusCmd(root)) + '\n',
  );
}
