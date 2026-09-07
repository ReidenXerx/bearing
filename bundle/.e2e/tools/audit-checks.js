/**
 * Audit the CHECKS, not the app.
 *
 *   node .e2e/tools/audit-checks.js            # every verifier
 *   node .e2e/tools/audit-checks.js smoke      # only these
 *   node .e2e/tools/audit-checks.js --quiet    # findings only
 *
 * WHY THIS EXISTS. The recurring failure in a harness is not a broken app — it is a check that
 * reports something untrue, and every instance is invisible from the outside because **a lying
 * check looks exactly like a passing one**. `report.js` already fixes the worst structural case (a
 * run where everything skipped exiting green). The rest are shapes in the source.
 *
 * ⚠ A SMELL DETECTOR, NOT A PROOF, AND A FALSE POSITIVE IS THE EXPENSIVE FAILURE. A tool that fails
 * a branch on correct code teaches its reader to skim past it, which costs more than never shipping
 * it. Three separate rules in the first draft did exactly that — one flagged `:has()`, which is
 * standard CSS; one accused any file that delegates `finish()` to a shared runner; one accused
 * `report?.finish?.()`. So: LIE gates the exit code, everything else reports; every rule has a
 * suppression comment; and `tools/audit-fixtures/` exists so each rule can be watched to fire.
 *
 *   // audit-checks: ignore vacuous-assertion   <- on the line above, or on the same line
 */
const fs = require('fs');
const path = require('path');

// The rules are exercised against a folder of deliberately-bad, deliberately-clean and trap files.
// A detector nobody has watched fire is not known to work.
const VERIFY = process.env.AUDIT_DIR || path.join(__dirname, '..', 'verify');

/* ── source walking ─────────────────────────────────────────────────────────────────────────── */

/**
 * Walk a source, calling back at every index that is real code.
 *
 * ⚠ ONE SCANNER, USED BY EVERYTHING. The first draft stripped comments with two regexes and matched
 * parens with a third pass, so `const glob = '/*.js'` opened a comment that blanked the next three
 * lines — and a vacuous assertion inside them audited as clean. A scanner that understands strings
 * is the only thing that understands both.
 */
const scan = (src, onCode) => {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n === -1 ? src.length : n; continue; }
    if (c === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i); i = n === -1 ? src.length : n + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const start = i;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      onCode(start, i, 'string');
      continue;
    }
    onCode(i, i + 1, 'code');
    i += 1;
  }
};

/** Blank comments, keeping every other byte and every newline, so line numbers stay true. */
const stripComments = (src) => {
  const out = new Array(src.length).fill(' ');
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') out[i] = '\n';
  scan(src, (from, to) => { for (let i = from; i < to; i += 1) out[i] = src[i]; });
  return out.join('');
};

/** Index of the `)` matching the `(` at `open`, or -1. Operates on comment-stripped source. */
const matchParen = (src, open) => {
  let depth = 0;
  let found = -1;
  scan(src.slice(open), (from, to, kind) => {
    if (found !== -1 || kind !== 'code') return;
    const ch = src[open + from];
    if (ch === '(') depth += 1;
    if (ch === ')') { depth -= 1; if (depth === 0) found = open + from; }
  });
  return found;
};

