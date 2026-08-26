#!/usr/bin/env node
/**
 * bearing — order the test suite by blast radius, so the tests that can fail run first.
 *
 * THIS NEVER SKIPS A TEST, and the distinction is the whole design. The graph is authoritative
 * about what it FINDS and never about what it fails to find: `impact` walks CALLS and does not
 * traverse ACCESSES, a receiver it cannot type drops the call site silently, and a test wired
 * through a fixture factory or a DI container may reach the changed symbol by a path no edge
 * records. Using that absence to skip a test is using a zero as a finding — the exact move the
 * always-on contract forbids, and the one that turns a green suite into a shipped bug.
 *
 * So the output is an ORDER, not a filter. Run the impacted set first for a signal in seconds,
 * then run everything. If the graph is right you learn early; if the graph is wrong you still
 * learn, just as late as you would have anyway. There is no version of this that is worse than
 * not having it, which is the property that makes it safe to trust.
 *
 * Usage:
 *   node scripts/bearing-test-order.mjs                 # unstaged changes
 *   node scripts/bearing-test-order.mjs --scope staged
 *   node scripts/bearing-test-order.mjs --base main     # everything since main
 *   node scripts/bearing-test-order.mjs --report        # human-readable, not a list
 *
 * Machine output is one test file per line on stdout, most-implicated first — feed it to a runner:
 *   node scripts/bearing-test-order.mjs | xargs node --test
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertKitInstalled } from "./lib/require-kit.mjs";

const ROOT = process.cwd();
assertKitInstalled(ROOT);

const { repoName, isTestPath } = await import(
  new URL("../.bearing/lib/hook-helpers.mjs", import.meta.url).href
);
const { gitnexusSpawn } = await import(
  new URL("../.bearing/lib/gitnexus-cmd.mjs", import.meta.url).href
);

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const REPORT = argv.includes("--report");
const BASE = flag("--base", null);
const SCOPE = BASE ? "compare" : flag("--scope", "unstaged");
/** Bounded work: a 400-symbol refactor must not fan out to 400 graph calls (NS-7). */
const MAX_SYMBOLS = Number(flag("--max-symbols", "40"));
const DEPTH = Number(flag("--depth", "3"));


/** @param {string[]} args @returns {{ok: boolean, json: any, text: string}} */
function gn(args) {
  const spec = gitnexusSpawn(args, ROOT);
  const r = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = r.stdout ?? "";
  if (r.status !== 0) return { ok: false, json: null, text };
  try {
    return { ok: true, json: JSON.parse(text), text };
  } catch {
    return { ok: true, json: null, text };
  }
}

/**
 * `detect-changes` prints for humans while `impact` prints JSON, so this reads the one shape the
 * CLI actually gives:  `  Function shouldCopyBundleFile → lib/kit-shared.mjs`
 *
 * A text format is a contract nobody promised, so a parse that finds NOTHING in non-empty output
 * must be loud. Returning [] there would be indistinguishable from "your diff touched no indexed
 * symbols" — a silent no-op wearing the shape of a real answer (GP-6).
 * @param {string} text
 */
export function parseChangedSymbols(text) {
  const start = text.indexOf("Changed symbols:");
  if (start < 0) return { symbols: [], parsed: false };
  const out = [];
  for (const line of text.slice(start).split("\n").slice(1)) {
    if (!line.startsWith("  ")) break;
    const m = line.match(/^\s+(\w+)\s+(\S+)\s+(?:→|->)\s+(\S+)/);
    if (m) out.push({ kind: m[1], name: m[2], filePath: m[3] });
  }
  return { symbols: out, parsed: true };
}

// ── 1. what changed ──────────────────────────────────────────────────────────
const dcArgs = ["detect-changes", "-r", repoName(ROOT), "-s", SCOPE];
if (BASE) dcArgs.push("-b", BASE);
const dc = gn(dcArgs);
if (!dc.ok) {
  console.error(
    "bearing:test-order: detect-changes failed — is the index built? (bearing:refresh)",
  );
  process.exit(1);
}
// JSON if the CLI ever grows it; the printed form until then.
const parsed = dc.json?.changed_symbols
  ? { symbols: dc.json.changed_symbols, parsed: true }
  : parseChangedSymbols(dc.text);
