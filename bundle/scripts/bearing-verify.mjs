#!/usr/bin/env node
/**
 * Unified gitnexus-agent-kit verification (runtime-aware).
 * Usage: node scripts/bearing-verify.mjs [repoRoot] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const jsonOut = process.argv.includes('--json');

const ZED_PROFILE_KEY = 'zed-gitnexus';
const ZED_PROFILE_NAME = 'Zed + GitNexus';
const SKILLS_STORE = '.bearing/skills';

function readRuntime() {
  for (const rel of ['.gitnexus/agent-kit-manifest.json', '.cursor/gn-kit-manifest.json']) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      return m.runtime || 'cursor';
    } catch {
      return 'cursor';
    }
  }
  return fs.existsSync(path.join(root, '.cursor/hooks.json')) ? 'cursor' : 'zed';
}

function wantsCursor(r) {
  return r === 'cursor' || r === 'both';
}
function wantsZed(r) {
  return r === 'zed' || r === 'both';
}

function checkFile(rel) {
  const exists = fs.existsSync(path.join(root, rel));
  return { id: rel, ok: exists, label: rel, detail: exists ? 'present' : 'missing' };
}

function checkManifest() {
  const ok =
    fs.existsSync(path.join(root, '.gitnexus/agent-kit-manifest.json')) ||
    fs.existsSync(path.join(root, '.cursor/gn-kit-manifest.json'));
  return {
    id: 'manifest',
    ok,
    label: 'Kit manifest',
    detail: ok ? 'agent-kit-manifest.json' : 'missing — run kit install/update',
  };
}

function checkPackageGates() {
  const p = path.join(root, 'package.json');
  if (!fs.existsSync(p)) {
    return { id: 'pkg_gates', ok: false, label: 'package.json gates', detail: 'no package.json' };
  }
  try {
    const scripts = JSON.parse(fs.readFileSync(p, 'utf8')).scripts ?? {};
    const ok =
      Object.keys(scripts).some((k) => k.startsWith('bearing.__gate.')) &&
      scripts['bearing:verify'] &&
      scripts['bearing:agent-brief'];
    return {
      id: 'pkg_gates',
      ok,
      label: 'package.json gates',
      detail: ok ? 'gated bearing:* scripts injected' : 'run kit install/update',
    };
  } catch {
    return { id: 'pkg_gates', ok: false, label: 'package.json gates', detail: 'invalid JSON' };
  }
}

function checkSkillsStore() {
  const store = path.join(root, SKILLS_STORE, 'gitnexus-workspace/SKILL.md');
  return {
    id: 'skills_store',
    ok: fs.existsSync(store),
    label: 'Canonical skills store',
    detail: fs.existsSync(store) ? SKILLS_STORE : 'missing',
  };
}

function checkSkillSymlinks(runtime) {
  const cursorOk = fs.existsSync(path.join(root, '.cursor/skills/gitnexus-workspace/SKILL.md'));
  const zedOk = fs.existsSync(path.join(root, '.agents/skills/gitnexus-workspace/SKILL.md'));
  let ok = false;
  let detail = 'not linked';
  if (wantsCursor(runtime) && wantsZed(runtime)) {
    ok = cursorOk && zedOk;
    detail = ok ? 'cursor + zed symlinks OK' : `cursor=${cursorOk} zed=${zedOk}`;
  } else if (wantsCursor(runtime)) {
    ok = cursorOk;
    detail = ok ? '.cursor/skills linked' : 'missing .cursor/skills symlinks';
  } else {
    ok = zedOk;
    detail = ok ? '.agents/skills linked' : 'missing .agents/skills symlinks';
  }
  return { id: 'skills_symlinks', ok, label: 'Skill symlinks', detail };
}

function checkHooksJson() {
  const p = path.join(root, '.cursor/hooks.json');
  if (!fs.existsSync(p)) {
    return { id: 'hooks_json', ok: false, label: 'hooks.json structure', detail: 'missing' };
  }
  try {
    const h = JSON.parse(fs.readFileSync(p, 'utf8')).hooks ?? {};
    const ok =
      (h.sessionStart?.length ?? 0) >= 2 &&
      (h.beforeSubmitPrompt?.length ?? 0) >= 1 &&
      (h.preToolUse?.length ?? 0) >= 4;
    return {
      id: 'hooks_json',
      ok,
      label: 'hooks.json structure',
      detail: ok ? 'session + prompt + preToolUse guards' : 'incomplete hook chain',
    };
  } catch {
    return { id: 'hooks_json', ok: false, label: 'hooks.json structure', detail: 'invalid JSON' };
  }
}

function checkZed() {
  const checks = [];
  checks.push(checkFile('.zed/settings.json'));
  checks.push(checkFile('AGENTS.md'));
  let zedCfg = {};
  try {
    zedCfg = JSON.parse(fs.readFileSync(path.join(root, '.zed/settings.json'), 'utf8'));
  } catch {
    /* noop */
  }
  checks.push({
    id: 'zed_mcp',
    ok: Boolean(zedCfg.context_servers?.gitnexus),
    label: 'GitNexus MCP (Zed)',
    detail: zedCfg.context_servers?.gitnexus ? 'context_servers.gitnexus' : 'missing',
  });
  checks.push({
    id: 'zed_profile',
    ok: Boolean(zedCfg.agent?.profiles?.[ZED_PROFILE_KEY]),
    label: 'Zed agent profile',
    detail: zedCfg.agent?.profiles?.[ZED_PROFILE_KEY]
      ? `"${ZED_PROFILE_NAME}"`
      : zedCfg.agent?.profiles?.gitnexus
        ? 'legacy key "gitnexus" — run kit update'
        : 'missing',
  });
  if (zedCfg.agent?.profiles?.gitnexus) {
    checks.push({
      id: 'zed_legacy_profile',
      ok: false,
      label: 'Legacy Zed profile',
      detail: 'remove profiles.gitnexus — run kit update',
    });
  }
  return checks;
}

