/**
 * Run every verifier, report once, exit non-zero if any failed.
 *
 *   node .e2e/tools/run.js
 *   BASE=https://staging.example.com node .e2e/tools/run.js
 *   ONLY=checkout,invoice node .e2e/tools/run.js     # filenames containing either
 *
 * Three projects wrote this file on their own before the kit had one — the clearest sign it
 * belonged here. What they converged on, and why:
 *
 * - **Each verifier owns its exit code; this only aggregates.** One process per verifier, so a crash
 *   in one cannot take the others down or leak state into them.
 * - **`_`-prefixed files are scratch** — probes and one-off diagnostics — and are not run. A harness
 *   self-test you DO want first gets a name that sorts first (`00-…`).
 * - **`ONLY=`**, because one BASE rarely covers every verifier: two apps behind two servers make a
 *   full run two invocations.
 * - **Say what it needs, ONCE.** With no backend, every verifier independently discovered there was
 *   none — eight identical failures for one cause, which buried the one real finding. So BASE is
 *   checked before anything runs (`PREFLIGHT=0` to skip): any HTTP answer, even a 401 or a 404,
 *   means something is listening; no answer means stop here and say so.
 * - **A hung verifier is a failure, not a hang:** each one gets `VERIFIER_TIMEOUT_MS` (10 minutes).
 * - **Nothing ran is not a pass.** No match for ONLY, or an empty verify/, exits 1.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('../core/paths');

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT = Number(process.env.VERIFIER_TIMEOUT_MS) > 0 ? Number(process.env.VERIFIER_TIMEOUT_MS) : 10 * 60 * 1000;

async function preflight() {
  if (process.env.PREFLIGHT === '0') return true;
  try {
    await fetch(BASE, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return true; // any status at all: something answered
  } catch (e) {
    console.log(`\n  ✗ nothing answered at ${BASE} (${e?.cause?.code || e?.name || e?.message}).`);
    console.log('    Every verifier would fail for this one reason, so none were run.');
    console.log('    Start the app, or point BASE at it — PREFLIGHT=0 skips this check.\n');
    return false;
  }
}

async function main() {
  const dir = path.join(ROOT, 'verify');
  const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .filter((f) => !only.length || only.some((o) => f.includes(o)))
    .sort();
  if (!files.length) {
    console.log(only.length ? `No verifier matched ONLY=${process.env.ONLY}` : `No verifiers in ${dir}`);
    process.exit(1);
  }
  if (!(await preflight())) process.exit(1);

  const failed = [];
  for (const f of files) {
    console.log(`\n──────── ${f} ────────`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env, timeout: TIMEOUT });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') failed.push(`${f} (timed out after ${secs}s)`);
    else if (r.status !== 0) failed.push(`${f} (exit ${r.status ?? r.signal})`);
  }
  console.log(`\n════════ ${files.length - failed.length}/${files.length} verifiers passed ════════`);
  if (failed.length) {
    console.log(`  failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
