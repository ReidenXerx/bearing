#!/usr/bin/env node
/**
 * What does asking the graph cost, versus asking grep — ON THIS REPO?
 *
 * bearing's fixed overhead is easy to quote and easy to distrust: "~25k tokens a session" means
 * nothing without knowing what it buys back. This measures both sides on the actual codebase, by
 * running the REAL tools and counting the REAL output, so the number is yours rather than mine.
 *
 *   node scripts/bearing-token-benchmark.mjs [repoRoot] [--targets 8] [--json]
 *
 * The classical baseline is deliberately NOT a strawman. Reading every file grep touched is the
 * ceiling, not what a careful agent does, so the honest column is `windows` — grep, then read a
 * 40-line window around each hit, which is how you would actually answer the question by hand.
 * Both are reported. A benchmark that can only flatter the thing it benchmarks is advertising.
 *
 * It can and does report LOSSES. A symbol with three callers is cheaper to grep, and the summary
 * says so — that is the point. Use it to find where the graph earns its overhead on YOUR repo, not
 * to prove it always does.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertKitInstalled } from "./lib/require-kit.mjs";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith("--")) || process.cwd());
const jsonOut = args.includes("--json");
const nTargets = Number(args[args.indexOf("--targets") + 1]) || 8;
const WINDOW = 40; // lines of context a careful reader takes around a hit

// STATIC imports are hoisted, so a guard cannot run before one — `.bearing/lib` had to become a
// dynamic import for the check below to mean anything. Without it this died on
// ERR_MODULE_NOT_FOUND before printing a single line.
assertKitInstalled(root);
const { gitnexusSpawn } = await import("../.bearing/lib/gitnexus-cmd.mjs");
const { repoName } = await import("../.bearing/lib/hook-helpers.mjs");

/**
 * Characters per token. Not a tokenizer — a calibration constant, and the report says so. English
 * markdown with code fences sits near 3.7; quoting a precise-looking number from a rough method is
 * how a benchmark starts lying.
 */
const CPT = 3.7;
const tok = (s) => Math.round((s?.length ?? 0) / CPT);

/**
 * The CLI does NOT infer the repo from cwd — with more than one index registered it errors with
 * "Multiple repositories indexed". Every call here passes it explicitly.
 */
const REPO = repoName(root);

/**
 * `gitnexusSpawn` BUILDS the invocation — it does not run it — and takes (args, root) in that
 * order. Calling it as a runner returns `{command, args}`, whose `.status` is undefined, which
 * reads exactly like a command that produced no output.
 */
function gn(argv) {
  const cmd = gitnexusSpawn(argv, root);
  const r = spawnSync(cmd.command, cmd.args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function cypher(query) {
  const r = gn(["cypher", "-r", REPO, query]);
  return r.ok ? r.stdout : null;
}

/**
 * Names that are common METHODS rather than project symbols. "What breaks if I change push()" is
 * not a question anyone asks, and grepping for it matches every array in the codebase — which
 * inflates the classical side into the millions and makes the whole benchmark a lie. The first run
 * of this script picked `push`, `w`, `make` and `entry`, and reported a 2155x win. It was measuring
 * Array.prototype.
 */
const NOISE = new Set([
  "push", "pop", "shift", "map", "filter", "reduce", "forEach", "find", "get", "set", "has", "add",
  "delete", "then", "catch", "log", "warn", "error", "info", "debug", "trace", "call", "apply",
  "bind", "toString", "valueOf", "next", "value", "data", "entry", "item", "key", "make", "run",
  "start", "stop", "close", "open", "read", "write", "send", "emit", "on", "off", "once", "test",
]);

/** The symbols people actually ask "what breaks if I change this?" about: the well-connected ones. */
function pickTargets() {
  const out = cypher(
    // CALLS, ACCESSES and USES — not CALLS alone.
    //
    // Sampling only call targets measured the graph on the question it is BEST at. A field read
    // (ACCESSES) or a type reference (USES) could never be picked, and those are exactly where it
    // is weakest: ~92% of USES edges sit at 0.51-0.55 confidence. A ratio published from a
    // call-graph-only sample is a number about call graphs wearing the label "your repo".
    "MATCH (a)-[r:CodeRelation]->(b) WHERE r.type IN ['CALLS','ACCESSES','USES'] AND b.name IS NOT NULL " +
      "RETURN b.name AS name, b.filePath AS file, count(*) AS callers " +
      // Deep pool on purpose: dedupe by name removes most of it, and `impact` then declines the
      // majority of what survives (10 of 14 on one real repo). A 6x pool yielded 4 rows for
      // `--targets 8`.
      `ORDER BY callers DESC LIMIT ${nTargets * 25}`,
  );
  if (!out) return [];
  // The CLI returns JSON whose `markdown` field holds the table with ESCAPED newlines — splitting
  // the raw stdout on real newlines yields exactly one useless line.
  let table;
  try {
    table = JSON.parse(out).markdown ?? "";
  } catch {
    return [];
  }
  const rows = [];
  for (const line of table.split("\n")) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 3 || cells[0] === "name" || cells[0].startsWith("---")) continue;
    const callers = Number(cells[2]);
    const [name, file] = cells;
    if (!Number.isFinite(callers)) continue;
    // Short names match everything; noise names are language builtins; a symbol defined in a test
    // or a dependency is not what anyone is about to change.
    if (name.length < 4 || NOISE.has(name)) continue;
    if (/node_modules|\.spec\.|\.test\.|__tests__|\/dist\/|\/build\//.test(file)) continue;
    rows.push({ name, file, callers });
  }
  // ONE ROW PER NAME. Three different `logger` nodes in three files are three graph symbols but
  // ONE grep question — grep matches by name, so all three carried an identical 677,410-token
  // baseline. Counting them separately billed the same question three times and let the single most
  // grep-hostile name in the repo supply 2M of a 3.5M total. Ordered by callers already, so the
  // first occurrence is the most-connected one.
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.name) && seen.add(r.name));
}