const CURSOR_CRITICAL = [
  '.cursor/rules/00-gitnexus-enforcement.mdc',
  '.cursor/hooks.json',
  '.bearing/lib/hook-helpers.mjs',
  '.bearing/lib/stale-policy.mjs',
  'scripts/bearing-agent.mjs',
  'scripts/bearing-verify.mjs',
];

const HOOK_SCRIPTS = [
  'bearing-session-primer.sh',
  'bearing-grep-guard.sh',
  'bearing-read-guard.sh',
  'bearing-edit-guard.sh',
];

function checkHookExecutable(name) {
  const p = path.join(root, '.cursor/hooks', name);
  if (!fs.existsSync(p)) {
    return { id: `hook:${name}`, ok: false, label: name, detail: 'missing' };
  }
  const mode = fs.statSync(p).mode & 0o111;
  return { id: `hook:${name}`, ok: mode !== 0, label: name, detail: mode ? 'executable' : 'not executable' };
}

/**
 * @param {string} repoRoot
 */
export async function verifyInstall(repoRoot) {
  const runtime = readRuntime();
  const checks = [checkManifest(), checkPackageGates(), checkSkillsStore(), checkSkillSymlinks(runtime)];

  if (wantsCursor(runtime)) {
    for (const rel of CURSOR_CRITICAL) checks.push(checkFile(rel));
    checks.push(checkHooksJson());
    for (const h of HOOK_SCRIPTS) checks.push(checkHookExecutable(h));
    checks.push(checkFile('.cursor/mcp.json'));
  }

  if (wantsZed(runtime)) {
    checks.push(...checkZed());
  }

  let health = { healthy: true, checks: [] };
  try {
    const auditPath = path.join(repoRoot, '.bearing/lib/session-health-audit.mjs');
    if (fs.existsSync(auditPath)) {
      const mod = await import(pathToFileURL(auditPath).href);
      health = mod.auditKitHealth(repoRoot);
      for (const c of health.checks) {
        checks.push({
          id: `health:${c.id}`,
          ok: c.ok,
          label: c.label,
          detail: c.detail ?? '',
        });
      }
    }
  } catch {
    /* zed-only may lack audit module until first cursor file pass — OK */
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    root: repoRoot,
    runtime,
    healthy: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    checks,
    health,
    verifiedAt: new Date().toISOString(),
  };
}

async function printHuman(report) {
  const ui = await import(pathToFileURL(path.join(root, 'scripts/lib/setup-ui.mjs')).href);
  ui.banner(`gitnexus-agent-kit verification (${report.runtime})`, path.basename(report.root));

  const rows = report.checks.map((c) => ({
    label: c.label,
    value: c.detail,
    status: c.ok ? 'ok' : 'fail',
  }));
  for (const row of rows) {
    if ((row.label === 'Graph index' || row.label === 'Embeddings') && row.status === 'fail') {
      row.status = 'warn';
    }
  }
  ui.summaryTable({ title: `Checks: ${report.passed}/${report.total} passed`, rows });

  const hardFail = report.checks.some(
    (c) => !c.ok && !['health:graph_fresh', 'health:embeddings'].includes(c.id)
  );
  if (hardFail) {
    ui.fail('Kit incomplete — run kit update, then npm run bearing:verify');
    return 1;
  }
  if (!report.health.healthy) {
    ui.warn('Graph stale or missing embeddings — npm run bearing:agent-refresh');
  } else {
    ui.ok('Kit verified');
  }

  const steps = ['npm run bearing:health'];
  if (wantsCursor(report.runtime)) steps.unshift('Restart Cursor (MCP + hooks)');
  if (wantsZed(report.runtime)) {
    steps.unshift('Restart Zed — trust worktree; profile "Zed + GitNexus"');
  }
  ui.nextSteps(steps);
  return 0;
}

async function main() {
  const report = await verifyInstall(root);
  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.healthy ? 0 : 1);
  }
  process.exit(await printHuman(report));
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
