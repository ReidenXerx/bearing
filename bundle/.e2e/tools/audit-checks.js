/**
 * Audit the CHECKS, not the app.
 *
 *   node .e2e/tools/audit-checks.js            # every verifier
 *   node .e2e/tools/audit-checks.js smoke      # only these
 *   node .e2e/tools/audit-checks.js --quiet    # findings only
 *
 * WHY THIS EXISTS. The recurring failure in a harness is not a broken app — it is a check that
 * reports something untrue, and every instance is invisible from the outside because **a lying
 * check looks exactly like a passing one**. `report.js` already fixes the worst structural case
 * (a run where everything skipped exiting green). The rest are shapes in the source, and a shape
 * in the source can be found by reading the source.
 *
 * Every rule below is a scar. Each earned its place by having already produced a false result.
 *
 * ⚠ A SMELL DETECTOR, NOT A PROOF. It reads text, so it can miss (a vacuous assertion built from a
 * variable that is always true is invisible here). A finding is a place to look. It exits 1 if any
 * LIE finding survives, so it can gate a branch; LEAK and THIN are reported and do not fail.
 */
const fs = require('fs');
const path = require('path');

// AUDIT_DIR is how this tool gets a negative control: the rules are exercised against a folder of
// deliberately-bad and deliberately-clean files, so "it found nothing" is a result rather than an
// absence of evidence. A detector nobody has watched fire is not known to work.
const VERIFY = process.env.AUDIT_DIR || path.join(__dirname, '..', 'verify');

/* ── source walking ─────────────────────────────────────────────────────────────────────────── */

/**
 * Index of the `)` matching the `(` at `open`, respecting strings, template literals and comments.
 *
 * ⚠ A NAIVE `indexOf(')')` IS WRONG HERE, and quietly so: selectors routinely contain a
 * parenthesis (`:has(button)`), so a naive scan ends the argument list inside a string and every
 * conclusion after it is drawn from a fragment.
 */
const matchParen = (src, open) => {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) return -1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i === -1) return -1; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return -1;
};

/** Top-level comma split of an argument list — same quote/paren awareness as above. */
const splitArgs = (src) => {
  const out = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if ('([{'.includes(c)) depth += 1;
    if (')]}'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { out.push(src.slice(start, i).trim()); start = i + 1; }
    i += 1;
  }
  out.push(src.slice(start).trim());
  return out.filter((a) => a !== '');
};

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every `<name>(` call site, with its argument list already split. */
const callsTo = (src, name) => {
  const out = [];
  // ⚠ TOLERATE `?.(`. Without it, `api?.('DELETE', …)` — the idiom for a cleanup block whose helper
  // may never have been constructed — is invisible, and the leak rule accuses the most careful
  // cleanup in the harness of being the only one that leaks.
  const re = new RegExp(`(?:\\.|\\b)${name}\\s*(?:\\?\\.)?\\s*\\(`, 'g');
  let m = re.exec(src);
  while (m) {
    const open = src.indexOf('(', m.index);
    const close = matchParen(src, open);
    if (close !== -1) out.push({ args: splitArgs(src.slice(open + 1, close)), line: lineOf(src, m.index), at: m.index, close });
    m = re.exec(src);
  }
  return out;
};

/** Strip comments, so a rule cannot fire on prose that describes the very thing it forbids. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (all, lead) => lead + ' '.repeat(all.length - lead.length));

/* ── the rules ──────────────────────────────────────────────────────────────────────────────── */

