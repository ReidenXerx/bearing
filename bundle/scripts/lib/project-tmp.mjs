#!/usr/bin/env node
/**
 * Route npm/npx temp files to project disk (.tmp-agent/) instead of tmpfs /tmp.
 * Avoids ENOSPC when /tmp (RAM disk) is full but the main drive has space.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULT_DIR = '.tmp-agent';

/**
 * @param {string} [root]
 * @returns {string}
 */
export function getProjectTmpDir(root = process.cwd()) {
  const dir = process.env.GITNEXUS_TMPDIR ?? path.join(root, DEFAULT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} [root]
 * @param {NodeJS.ProcessEnv} [base]
 */
export function withProjectTmpEnv(root = process.cwd(), base = process.env) {
  const tmp = getProjectTmpDir(root);
  return { ...base, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
}

/**
 * @param {string} mountPath
 * @returns {{ mount: string, size: string, used: string, avail: string, usePct: string } | null}
 */
export function dfMount(mountPath) {
  try {
    const line = execSync(`df -hP "${mountPath}" 2>/dev/null | tail -1`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parts = line.split(/\s+/);
    if (parts.length < 6) return null;
    return {
      mount: parts[5],
      size: parts[1],
      used: parts[2],
      avail: parts[3],
      usePct: parts[4],
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} usePct e.g. "100%"
 */
export function parseUsePct(usePct) {
  const n = parseInt(String(usePct).replace(/%$/, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} [root]
 */
export function tmpSpaceReport(root = process.cwd()) {
  const projectTmp = getProjectTmpDir(root);
  // Measure the temp dir this machine ACTUALLY uses. This computed systemTmp from TMPDIR and then
  // ignored it, always stat'ing /tmp — so on macOS, where TMPDIR is a per-user
  // /var/folders/... path, the report described a filesystem nothing was writing to and the
  // "nearly full" warning watched the wrong mount.
  const systemTmp = process.env.TMPDIR ?? '/tmp';
  const projectDf = dfMount(projectTmp);
  const systemDf = dfMount(systemTmp);

  const lines = [`Project temp: ${projectTmp}`];
  if (projectDf) {
    lines.push(`  ${projectDf.mount}: ${projectDf.used}/${projectDf.size} (${projectDf.usePct}), avail ${projectDf.avail}`);
  }
  if (systemDf && systemDf.mount !== projectDf?.mount) {
    // Name the directory we measured, not a literal "/tmp" — saying /tmp while reporting numbers
    // for $TMPDIR sends anyone chasing a full disk to the wrong filesystem.
    lines.push(`System temp (${systemTmp}): ${systemDf.used}/${systemDf.size} (${systemDf.usePct}), avail ${systemDf.avail}`);
    if (parseUsePct(systemDf.usePct) >= 95) {
      lines.push(
        `  WARNING: ${systemTmp} nearly full — gitnexus/npm use project .tmp-agent/ instead; clear /tmp/cursor-sandbox-cache if needed.`
      );
    }
  }
  return lines.join('\n');
}

/**
 * @param {unknown} err
 */
export function isEnospcError(err) {
  const msg = String(err?.message ?? err ?? '');
  const code = err?.code ?? '';
  return code === 'ENOSPC' || /enospc|no space left on device/i.test(msg);
}

/**
 * @param {string} [root]
 */
export function enospcHelp(root = process.cwd()) {
  return (
    'ENOSPC — temp directory full (often tmpfs /tmp at 100%, not your main disk).\n' +
    `${tmpSpaceReport(root)}\n` +
    'Fix in your terminal:\n' +
    '  df -h /tmp\n' +
    '  sudo du -sh /tmp/* 2>/dev/null | sort -hr | head -10\n' +
    '  rm -rf /tmp/cursor-sandbox-cache/*   # often safe\n' +
    `  rm -rf ${path.join(root, DEFAULT_DIR)}/*   # project temp cache\n` +
    'Then: npm run bearing:agent-refresh'
  );
}
