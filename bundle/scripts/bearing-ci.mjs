#!/usr/bin/env node
/**
 * bearing CI — a graph-backed review report on every pull request.
 *
 * INFORMATIONAL BY DEFAULT. This does not fail your build. It was a gate that failed PRs when a
 * high-blast-radius symbol changed without tests, and that is the wrong shape for this signal: the
 * graph's own contract says a ZERO is not a finding (it returns no callers for code wired through
 * factories and DI all the time), so a hard block built on it fails honest PRs and teaches people
 * to add `[skip ci]`. A report a human reads and judges is worth more than a gate they route
 * around. Set GITNEXUS_CI_MODE=block only if you have decided you want teeth.
 *
 * Output goes where people actually look:
 *   - a STICKY pull-request comment, edited in place on each push rather than piling up
 *   - the job summary (GITHUB_STEP_SUMMARY), so it is on the checks tab without opening logs
 *   - ::notice annotations on the risky files
 *   - stdout, for anyone reading the raw log
 *
 * Usage:  node scripts/bearing-ci.mjs [baseRef]
 * Env:
 *   GITNEXUS_CI_MODE=report|block   default report — `block` restores non-zero exits
 *   GITNEXUS_CI_HIGH=<n>            callers before a symbol is called HIGH (default 8)
 *   GITNEXUS_CI_SKIP_BUILD=1        don't run analyze; assume the index is present
 *   GITHUB_TOKEN                    needed for the PR comment (pull-requests: write)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assertKitInstalled } from './lib/require-kit.mjs';

const ROOT = process.cwd();

// Same hoisting problem as the benchmark: a static `.bearing/lib` import runs before any guard, so
// a CI job on a damaged install failed with a stack trace instead of a reason.
assertKitInstalled(ROOT);
const { gitnexusSpawn } = await import('../.bearing/lib/gitnexus-cmd.mjs');
const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF || 'main';
const mode = (process.env.GITNEXUS_CI_MODE || 'report').toLowerCase();
const highThreshold = Number(process.env.GITNEXUS_CI_HIGH || 8);
const MARKER = '<!-- bearing-ci-report -->';

const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala)$/i;
// One definition of 'is this a test', shared with bearing-test-order — there were two and
// they disagreed on `.test.mjs` (GP-11).
const { isTestPath, parseChangedSymbols } = await import(
  new URL('../.bearing/lib/hook-helpers.mjs', import.meta.url).href
);
const SENSITIVE_RE = /(auth|login|session|token|password|secret|crypto|payment|billing|permission|admin)/i;

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gn(args, timeoutMs = 120000) {
  const { command, args: a } = gitnexusSpawn(args, ROOT);
  const r = spawnSync(command, a, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
  // Distinguish the failure modes. spawnSync reports a timeout as status:null + SIGTERM, which
  // collapsed into the same `ok:false` as a real error — so a 15-minute index timeout was reported
  // to users as the unexplained "no index could be built". A failure without its reason is the same
  // defect as a success that was never verified.
  return {
    ok: r.status === 0,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    timedOut: r.status === null && (r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT'),
    missing: r.error?.code === 'ENOENT',
    cmd: [command, ...a].join(' '),
  };
}

function repoName() {
  return path.basename(ROOT);
}

/** Changed production code, and whether tests moved with it. */
function collectDiff() {
  let base = baseRef;
  if (!git(`rev-parse --verify ${base}`)) base = `origin/${baseRef}`;
  const files = git(`diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
  return {
    base,
    all: files,
    code: files.filter((f) => CODE_RE.test(f) && !isTestPath(f)),
    tests: files.filter((f) => isTestPath(f)),
    sensitive: files.filter((f) => CODE_RE.test(f) && SENSITIVE_RE.test(f) && !isTestPath(f)),
  };
}

/** `detect-changes` maps the diff onto indexed symbols and execution flows. */
function detectChanges(repo, base) {
  const r = gn(['detect-changes', '--scope', 'compare', '--base-ref', base, '-r', repo]);
  if (!r.ok) return null;
  const num = (re) => Number((r.out.match(re) ?? [])[1] ?? 0);
  return {
    files: num(/Changes:\s*(\d+)\s*files/i),
    symbols: num(/,\s*(\d+)\s*symbols/i),
    processes: num(/Affected processes:\s*(\d+)/i),
    risk: (r.out.match(/Risk level:\s*(\w+)/i) ?? [])[1] ?? 'unknown',
    // Shared parser. The regex here matched /^\s*Symbol\s+/ and so matched NOTHING — the CLI
    // prints the KIND ("Function foo → path"). Every run fell through to the basename fallback
    // below and reported a table of zeros.
    changed: parseChangedSymbols(r.out).symbols.map((c) => ({ sym: c.name, file: c.filePath })),
    parsedSymbols: parseChangedSymbols(r.out).parsed,
  };
}

/** Upstream caller count per changed symbol — the blast-radius signal. */
function blastRadius(repo, symbols, byFile = false) {
  const out = [];
  for (const sym of symbols.slice(0, 25)) {
    const esc = sym.replace(/'/g, "\\'");
    const q = byFile
      ? `MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f) WHERE f.filePath = '${esc}' RETURN count(caller)`
      : `MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f {name: '${esc}'}) RETURN count(caller)`;
    const r = gn(['cypher', '-r', repo, q], 60000);
    const n = r.ok ? Number((r.out.match(/(\d+)/) ?? [])[1] ?? 0) : null;
    out.push({ sym, callers: n });
  }
  return out.sort((a, b) => (b.callers ?? -1) - (a.callers ?? -1));
}

/** Structural regressions: import cycles introduced anywhere in the graph. */
function structural(repo) {
  const r = gn(['check', '--cycles', '--json', '-r', repo], 90000);
  if (!r.ok && !r.out.includes('{')) return null;
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    return { cycles: j.cycleCount ?? 0, sample: (j.cycles ?? []).slice(0, 3) };
  } catch {
    return null;
  }
}

/**
 * REACH, not quality — and the words matter more than they look.
 *
 * This was a traffic light: 🔴 for many callers, 🟢 for none. Both readings are wrong and the green
 * one is dangerous. A symbol with eleven callers is not BAD, it is load-bearing — the row is telling
 * you where to look, not that something is broken. And a zero is the most ambiguous cell in the
 * table: the report's own footer says `0 callers` can mean "none" or "could not resolve", so
 * painting it the reassuring colour contradicts the paragraph directly beneath it.
 *
 * Named by how far the change reaches instead, with nothing on the scale that reads as a verdict.
 */
function riskTag(callers) {
  if (callers === null) return 'unknown';
  if (callers === 0) return 'none-found';
  if (callers >= highThreshold) return 'high';
  if (callers >= Math.ceil(highThreshold / 2)) return 'medium';
  return 'low';
}

function render({ diff, detected, radius, struct, indexed, indexNote }) {
  const L = [];
  L.push(MARKER);
  L.push('## 🧭 bearing — graph impact report');
  L.push('');
  L.push('_Informational. This check never fails your build — it is here to tell you where to look._');
  L.push('');

  if (!indexed) {
    L.push(`> ⚠️ **No graph for this run** — ${indexNote ?? "no index was available"}`);
    L.push(">");
    L.push("> Everything below comes from the diff alone: no blast radius, no affected flows, no cycle check.");
    L.push("");
  }

  L.push(
    `**${diff.code.length}** production file(s) changed · **${diff.tests.length}** test file(s) touched` +
      (detected ? ` · graph risk: **${detected.risk}**` : ''),
  );
  L.push('');

  if (radius.length) {
    L.push('### Blast radius — who calls what you changed');
    L.push('');
    L.push('| symbol | upstream callers | reach |');
    L.push('|---|---:|---|');
    for (const f of radius.slice(0, 15)) {
      const tag = riskTag(f.callers);
      const label = {
        high: 'wide reach',
        medium: 'some reach',
        low: 'narrow reach',
        'none-found': 'none found — or unresolved',
        unknown: 'could not check',
      }[tag];
      L.push(`| \`${f.sym}\` | ${f.callers ?? '—'} | ${label} |`);
    }
    if (radius.length > 15) L.push(`\n_…and ${radius.length - 15} more._`);
    L.push('');
  }

  if (detected?.processes) {
    L.push(`### Execution flows touched: ${detected.processes}`);
    L.push('');
    L.push('Changed symbols participate in indexed end-to-end flows — a change here reaches further than the file suggests.');
    L.push('');
  }

  if (diff.sensitive.length) {
    L.push('### Security-sensitive paths in this diff');
    L.push('');
    for (const f of diff.sensitive.slice(0, 10)) L.push(`- \`${f}\``);
    L.push('');
    L.push('_Matched on path naming (auth/token/payment/permission/…), not on behaviour — worth a human look, not an accusation._');
    L.push('');
  }

  if (struct) {
    L.push('### Structural');
    L.push('');
    if (struct.cycles > 0) {
      L.push(`🔁 **${struct.cycles} import cycle(s)** in the graph. Sample:`);
      for (const c of struct.sample) L.push(`- ${(c.files ?? []).map((x) => `\`${x}\``).join(' → ')}`);
      L.push('');
      L.push('_Repo-wide, not necessarily introduced by this PR._');
    } else {
      L.push('✅ No import cycles.');
    }
    L.push('');
  }

  const high = radius.filter((f) => riskTag(f.callers) === 'high');
  if (high.length && !diff.tests.length) {
    L.push(`> 💡 ${high.length} widely-called symbol(s) changed and no test file moved. Worth a second look — not a rule.`);
    L.push('');
  }

  // Blast-radius test order — opt-in at install (`testOrder` in the manifest), because it costs a
  // graph call per changed symbol and it posts to someone else's review surface. Reported, never
  // enforced: this is an ORDER, and the graph cannot prove a test is irrelevant.
  if (testOrderEnabled()) {
    const order = testOrderLines();
    if (order.length) {
      L.push('### Run these tests first');
      L.push('');
      L.push('Ranked by how much of the change they reach. **This is an order, not a filter** — run');
      L.push('the rest too; a test the graph cannot link may still be the one that fails.');
      L.push('');
      for (const line of order) L.push(line);
      L.push('');
    }
  }

  L.push('<details><summary>How to read this</summary>');
  L.push('');
  L.push('**A positive result is strong evidence; a zero is not a finding.** The graph resolves calls through');
  L.push('factories, DI containers and dynamic dispatch imperfectly, so `0 callers` can mean "none" or');
  L.push('"could not resolve". Never read an empty result as "dead code" or "safe to delete" — confirm it');
  L.push('classically first. That asymmetry is why this report does not block anything.');
  L.push('');
  L.push('</details>');
  return L.join('\n');
}

/**
 * Did this repo opt in?
 *
 * READ FROM hooks.json, NOT THE MANIFEST. `.bearing/manifest.json` is gitignored by design, so it
 * does not exist in a CI checkout — a setting stored there reads as `false` on every run and the
 * feature silently never fires. `.bearing/hooks.json` is tracked and team-shared, which is also the
 * right home for it on the merits: whether CI spends time on this is a decision for the repo, not
 * for whichever machine happened to run the installer.
 */
function testOrderEnabled() {
  if (process.env.GITNEXUS_CI_TEST_ORDER === '1') return true;
  if (process.env.GITNEXUS_CI_TEST_ORDER === '0') return false;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, '.bearing/hooks.json'), 'utf8')).ciTestOrder === true;
  } catch {
    return false;
  }
}

/**
 * Shell out to the ordering script rather than reimplementing it — one definition of the answer,
 * and its own header carries the reasoning about why it never skips. Returns markdown rows, or []
 * for any failure: a CI report that cannot rank tests still has a blast radius worth posting, so
 * this must never take the whole comment down with it.
 */
function testOrderLines() {
  const script = path.join(ROOT, 'scripts/bearing-test-order.mjs');
  if (!fs.existsSync(script)) return [];
  const r = spawnSync(process.execPath, [script, '--base', baseRef], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) return [];
  const files = (r.stdout ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  return files.slice(0, 15).map((f, i) => `${i + 1}. \`${f}\``);
}