const splitArgs = (src) => {
  const out = [];
  let depth = 0;
  let start = 0;
  scan(src, (from, to, kind) => {
    if (kind !== 'code') return;
    const c = src[from];
    if ('([{'.includes(c)) depth += 1;
    if (')]}'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { out.push(src.slice(start, from).trim()); start = from + 1; }
  });
  out.push(src.slice(start).trim());
  return out.filter((a) => a !== '');
};

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Calls that could not be parsed — counted, never silently dropped. */
let unparsed = 0;

const callsTo = (src, name) => {
  const out = [];
  // `?.(` is tolerated: it is the idiom for a helper that may never have been constructed.
  const re = new RegExp(`(?:\\.|\\b)${name}\\s*(?:\\?\\.)?\\s*\\(`, 'g');
  let m = re.exec(src);
  while (m) {
    const open = src.indexOf('(', m.index);
    const close = matchParen(src, open);
    if (close === -1) unparsed += 1;
    else out.push({ args: splitArgs(src.slice(open + 1, close)), line: lineOf(src, m.index), at: m.index, close });
    m = re.exec(src);
  }
  return out;
};

/** A literal that is always true — the shapes a person actually writes for bookkeeping. */
const ALWAYS_TRUE = /^(true|1|!0|!!(true|1|'[^']*'|"[^"]*")|Boolean\((true|1|'[^']*'|"[^"]*")\)|'[^']+'|"[^"]+")$/;

/* ── the rules ──────────────────────────────────────────────────────────────────────────────── */

/** Only a report's own `check` — `page.check(selector)` is Playwright's, and a form verifier uses it. */
const reportChecks = (src) => {
  const destructured = /\{[^}]*\bcheck\b[^}]*\}\s*=\s*createReport\s*\(/.test(src);
  return callsTo(src, 'check').filter((c) => {
    // ⚠ `c.at` is the index of the `.` itself, not of the character after it. Testing for a
    // trailing dot here matched nothing, so `report.check(name, true)` — the whole point of the
    // rule — went unflagged while the fixture said it must fire.
    const before = src.slice(Math.max(0, c.at - 12), c.at);
    if (/\b(report|r)\s*$/.test(before)) return true;
    return destructured && !/\b(page|locator|frame)\s*$/.test(before);
  });
};

const RULES = [
  {
    id: 'vacuous-assertion',
    tier: 'LIE',
    /**
     * `check(name, true)` — an assertion that cannot fail. SCAR: seven of these existed in one
     * harness ("seeded a field", "selected every row"). They padded the pass column, and each made
     * `passed > 0` — the single condition deciding a run had verified anything.
     */
    find: (src) => reportChecks(src)
      .filter((c) => c.args.length >= 2 && ALWAYS_TRUE.test(c.args[1]))
      .map((c) => ({ line: c.line, detail: `check(${c.args[0].slice(0, 50)}, ${c.args[1]}) — assert something, or say it in a console.log` })),
  },
  {
    id: 'undebuggable-assertion',
    tier: 'THIN',
    /** A failure that prints the claim and no measurement teaches the reader nothing. */
    find: (src) => reportChecks(src)
      .filter((c) => c.args.length === 2 && !ALWAYS_TRUE.test(c.args[1]))
      .map((c) => ({ line: c.line, detail: `check(${c.args[0].slice(0, 50)}, …) carries no detail — a failure will not say what it measured` })),
  },
  {
    id: 'playwright-syntax-in-evaluate',
    tier: 'LIE',
    /**
     * `:has-text()` and `:text-is()` belong to Playwright's selector engine, NOT to CSS. Inside the
     * page they match nothing, silently.
     *
     * ⚠ `:has()` IS NOT IN THIS LIST. It is standard CSS (Chromium 105+), and flagging it failed a
     * branch on correct code — the expensive kind of wrong for a tool like this. `:visible` is also
     * Playwright-only but appears in ordinary style strings, so it is matched only as a selector
     * suffix.
     */
    find: (src) => {
      // ⚠ SCOPED TO AN ACTUAL EVALUATE SPAN, not to nearby text. A proximity window flagged
      // `page.locator('button:has-text("Save")')` — a perfectly correct locator — because an
      // unrelated `page.evaluate` sat a few lines below it. In a locator this syntax is right; only
      // inside the page is it wrong, so only inside the page may it be reported.
      const spans = ['evaluate', 'evaluateHandle', '$eval', '$$eval']
        .flatMap((fn) => callsTo(src, fn).map((c) => [c.at, c.close]));
      const inSpan = (i) => spans.some(([from, to]) => i > from && i < to);
      // ⚠ INSIDE A LOCATOR IT IS ALWAYS CORRECT, and that takes precedence over everything below.
      // `const box = await page.locator('button:has-text("Save")').boundingBox()` was flagged
      // because `box` is later handed to an evaluate — but what crosses into the page there is a
      // pair of coordinates, not the selector. This is the resolve-outside-pass-geometry-in pattern
      // the rule exists to RECOMMEND, so flagging it inverts the tool's own advice.
      const locators = ['locator', 'filter', 'getByRole', 'getByText', 'getByTestId', 'waitForSelector']
        .flatMap((fn) => callsTo(src, fn).map((c) => [c.at, c.close]));
      const inLocator = (i) => locators.some(([from, to]) => i > from && i < to);
      const hits = [];
      const re = /:has-text\(|:text-is\(/g;
      let m = re.exec(src);
      while (m) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
        // A selector hoisted into a const and then HANDED TO an evaluate is the same defect one
        // line up — and it is the form people actually write, so missing it would leave the rule
        // catching only the version nobody writes. The test is whether that name crosses into a
        // span, which is exactly what separates it from a locator using the same string.
        const hoisted = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
        const handedIn = hoisted
          && spans.some(([from, to]) => new RegExp(`\\b${hoisted}\\b`).test(src.slice(from, to)));
        if (!inLocator(m.index) && (inSpan(m.index) || handedIn || /querySelector/.test(line))) {
          hits.push({ line: lineOf(src, m.index), detail: `${m[0]} is Playwright selector syntax — inside the page it matches nothing` });
        }
        m = re.exec(src);
      }
      return hits;
    },
  },
  {
    id: 'report-never-finished',
    tier: 'LIE',
    /**
     * No tally, no exit code — the run is green by default however badly it went.
     *
     * ⚠ Uses `callsTo`, so `report?.finish?.()` counts, and skips a file that exports something:
     * factoring the boilerplate into a shared runner is the first refactor any team with twenty
     * verifiers makes, and accusing them for it is how a tool gets ignored.
     */
    find: (src) => {
      if (!/createReport\s*\(/.test(src)) return [];
      if (/module\.exports/.test(src)) return [];
      if (callsTo(src, 'finish').length) return [];
      return [{ line: lineOf(src, src.indexOf('createReport')), detail: 'createReport() without finish() — no tally, no exit code' }];
    },
  },
  {
    id: 'fixtures-without-a-ledger',
    tier: 'LEAK',
    /**
     * Creates server-side fixtures and neither deletes them nor ledgers them.
     *
     * ⚠ KEYED ON WHAT THIS KIT SHIPS, not on a helper named `api` — the first draft keyed on a
     * literal identifier this harness does not provide, so the rule could never fire and reported
     * every verifier clean on the one axis that matters most.
     */
    find: (src) => {
      const creates = [...src.matchAll(/page\.request\.(post|put|patch)\s*\(|method:\s*['"]POST['"]/g)];
      if (!creates.length) return [];
      if (/require\([^)]*core\/seeds/.test(src)) return [];
      if (/page\.request\.delete\s*\(|method:\s*['"]DELETE['"]/.test(src)) return [];
      return [{
        line: lineOf(src, creates[0].index),
        detail: `${creates.length} write(s) create fixtures with no delete and no seeds ledger`,
      }];
    },
  },
];

/* ── run ────────────────────────────────────────────────────────────────────────────────────── */

const quiet = process.argv.includes('--quiet');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const walk = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(path.join(dir, e.name))
    : [path.join(dir, e.name)]))
  : []);

const all = walk(VERIFY);
const files = all
  .filter((f) => /\.(js|mjs|cjs)$/.test(f))
  .filter((f) => !only.length || only.some((o) => path.basename(f).replace(/\.\w+$/, '') === o))
  .sort();
const skipped = all.length - files.length;

if (!files.length) {
  console.log(`\n  no verifier matched${only.length ? ` ${only.join(', ')}` : ` in ${VERIFY}`}\n`);
  process.exit(1);
}

console.log(`\nAuditing ${files.length} verifier${files.length === 1 ? '' : 's'} for shapes that have lied before\n`);

const tally = { LIE: 0, LEAK: 0, THIN: 0 };
let clean = 0;
unparsed = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const lines = raw.split('\n');
  const rel = path.relative(VERIFY, file);
  const found = [];
  for (const rule of RULES) {
    for (const hit of rule.find(src)) {
      // A suppression on the line itself or the line above, naming the rule.
      const near = `${lines[hit.line - 1] || ''}\n${lines[hit.line - 2] || ''}`;
      if (near.includes(`audit-checks: ignore ${rule.id}`)) continue;
      found.push({ ...hit, id: rule.id, tier: rule.tier });
    }
  }
  if (!found.length) {
    clean += 1;
    if (!quiet) console.log(`  ok    ${rel}`);
    continue;
  }
  console.log(`  ----  ${rel}`);
  found.sort((a, b) => a.line - b.line).forEach(({ tier, id, line, detail }) => {
    tally[tier] += 1;
    console.log(`        ${tier.padEnd(4)} ${rel}:${line}  [${id}] ${detail}`);
  });
}

console.log(`\n  ${clean}/${files.length} clean  ·  ${tally.LIE} LIE  ${tally.LEAK} LEAK  ${tally.THIN} THIN`);
// Coverage is a claim: "N/N clean" over a set that quietly excluded files is the tool telling its
// own lie about how much it read.
if (skipped) console.log(`  (${skipped} non-JS file(s) in ${VERIFY} were not read)`);
if (unparsed) console.log(`  ! ${unparsed} call(s) could not be parsed and were NOT audited`);
console.log('  LIE = the check can report something untrue. LEAK = it can change what later runs see.');
console.log('  THIN = it will run, but a failure teaches the reader little.\n');

process.exit(tally.LIE ? 1 : 0);