if (!parsed.parsed && dc.text.trim()) {
  console.error(
    "bearing:test-order: could not read detect-changes output — its format changed.\n" +
      "This is bearing's bug, not yours; reporting nothing would look like 'no changes'.\n---\n" +
      dc.text.slice(0, 600),
  );
  process.exit(1);
}
const changed = (parsed.symbols ?? []).filter((s) => s.name);
const truncated = /truncat|partial/i.test(dc.text);
if (!changed.length) {
  if (REPORT) console.log("No indexed symbols changed — nothing to order. Run the suite as usual.");
  process.exit(0);
}

// ── 2. which tests reach them ────────────────────────────────────────────────
const considered = changed.slice(0, MAX_SYMBOLS);
/** test file → how many changed symbols it reaches, and by how short a path */
const hits = new Map();
const uncovered = [];
/** `impact` reports when it knows it is guessing low; that has to reach the reader. */
let anyLowerBound = false;

for (const sym of considered) {
  const args = [
    "impact", sym.name,
    "-r", repoName(ROOT),
    "-d", "upstream",
    "--include-tests",
    "--depth", String(DEPTH),
  ];
  if (sym.filePath) args.push("-f", sym.filePath);
  const res = gn(args).json;
  if (!res) continue;
  if (res.epistemic && res.epistemic !== "exact") anyLowerBound = true;

  const found = new Set();
  for (const [depth, rows] of Object.entries(res.byDepth ?? {})) {
    for (const row of rows) {
      const fp = row.filePath;
      if (!fp || !isTestPath(fp)) continue;
      found.add(fp);
      const prev = hits.get(fp) ?? { symbols: new Set(), nearest: Infinity };
      prev.symbols.add(sym.name);
      prev.nearest = Math.min(prev.nearest, Number(depth));
      hits.set(fp, prev);
    }
  }
  if (!found.size) uncovered.push(sym);
}

// Most symbols reached first, then shortest path — a test that exercises three changed things
// directly is a better first signal than one that reaches one of them three hops away.
const ordered = [...hits.entries()].sort(
  (a, b) => b[1].symbols.size - a[1].symbols.size || a[1].nearest - b[1].nearest,
);

// ── 3. say it ────────────────────────────────────────────────────────────────
if (!REPORT) {
  for (const [file] of ordered) console.log(file);
  process.exit(0);
}

const n = (x) => String(x);
console.log(`\n  Blast-radius test order — ${repoName(ROOT)} (${SCOPE}${BASE ? ` vs ${BASE}` : ""})\n`);
console.log(`  ${n(changed.length)} changed symbol(s); ${n(ordered.length)} test file(s) reach them.\n`);
for (const [file, info] of ordered.slice(0, 20)) {
  console.log(`    ${file}`);
  console.log(
    `        reaches ${n(info.symbols.size)} changed symbol(s), nearest at depth ${n(info.nearest)}` +
      ` — ${[...info.symbols].slice(0, 3).join(", ")}${info.symbols.size > 3 ? ", …" : ""}`,
  );
}
if (ordered.length > 20) console.log(`    …and ${n(ordered.length - 20)} more`);

console.log("\n  RUN THESE FIRST, THEN RUN EVERYTHING. This is an order, not a filter.");

if (uncovered.length) {
  console.log(`\n  ${n(uncovered.length)} changed symbol(s) with no test file in their blast radius:`);
  for (const s of uncovered.slice(0, 10)) console.log(`    ${s.name}  ${s.filePath ?? ""}`);
  if (uncovered.length > 10) console.log(`    …and ${n(uncovered.length - 10)} more`);
  console.log(
    "      That is 'no test FOUND', not 'not tested'. A test reaching it through a fixture\n" +
      "      factory, a DI container or a field read leaves no CALLS edge for this to walk.",
  );
}

const caveats = [];
if (anyLowerBound) {
  caveats.push(
    "at least one impact came back `lower-bound` — callers exist that the graph could not trace, " +
      "so the impacted set is a floor",
  );
}
if (changed.length > considered.length) {
  caveats.push(
    `only the first ${n(considered.length)} of ${n(changed.length)} changed symbols were walked ` +
      `(--max-symbols); the rest are unexamined, not unaffected`,
  );
}
if (truncated) caveats.push("detect-changes reported a truncated or partial diff");
caveats.push("`impact` does not traverse ACCESSES, so a pure field read reaches nothing here");
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, ".gitnexus/meta.json"), "utf8"));
if (meta?.lastCommit) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim();
  if (head && meta.lastCommit !== head) {
    caveats.push("the index is behind HEAD — this order reflects the code as it was last indexed");
  }
}
console.log("\n  What this order does NOT know:");
for (const c of caveats) console.log(`    · ${c}`);
console.log();

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  /* entry point — nothing further */
}
