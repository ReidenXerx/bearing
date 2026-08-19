#!/usr/bin/env node
/**
 * Unified bearing verification (runtime-aware).
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

// Newest first. The older paths stay readable because this script ships INTO the repo and can be
// run against an install that predates the move.
const MANIFESTS = [
  '.bearing/manifest.json',
  '.gitnexus/agent-kit-manifest.json',
  '.cursor/gn-kit-manifest.json',
];

/**
 * STEALTH installs deliberately add no npm scripts — package.json is tracked, and not touching it
 * is the entire point of the mode. Checks that assume those scripts therefore have to know, or they
 * report a failure the user can never clear.
 */
/**
 * Name a command that exists HERE. These three strings were the last hardcoded `npm run bearing:*`
 * in this script, and in a stealth repo — which has no npm scripts by design — every one of them
 * named something the reader could not run. howToRun() falls back to `.bearing/commands.json`.
 */
async function run(name) {
  try {
    const mod = await import(pathToFileURL(path.join(root, '.bearing/lib/how-to-run.mjs')).href);
    return mod.howToRun(root, name);
  } catch {
    return `npm run ${name}`; // older install without the resolver — the old wording is still right there
  }
}

function readStealth() {
  for (const rel of MANIFESTS) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')).stealth === true;
    } catch {
      return false;
    }
  }
  return false;
}

function readRuntime() {
  for (const rel of MANIFESTS) {
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

/**
 * Which runtimes an install actually covers.
 *
 * This was `r === 'cursor' || r === 'both'`, a second implementation of something the installer
 * already knew, and it had drifted (GP-11). Bearing accepts `cursor`, `zed`, `claude`, `codex`,
 * `both` (= cursor+zed), `all` (= every one) and comma lists — of which that expression understood
 * exactly two. Consequences, both observed:
 *
 *   runtime "all"    -> wantsCursor false, so the RECOMMENDED install skipped every Cursor check
 *                       and reported a clean bill of health it had not verified.
 *   runtime "claude" -> ungated checks still looked for Cursor files, so a correct Claude-only
 *                       install was reported broken and told the user to "restart Cursor" (NS-6:
 *                       advice they cannot follow, about a problem that does not exist).
 */
function runtimeSet(r) {
  const tokens = String(r || 'both')
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const out = new Set();
  for (const t of tokens) {
    if (t === 'both') { out.add('cursor'); out.add('zed'); }
    else if (t === 'all') { out.add('cursor'); out.add('zed'); out.add('claude'); out.add('codex'); }
    else out.add(t);
  }
  return out;
}
function wantsCursor(r) {
  return runtimeSet(r).has('cursor');
}
function wantsZed(r) {
  return runtimeSet(r).has('zed');
}
function wantsClaude(r) {
  return runtimeSet(r).has('claude');
}

function checkFile(rel) {
  const exists = fs.existsSync(path.join(root, rel));
  return { id: rel, ok: exists, label: rel, detail: exists ? 'present' : 'missing' };
}

function checkManifest() {
  const found = MANIFESTS.find((rel) => fs.existsSync(path.join(root, rel)));
  return {
    id: 'manifest',
    ok: Boolean(found),
    label: 'Kit manifest',
    detail: found ?? 'missing — run kit install/update',
  };
}

function checkPackageGates() {
  const p = path.join(root, 'package.json');
  if (readStealth()) {
    // Not a pass with a caveat — genuinely not applicable. `.bearing/commands.json` carries the
    // same commands for a stealth repo, and howToRun() reads them, so nothing is missing.
    return {
      id: 'pkg_gates',
      ok: true,
      label: 'package.json gates',
      detail: 'n/a — stealth install (commands live in .bearing/commands.json)',
    };
  }
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
  const store = path.join(root, SKILLS_STORE, 'bearing-workspace/SKILL.md');
  return {
    id: 'skills_store',
    ok: fs.existsSync(store),
    label: 'Canonical skills store',
    detail: fs.existsSync(store) ? SKILLS_STORE : 'missing',
  };
}

function checkSkillSymlinks(runtime) {
  const cursorOk = fs.existsSync(path.join(root, '.cursor/skills/bearing-workspace/SKILL.md'));
  const zedOk = fs.existsSync(path.join(root, '.agents/skills/bearing-workspace/SKILL.md'));
  // The `else` branch asserted the ZED directory for every runtime that was not Cursor — so a
  // Claude-only install failed on "missing .agents/skills symlinks", a Zed path it was never
  // supposed to have. Check the link dirs the runtimes ACTUALLY installed, and when none of them
  // uses a symlink farm there is nothing to verify rather than something to fail.
  // sync-cursor-bearing-teaching.sh links `.claude/skills` for a claude runtime too, so a
  // claude-only repo DOES have a farm to check. Dropping Zed's path for it (correct) also dropped
  // Claude's (not), leaving this check vacuous on exactly the install it was rewritten for.
  const claudeOk = fs.existsSync(path.join(root, '.claude/skills/bearing-workspace/SKILL.md'));
  const want = [];
  if (wantsCursor(runtime)) want.push(['.cursor/skills', cursorOk]);
  if (wantsZed(runtime)) want.push(['.agents/skills', zedOk]);
  if (wantsClaude(runtime)) want.push(['.claude/skills', claudeOk]);
  let ok = true;
  let detail = 'no symlink dirs for this runtime';
  if (want.length) {
    ok = want.every(([, linked]) => linked);
    detail = ok
      ? `${want.map(([d]) => d).join(' + ')} linked`
      : want.filter(([, l]) => !l).map(([d]) => `missing ${d}`).join(', ');
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
  '.cursor/rules/00-bearing-enforcement.mdc',
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
  ui.banner(`bearing verification (${report.runtime})`, path.basename(report.root));

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
    ui.fail(`Kit incomplete — run kit update, then ${await run('bearing:verify')}`);
    return 1;
  }
  if (!report.health.healthy) {
    ui.warn(`Graph stale or missing embeddings — ${await run('bearing:agent-refresh')}`);
  } else {
    ui.ok('Kit verified');
  }

  const steps = [await run('bearing:health')];
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
