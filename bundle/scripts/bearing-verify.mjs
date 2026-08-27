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
      // A manifest predating the `runtime` field is a cursor-era install, and `both` was the
      // default then — cursor+zed. Cursor is gone; zed is the half of that answer still checkable.
      return m.runtime || 'zed';
    } catch {
      return 'zed';
    }
  }
  return 'zed';
}

/**
 * Which runtimes an install actually covers.
 *
 * This was `r === 'cursor' || r === 'both'`, a second implementation of something the installer
 * already knew, and it had drifted (GP-11). Bearing accepts `zed`, `claude`, `codex`, `all` and
 * comma lists — of which that expression understood two, neither of them current. Consequences,
 * both observed before the checks were derived from the runtime rather than guessed:
 *
 *   runtime "all"    -> the recommended install skipped every check for a runtime it HAD, and
 *                       reported a clean bill of health it had not verified.
 *   runtime "claude" -> ungated checks looked for another editor's files, so a correct install was
 *                       reported broken with advice about a problem that did not exist (NS-6).
 */
function runtimeSet(r) {
  const tokens = String(r || 'both')
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const out = new Set();
  for (const t of tokens) {
    if (t === 'both') { out.add('zed'); out.add('claude'); }
    else if (t === 'all') { out.add('zed'); out.add('claude'); out.add('codex'); }
    else out.add(t);
  }
  return out;
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
    //
    // But LOOK before saying so. This returned ok:true naming a file it never opened; delete that
    // file and the check still passed green while the verifier's own remediation degenerated to
    // naming a command it simultaneously reported as not installed (NS-9, NS-20).
    const table = path.join(root, '.bearing/commands.json');
    const present = fs.existsSync(table);
    return {
      id: 'pkg_gates',
      ok: present,
      label: 'package.json gates',
      detail: present
        ? 'n/a — stealth install (commands live in .bearing/commands.json)'
        : 'stealth install, but .bearing/commands.json is MISSING — no command resolves here',
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

/**
 * Every module in the manifest, and whether its delivery actually landed.
 *
 * A user's agent reported `microscope` and `consult` as "not available in Claude Code". Both ARE
 * supported there and both were installed — but they are the only two modules delivered by a SKILL
 * and nothing else (northstars has npm scripts, taskcore a hook, gitnexus the MCP tools), so when
 * the agent could not see their skills it concluded the modules did not exist for its runtime.
 *
 * Nothing in bearing could contradict it, because nothing reported what each module ships. The
 * agent had to guess and guessed wrong. This is the authoritative answer: installed, and reachable
 * through what.
 */
/**
 * Are you running an agent this install was never wired for?
 *
 * Reported as "microscope and consult are not available in Claude Code" — and the agent was right.
 * That repo is a ZED install and the user runs Claude Code in it. A zed-only install writes
 * `.agents/skills/` and `AGENTS.md`, and no `.claude/` anything, so the modules delivered by npm
 * scripts kept working while the two delivered ONLY by a Claude-readable skill were genuinely
 * absent. It looked like two broken modules; it was one wrong runtime, and nothing said so.
 *
 * Only Claude Code is detected, because `CLAUDECODE=1` is a signal that can be confirmed. Guessing
 * at the others would be inventing a diagnosis, which is the failure this whole check exists to
 * prevent.
 */
function checkRuntimeCoversAgent() {
  const runtimes = runtimeSet(readRuntime());
  const inClaudeCode = Boolean(process.env.CLAUDECODE);
  const covered = !inClaudeCode || runtimes.has('claude');
  const recorded = readRuntime();
  return {
    id: 'runtime_covers_agent',
    ok: covered,
    label: 'Install covers the agent you are running',
    detail: covered
      ? inClaudeCode
        ? 'running Claude Code, and this install wires it'
        : `runtime: ${recorded}`
      : `you are running Claude Code, but this install is "${recorded}" — so .claude/skills, ` +
        `.claude/hooks and CLAUDE.md were never written. Modules delivered only by a skill ` +
        `(microscope, consult) will look unavailable. Fix: npx bearing update . --runtime ${recorded},claude`,
  };
}

function checkModuleDelivery() {
  let features = [];
  for (const rel of MANIFESTS) {
    try {
      features = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')).features ?? [];
      if (features.length) break;
    } catch {
      /* try the next */
    }
  }
  if (!features.length) {
    return { id: 'module_delivery', ok: true, label: 'Modules reachable', detail: 'no module list recorded' };
  }

  // What each module ships to the agent. A module with none of its artifacts present is installed
  // in name only.
  const SKILL_OF = {
    northstars: 'bearing-northstars',
    taskcore: 'bearing-taskcore',
    microscope: 'bearing-microscope',
    consult: 'bearing-consult',
    minions: 'bearing-minions',
    tsjs: 'bearing-tsjs',
    frontend: 'bearing-frontend',
    react: 'bearing-react',
  };
  // Modules whose payload is a FILE rather than a skill. Without this the loop below skips them
  // entirely and reports them as fine when nothing landed — the same failure 1.1.2 fixed for
  // skills, one delivery mechanism over.
  const FILE_OF = {
    goldpractices: '.bearing/gold-practices.md',
    tsjs: '.bearing/lang/typescript.md',
    frontend: '.bearing/stack/frontend.md',
    react: '.bearing/stack/react.md',
  };
  const store = path.join(root, SKILLS_STORE);
  const broken = [];
  for (const id of features) {
    const file = FILE_OF[id];
    if (file && !fs.existsSync(path.join(root, file))) broken.push(`${id} (no ${file})`);
    const skill = SKILL_OF[id];
    if (!skill) continue; // gitnexus is delivered by MCP + npm scripts, checked elsewhere
    const canonical = path.join(store, skill, 'SKILL.md');
    if (!fs.existsSync(canonical)) {
      broken.push(`${id} (no ${SKILLS_STORE}/${skill}/SKILL.md)`);
      continue;
    }
    // And reachable through the per-runtime farm the host actually reads.
    for (const [rt, dir] of [['claude', '.claude/skills'], ['zed', '.agents/skills']]) {
      if (!runtimeSet(readRuntime()).has(rt)) continue;
      if (!fs.existsSync(path.join(root, dir, skill, 'SKILL.md'))) {
        broken.push(`${id} (not readable at ${dir}/${skill})`);
      }
    }
  }
  return {
    id: 'module_delivery',
    ok: broken.length === 0,
    label: 'Modules reachable',
    detail: broken.length
      ? `${broken.join('; ')} — the module is recorded as installed but its skill cannot be read, so an agent will report it as unavailable`
      : `${features.length} module(s) installed, every skill readable`,
  };
}

async function checkRetiredHookKeys() {
  // A setting that silently does nothing looks handled, which is why it outlasts the feature it
  // configured. NS-19 retired the context-fullness family, but hooks.json is seed-once — an old
  // install's own comment still worked-examples `"contextWindowTokens": 1000000`, so following the
  // documentation configures a no-op and nothing says so.
  let inUse = [];
  try {
    const mod = await import(pathToFileURL(path.join(root, '.bearing/lib/hook-helpers.mjs')).href);
    inUse = mod.retiredHookKeysInUse?.(root) ?? [];
  } catch {
    return null; // older install without the helper — not a finding
  }
  return {
    id: 'retired_hook_keys',
    ok: inUse.length === 0,
    label: 'Hook config has no retired keys',
    detail: inUse.length
      ? `${inUse.map((k) => `${k.key} (${k.file})`).join(', ')} — retired by NS-19, read by nothing. Remove them; the window is not measurable at runtime.`
      : 'no dead settings',
  };
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


/**
 * @param {string} repoRoot
 */
export async function verifyInstall(repoRoot) {
  const runtime = readRuntime();
  const checks = [checkManifest(), checkPackageGates(), checkSkillsStore(), checkSkillSymlinks(runtime)];
  checks.push(checkRuntimeCoversAgent());
  checks.push(checkModuleDelivery());
  const retired = await checkRetiredHookKeys();
  if (retired) checks.push(retired);


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

  // "The index has not been built yet" is not "the kit is incomplete", and kit update cannot clear
  // it — I followed the instruction literally and got the identical output back. The persistence
  // pair is the same state as graph_fresh/embeddings and belongs with them; `doctor` already words
  // this correctly (NS-6: advice the reader cannot act on is a dead end).
  const INDEX_NOT_BUILT = [
    'health:graph_fresh',
    'health:embeddings',
    'health:persistence_dir',
    'health:persistence_meta',
  ];
  const hardFail = report.checks.some((c) => !c.ok && !INDEX_NOT_BUILT.includes(c.id));
  const indexMissing = report.checks.some((c) => !c.ok && INDEX_NOT_BUILT.includes(c.id));
  if (hardFail) {
    ui.fail(`Kit incomplete — run kit update, then ${await run('bearing:verify')}`);
    return 1;
  }
  if (indexMissing) {
    ui.warn(`Kit files OK — the graph index is not built yet. Run ${await run('bearing:agent-refresh')}.`);
  }
  if (!report.health.healthy) {
    ui.warn(`Graph stale or missing embeddings — ${await run('bearing:agent-refresh')}`);
  } else {
    ui.ok('Kit verified');
  }

  const steps = [await run('bearing:health')];
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