const RULES = [
  {
    id: 'vacuous-assertion',
    tier: 'LIE',
    /**
     * `check(name, true)` — an assertion that cannot fail.
     *
     * SCAR: seven of these existed in one harness ("seeded a field", "selected every row"). They
     * padded the pass column, and each one made `passed > 0` — the single condition deciding a run
     * had verified anything. A file printed "1/1 passed" having proven only that a fixture existed.
     */
    find: (src) =>
      callsTo(src, 'check')
        .filter((c) => c.args.length >= 2 && /^(true|1|!0|Boolean\(true\))$/.test(c.args[1]))
        .map((c) => ({ line: c.line, detail: `check(${c.args[0]}, ${c.args[1]}) — assert something, or say it in a console.log` })),
  },
  {
    id: 'undebuggable-assertion',
    tier: 'THIN',
    /**
     * `check(name, cond)` with no detail argument. When it fails it prints the claim and no
     * measurement, so the reader learns that something is false and nothing about what was seen.
     */
    find: (src) =>
      callsTo(src, 'check')
        .filter((c) => c.args.length === 2 && !/^(true|1|!0)$/.test(c.args[1]))
        .map((c) => ({ line: c.line, detail: `check(${c.args[0]}, …) carries no detail — a failure will not say what it measured` })),
  },
  {
    id: 'playwright-syntax-in-evaluate',
    tier: 'LIE',
    /**
     * `:has-text` / `:visible` / `:text-is` inside a `page.evaluate` body.
     *
     * SCAR: these belong to Playwright's selector engine, NOT to CSS. Handed to `querySelector`
     * inside the page they throw or match nothing — and something that matches nothing is simply
     * absent from the result, silently. Resolve with locators outside; pass plain values in.
     */
    find: (src) =>
      callsTo(src, 'evaluate')
        .map((c) => ({ c, body: src.slice(c.at, c.close) }))
        .filter(({ body }) => /querySelector|closest\(/.test(body) && /:has-text\(|:visible|:text-is\(|:has\(/.test(body))
        .map(({ c }) => ({ line: c.line, detail: 'Playwright selector syntax inside page.evaluate matches nothing in the DOM' })),
  },
  {
    id: 'report-never-finished',
    tier: 'LIE',
    /**
     * A file that builds a report and never calls `finish()` — no tally, no exit code, so the run
     * is green by default however badly it went.
     *
     * ⚠ Matches a bare `finish()` as well as `report.finish()`: the destructured form is idiomatic,
     * and an earlier version of this rule demanded the dot and accused three healthy files.
     */
    find: (src) =>
      (/createReport\s*\(/.test(src) && !/(?:\.|\b)finish\s*\(/.test(src)
        ? [{ line: lineOf(src, src.indexOf('createReport')), detail: 'createReport() without finish() — no tally, no exit code' }]
        : []),
  },
  {
    id: 'seeds-without-cleanup',
    tier: 'LEAK',
    /**
     * Creates server-side fixtures and never deletes them.
     *
     * SCAR: leftover fixtures do not fail the run that made them — they fail the next one, looking
     * like a product defect. See `core/seeds.js`, which turns this from a discipline into a ledger.
     */
    find: (src) => {
      const posts = callsTo(src, 'api').filter((c) => /^['"`]POST/.test(c.args[0] || ''));
      if (!posts.length) return [];
      if (callsTo(src, 'api').some((c) => /^['"`]DELETE/.test(c.args[0] || ''))) return [];
      if (/require\(['"]\.\.\/core\/seeds['"]\)/.test(src)) return [];
      return [{ line: posts[0].line, detail: `${posts.length} POST(s) create fixtures and nothing DELETEs them` }];
    },
  },
];

/* ── run ────────────────────────────────────────────────────────────────────────────────────── */

const quiet = process.argv.includes('--quiet');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const files = fs.existsSync(VERIFY)
  ? fs
      .readdirSync(VERIFY)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => !only.length || only.some((o) => f.replace(/\.js$/, '') === o || f.includes(o)))
      .sort()
  : [];

if (!files.length) {
  console.log(`\n  no verifier matched${only.length ? ` ${only.join(', ')}` : ` in ${VERIFY}`}\n`);
  process.exit(1);
}

console.log(`\nAuditing ${files.length} verifier${files.length === 1 ? '' : 's'} for shapes that have lied before\n`);

const tally = { LIE: 0, LEAK: 0, THIN: 0 };
let clean = 0;

for (const file of files) {
  const src = stripComments(fs.readFileSync(path.join(VERIFY, file), 'utf8'));
  const found = [];
  for (const rule of RULES) for (const hit of rule.find(src)) found.push({ ...hit, id: rule.id, tier: rule.tier });
  if (!found.length) {
    clean += 1;
    if (!quiet) console.log(`  ok    ${file}`);
    continue;
  }
  console.log(`  ----  ${file}`);
  found
    .sort((a, b) => a.line - b.line)
    .forEach(({ tier, id, line, detail }) => {
      tally[tier] += 1;
      console.log(`        ${tier.padEnd(4)} ${file}:${line}  [${id}] ${detail}`);
    });
}

console.log(`\n  ${clean}/${files.length} clean  ·  ${tally.LIE} LIE  ${tally.LEAK} LEAK  ${tally.THIN} THIN`);
console.log('  LIE = the check can report something untrue. LEAK = it can change what later runs see.');
console.log('  THIN = it will run, but a failure teaches the reader little.\n');

process.exit(tally.LIE ? 1 : 0);