/**
 * What the graph charges — for BOTH questions, because they are not the same question.
 *
 * `--summary-only` answers "how big is the blast radius": counts, risk, affected flows and modules.
 * The full response answers "show me every call site", which is what `git grep` gives you. On one
 * real symbol that is 2,722 tokens versus 17,603 — a 6.5x difference, and comparing the cheap one
 * against grep's locations flatters the graph by exactly that much. Report both and let the reader
 * pick the row that matches what they were going to ask.
 */
function graphCost(t) {
  const base = ["impact", t.name, "--direction", "upstream", "--file", t.file, "-r", REPO];
  const summary = gn([...base, "--summary-only"]);
  const full = gn(base);
  if (!summary.ok) return null;
  // A NON-ANSWER IS NOT A WIN, AND IT IS THE CHEAPEST POSSIBLE ROW.
  //
  // `impact` on a symbol it cannot resolve returns `impactedCount: 0, risk: UNKNOWN` in ~250 tokens
  // — and this benchmark scored that against grep's 1.3M and printed 5294x. The worse the graph
  // did, the better it looked, because the only thing being compared was SIZE. GitNexus's own
  // riskNote on that response says "confirm with a text search before treating the change as safe";
  // the benchmark was reporting that advice as a 5294x victory over text search.
  //
  // Ambiguous counts too: "found 5 symbols matching, disambiguate with target_uid" is a question,
  // not an answer, and the reader would still have to do the work.
  if (!answered(summary.stdout)) return { unresolved: true };
  return { summary: tok(summary.stdout), full: full.ok ? tok(full.stdout) : null };
}

/** Did `impact` actually resolve the symbol, or just decline cheaply? */
export function answered(stdout) {
  let r;
  try {
    r = JSON.parse(stdout);
  } catch {
    return true; // unparseable → not our call to make; let it be measured
  }
  if (r.status === "ambiguous") return false;
  return Number(r.impactedCount) > 0;
}

/** What grep charges: its own output, plus reading what it points at. */
function classicalCost(t) {
  // `git grep` — TRACKED FILES ONLY, and word-boundary matched. Plain `grep -rn` against an
  // absolute path wandered into node_modules and .gitnexus/ (the index's own database), which is
  // how the first run of this reported millions of tokens for the classical side. No agent greps
  // its dependencies to answer "who calls this", so neither does the baseline.
  const r = spawnSync("git", ["grep", "-nw", "--", t.name], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = r.stdout ?? "";
  if (!raw) return null;
  const hits = raw.split("\n").filter(Boolean);
  const grepTokens = tok(raw);

  const byFile = new Map();
  for (const h of hits) {
    const m = h.match(/^(.+?):(\d+):/);
    if (!m) continue;
    if (!byFile.has(m[1])) byFile.set(m[1], []);
    byFile.get(m[1]).push(Number(m[2]));
  }

  let windows = 0;
  let whole = 0;
  for (const [file, lineNos] of byFile) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    whole += tok(text);
    const lines = text.split("\n");
    // Merge overlapping windows so a file with 20 nearby hits is not counted 20 times.
    const wanted = new Set();
    for (const ln of lineNos) {
      for (let i = Math.max(0, ln - 1 - WINDOW); i < Math.min(lines.length, ln + WINDOW); i++) wanted.add(i);
    }
    windows += tok([...wanted].map((i) => lines[i]).join("\n"));
  }
  return { grep: grepTokens, windows: grepTokens + windows, whole: grepTokens + whole, files: byFile.size };
}