/** Post once, then edit in place. A new comment per push buries the PR. */
async function postSticky(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return 'skipped (no GITHUB_TOKEN / GITHUB_REPOSITORY)';
  let pr = null;
  try {
    const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    pr = ev.pull_request?.number ?? ev.number ?? null;
  } catch {
    /* not a PR event */
  }
  if (!pr) return 'skipped (not a pull_request event)';

  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
  };
  try {
    const list = await fetch(`${api}/issues/${pr}/comments?per_page=100`, { headers }).then((r) => r.json());
    const mine = Array.isArray(list) ? list.find((c) => (c.body ?? '').includes(MARKER)) : null;
    const res = mine
      ? await fetch(`${api}/issues/comments/${mine.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
      : await fetch(`${api}/issues/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
    return res.ok ? (mine ? 'updated existing comment' : 'created comment') : `failed (HTTP ${res.status})`;
  } catch (e) {
    // Never let a reporting failure look like a code problem.
    return `failed (${e.message})`;
  }
}

async function main() {
  const repo = repoName();
  const diff = collectDiff();

  if (!diff.code.length) {
    console.log('bearing CI: no production code changed — nothing to report.');
    process.exit(0);
  }

  let indexed = fs.existsSync(path.join(ROOT, '.gitnexus/meta.json'));
  let indexNote = null;
  if (!indexed && process.env.GITNEXUS_CI_SKIP_BUILD !== '1') {
    // Default 25min, configurable. The old hardcoded 15 was under the real cost of a 3,000-file
    // monorepo on a 2-core runner, so the step burned a full quarter-hour and produced nothing.
    const budgetMs = Number(process.env.GITNEXUS_CI_INDEX_TIMEOUT_MS || 1500000);
    const started = Date.now();
    console.log(`bearing CI: building index (budget ${Math.round(budgetMs / 60000)}m)…`);
    const r = gn(['analyze', '--embeddings', '0'], budgetMs);
    indexed = r.ok && fs.existsSync(path.join(ROOT, '.gitnexus/meta.json'));
    if (!indexed) {
      const mins = Math.round((Date.now() - started) / 60000);
      indexNote = r.timedOut
        ? `indexing did not finish within ${mins}m. Raise \`GITNEXUS_CI_INDEX_TIMEOUT_MS\`, or warm the \`.gitnexus\` cache once on your default branch so PR runs restore it instead of rebuilding.`
        : r.missing
          ? `the \`gitnexus\` binary was not found on this runner (\`${r.cmd.split(' ')[0]}\`). Add an install step, or let it fall back to \`npx gitnexus@latest\`.`
          : `\`gitnexus analyze\` exited non-zero after ${mins}m: ${(r.out.trim().split('\n').pop() || 'no output').slice(0, 200)}`;
      console.log(`bearing CI: ${indexNote}`);
    }
  }

  const detected = indexed ? detectChanges(repo, diff.base) : null;
  // Only CODE symbols. detect-changes indexes markdown headings as symbols too, so a PR touching
  // CLAUDE.md filled the blast-radius table with rows like "Always Do" and "npm gates" — every one
  // of them 0 callers, burying the two rows that meant something.
  const codeSymbols = (detected?.changed ?? []).filter((c) => CODE_RE.test(c.file));
  // The old fallback used file BASENAMES as symbol names. No graph node is called `gitnexus-cmd`
  // — the File node is `gitnexus-cmd.mjs` and functions have their own names — so every fallback
  // row resolved to 0 callers and the table said "nothing here" about a critical change. Ask by
  // FILE PATH instead, which is a question the graph can actually answer, and mark the rows so the
  // reader knows they are per-file rather than per-symbol.
  const byFile = !codeSymbols.length;
  const symbols = byFile
    ? [...new Set(diff.code)]
    : [...new Set(codeSymbols.map((c) => c.sym))];
  const radius = indexed ? blastRadius(repo, symbols, byFile) : [];
  const struct = indexed ? structural(repo) : null;

  const body = render({ diff, detected, radius, struct, indexed, indexNote });
  console.log(`\n${body}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
    } catch {
      /* summary is a nicety */
    }
  }
  // Annotations surface on the Files tab without opening the summary.
  for (const f of radius.filter((x) => riskTag(x.callers) === 'high').slice(0, 10)) {
    const file = detected?.changed.find((c) => c.sym === f.sym)?.file;
    console.log(`::notice ${file ? `file=${file},` : ''}title=bearing::${f.sym} has ${f.callers} upstream callers`);
  }
  console.log(`bearing CI: PR comment ${await postSticky(body)}`);

  // Default is report-only ON PURPOSE — see the header. `block` is opt-in.
  if (mode === 'block') {
    const high = radius.filter((x) => riskTag(x.callers) === 'high');
    if (high.length && !diff.tests.length) {
      console.error(`bearing CI (block mode): ${high.length} high-impact symbol(s) changed with no test changes.`);
      process.exit(1);
    }
  }
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  (() => {
    const real = (p) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return path.resolve(p);
      }
    };
    return real(fileURLToPath(import.meta.url)) === real(process.argv[1]);
  })();

if (isMain) {
  main().catch((e) => {
    // A reporting crash must never read as a code failure.
    console.error(`bearing CI: report failed — ${e?.message || e}`);
    process.exit(mode === 'block' ? 1 : 0);
  });
}
