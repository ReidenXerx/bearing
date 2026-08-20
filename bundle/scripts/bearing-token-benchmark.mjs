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
import { gitnexusSpawn } from "../.bearing/lib/gitnexus-cmd.mjs";
import { repoName } from "../.bearing/lib/hook-helpers.mjs";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith("--")) || process.cwd());
const jsonOut = args.includes("--json");
const nTargets = Number(args[args.indexOf("--targets") + 1]) || 8;
const WINDOW = 40; // lines of context a careful reader takes around a hit

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
    "MATCH (a)-[r:CodeRelation {type:'CALLS'}]->(b) WHERE b.name IS NOT NULL " +
      "RETURN b.name AS name, b.filePath AS file, count(*) AS callers " +
      `ORDER BY callers DESC LIMIT ${nTargets * 6}`,
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
  return rows;
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
  return { summary: tok(summary.stdout), full: full.ok ? tok(full.stdout) : null };
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

const targets = pickTargets().slice(0, nTargets);
if (!targets.length) {
  console.error(`token-benchmark: no CALLS edges for repo "${REPO}" — is the index built? (bearing:refresh)`);
  process.exit(1);
}

const rows = [];
for (const t of targets) {
  const g = graphCost(t);
  const c = classicalCost(t);
  if (g == null || c == null) continue;
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
  const file = path.join(root, ".bearing", ".token-benchmark.json");
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(file, "utf8")).runs ?? [];
  } catch {
    /* first run here */
  }
  const previous = history.length ? history[history.length - 1] : null;
  history.push(entry);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Keep 20: enough to see a trend, small enough that nobody has to think about the file.
    fs.writeFileSync(file, JSON.stringify({ runs: history.slice(-20) }, null, 2));
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
console.log(`  ${pad("symbol", 24)}${num("callers", 8)}${num("summary", 9)}${num("sites", 8)}${num("grep+read", 11)}${num("vs sum", 8)}${num("vs sites", 9)}`);
console.log(`  ${"-".repeat(77)}`);
for (const r of rows) {
  const worst = r.ratioFull ?? r.ratio;
  const flag = worst < 1 ? "  <- grep is cheaper here" : "";
  console.log(
    `  ${pad(r.name.slice(0, 23), 24)}${num(r.callers, 8)}${num(r.graph, 9)}${num(r.graphFull ?? "-", 8)}${num(r.windows, 11)}` +
      `${num(r.ratio.toFixed(1) + "x", 8)}${num(r.ratioFull ? r.ratioFull.toFixed(1) + "x" : "-", 9)}${flag}`,
  );
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
console.log(`\n  summary = "how big is the blast radius" (counts, risk, flows).`);
console.log(`  sites   = the full response, every call site — what \`git grep\` actually gives you.`);
console.log(`  Compare like for like: "vs sites" is the honest column. Graph won ${wins} of ${rows.length} on it.`);
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