// DO NOT pre-slice to nTargets. `impact` cannot resolve every well-connected symbol — on one real
// repo it answered 2 of the first 10 — so slicing first and dropping the unresolved silently turned
// `--targets 10` into a two-row benchmark. Walk the candidate pool until nTargets have ACTUALLY been
// answered, bounded by the pool the picker already fetched.
const targets = pickTargets();
if (!targets.length) {
  console.error(`token-benchmark: no CALLS/ACCESSES/USES edges for repo "${REPO}" — is the index built? (bearing:refresh)`);
  process.exit(1);
}

const rows = [];
const unresolved = [];
let attempted = 0;
for (const t of targets) {
  if (rows.length >= nTargets) break;
  attempted++;
  // Graph first: grepping a name costs a `git grep` plus reading every file it hit, and paying that
  // for a symbol we are about to discard as unresolved is work spent to produce nothing.
  const g = graphCost(t);
  if (g == null) continue;
  if (g.unresolved) {
    unresolved.push(t.name);
    continue;
  }
  const c = classicalCost(t);
  if (c == null) continue;
  rows.push({
    ...t,
    graph: g.summary,
    graphFull: g.full,
    ...c,
    ratio: c.windows / g.summary,
    ratioFull: g.full ? c.windows / g.full : null,
  });
}

/**
 * Keep the last runs so the ratio can be TRENDED, not just quoted once.
 *
 * The number this prints is a property of the index, not of the repo: if the analyzer quietly stops
 * resolving a class of callers, `impact` gets cheaper and thinner at the same time and the ratio
 * IMPROVES while the answer gets worse. A single run cannot tell those apart. A history can — a
 * ratio that jumps while the codebase did not is a reason to look at the graph, not to celebrate.
 * @param {string} root @param {object} entry @returns {object|null} the previous run, if any
 */
function recordRun(root, entry) {
  // `.bearing/.bearing-*` is the ignore rule for generated local state. This file was named
  // `.token-benchmark.json`, which matches neither that pattern nor `.gitnexus-*`, so on a normal
  // (committed `.bearing/`) install it showed up untracked in every teammate's `git status`. Named
  // to the convention rather than given its own ignore line, so there is one rule and not N entries.
  const file = path.join(root, ".bearing", ".bearing-token-benchmark.json");
  const legacy = path.join(root, ".bearing", ".token-benchmark.json");
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : legacy, "utf8")).runs ?? [];
  } catch {
    /* first run here */
  }
  const previous = history.length ? history[history.length - 1] : null;
  history.push(entry);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Keep 20: enough to see a trend, small enough that nobody has to think about the file.
    fs.writeFileSync(file, JSON.stringify({ runs: history.slice(-20) }, null, 2));
    // Carried its runs over on the first write; leaving it would strand an unignored file behind.
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
  } catch {
    /* an unrecordable run is a missing trend, not a failed benchmark */
  }
  return previous;
}

