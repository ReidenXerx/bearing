#!/usr/bin/env node
/**
 * Backward-compatible wrapper — delegates to scripts/gitnexus-verify.mjs.
 * @deprecated Prefer `npm run gitnexus:verify` or import verifyInstall from scripts/gitnexus-verify.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} [repoRoot]
 */
export async function verifyKitInstall(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const verifyPath = path.join(root, 'scripts/gitnexus-verify.mjs');
  if (!fs.existsSync(verifyPath)) {
    return {
      root,
      runtime: 'cursor',
      healthy: false,
      passed: 0,
      failed: 1,
      total: 1,
      checks: [{ id: 'verify_script', ok: false, label: 'gitnexus-verify.mjs', detail: 'missing' }],
      health: { healthy: false, checks: [] },
      verifiedAt: new Date().toISOString(),
    };
  }
  const mod = await import(pathToFileURL(verifyPath).href);
  return mod.verifyInstall(root);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = process.argv[2] ?? process.cwd();
  const verify = path.join(root, 'scripts/gitnexus-verify.mjs');
  const r = spawnSync(process.execPath, [verify, root, ...process.argv.slice(3)], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