if (jsonOut) {
  console.log(JSON.stringify({ charsPerToken: CPT, window: WINDOW, results: rows }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log(`\n  Token cost of one "what breaks if I change this?" — ${path.basename(root)}\n`);
console.log(`  ${pad("symbol", 24)}${num("refs", 6)}${num("grepFiles", 10)}${num("summary", 9)}${num("sites", 8)}${num("grep+read", 11)}${num("vs sites", 9)}`);
console.log(`  ${"-".repeat(77)}`);
for (const r of rows) {
  const worst = r.ratioFull ?? r.ratio;
  const flag = worst < 1 ? "  <- grep is cheaper here" : "";
  console.log(
    `  ${pad(r.name.slice(0, 23), 24)}${num(r.callers, 6)}${num(r.files, 10)}${num(r.graph, 9)}${num(r.graphFull ?? "-", 8)}${num(r.windows, 11)}` +
      `${num(r.ratio.toFixed(1) + "x", 8)}${num(r.ratioFull ? r.ratioFull.toFixed(1) + "x" : "-", 9)}${flag}`,
  );
}

if (!rows.length) {
  console.error(
    `token-benchmark: impact could not resolve ANY of the ${attempted} symbols tried` +
      `${unresolved.length ? ` (${unresolved.join(", ")})` : ""}. That is a finding about the index, ` +
      "not a benchmark result — check the graph with `node .bearing/lib/graph-capabilities.mjs`.",
  );
  process.exit(1);
}

const totG = rows.reduce((s, r) => s + r.graph, 0);
const totGF = rows.reduce((s, r) => s + (r.graphFull ?? r.graph), 0);
const totW = rows.reduce((s, r) => s + r.windows, 0);
const totF = rows.reduce((s, r) => s + r.whole, 0);
// Judge a win on the HONEST comparison — call sites against call sites.
const wins = rows.filter((r) => (r.ratioFull ?? r.ratio) >= 1).length;
console.log(`  ${"-".repeat(77)}`);
console.log(
  `  ${pad(`${rows.length} questions`, 24)}${num("", 8)}${num(totG, 9)}${num(totGF, 8)}${num(totW, 11)}` +
    `${num((totW / totG).toFixed(1) + "x", 8)}${num((totW / totGF).toFixed(1) + "x", 9)}`,
);
// A SUM-BASED RATIO IS NOT THE TYPICAL CASE. It answers "what do these N questions cost together",
// where one grep-hostile name can supply most of the total: on one real repo `user` and `logger`
// alone were 1.6M of 3.5M, and the headline read 779x while the median question was 660x. Both are
// true and they answer different questions, so print both and say which is which. The median is the
// one to quote, because a reader asking ONE question is asking for the typical case.
const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const medFull = med(rows.map((r) => r.ratioFull ?? r.ratio));
const lo = Math.min(...rows.map((r) => r.ratioFull ?? r.ratio));
const hi = Math.max(...rows.map((r) => r.ratioFull ?? r.ratio));
console.log(
  `  ${pad("median question", 24)}${num("", 8)}${num("", 9)}${num("", 8)}${num("", 11)}${num("", 8)}` +
    `${num(medFull.toFixed(1) + "x", 9)}`,
);
console.log(`\n  summary = "how big is the blast radius" (counts, risk, flows).`);
console.log(`  sites   = the full response, every call site — what \`git grep\` actually gives you.`);
console.log(`  Compare like for like: "vs sites" is the honest column. Graph won ${wins} of ${rows.length} on it.`);
console.log(
  `  The row above the line is the TOTAL for all ${rows.length}; "median question" is the typical one.` +
    ` Spread ${lo.toFixed(1)}x-${hi.toFixed(1)}x — it depends heavily on how`,
);
console.log(`  distinctive the NAME is, because that is what grep pays for. Quote the median, not the total.`);
// Asked for more than the repo could supply — say so rather than let the reader assume the sample
// size they requested is the sample size they got.
if (rows.length < nTargets) {
  console.log(
    `\n  Note: ${nTargets} target(s) requested, ${rows.length} priced — the candidate pool ran out.` +
      " A smaller sample is noisier; compare medians, not totals, across runs.",
  );
}
// SAY WHAT WAS DROPPED. A benchmark that quietly discards the symbols its subject could not handle
// reports the score of a team it also picked. If impact resolved 4 of 10, the ratio describes those
// 4 and the other 6 are the more useful finding.
if (unresolved.length) {
  console.log(
    `\n  ${unresolved.length} of ${attempted} symbols tried are NOT in the numbers above:`,
  );
  console.log(`      ${unresolved.slice(0, 8).join(", ")}${unresolved.length > 8 ? ", ..." : ""}`);
  console.log(
    "      `impact` returned no resolved callers (or asked which symbol was meant), so there was no",
  );
  console.log(
    "      answer to price. Those are the questions the graph does NOT save you tokens on — on this",
  );
  console.log("      repo it is where you still reach for grep.");
}
console.log(`  Reading every matched file WHOLE would be ${totF} tokens.`);
console.log(`  bearing's fixed cost is ~10k tokens/session (contract) + ~15k (graph tool schemas).`);
console.log(`  At ~25k fixed overhead it repays after ${Math.max(1, Math.ceil(25000 / Math.max(1, (totW - totGF) / rows.length)))} question(s).`);
// Trend it. `--json` callers get the same via the file.
const previous = recordRun(root, {
  questions: rows.length,
  graphSummary: totG,
  graphSites: totGF,
  grepRead: totW,
  ratioSites: Number((totW / totGF).toFixed(2)),
});
if (previous?.ratioSites) {
  const now = totW / totGF;
  const delta = ((now - previous.ratioSites) / previous.ratioSites) * 100;
  const moved = Math.abs(delta) >= 10;
  console.log(
    `  Previous run: ${previous.ratioSites.toFixed(1)}x over ${previous.questions} question(s)` +
      (moved
        ? `  —  ${delta > 0 ? "+" : ""}${delta.toFixed(0)}%. A ratio that moves while the codebase did not is the INDEX changing: check that impact still resolves the callers it used to.`
        : `  —  steady.`),
  );
}

console.log(`\n  Estimated at ${CPT} chars/token — a calibration constant, not a tokenizer. Assume +-10%.\n`);
