#!/usr/bin/env node
/**
 * Summarise teaching-eval results into a markdown report.
 *
 *   node eval/teaching/report.mjs <results.jsonl>... > eval/teaching/REPORT.md
 *
 * Applies the decision rule written down BEFORE any run (docs/design/gitnexus-teaching.md §7), so the
 * rule cannot be loosened after the numbers are in. With no `teach` rows yet, it reports the baseline.
 */
import fs from "node:fs";
import { TASKS } from "./tasks.mjs";

const rows = process.argv.slice(2).flatMap((f) =>
  fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
);
const SHAPE_TASKS = ["T2", "T3", "T4", "T9"];
const GRAPH_WIN_TASKS = ["T1", "T7", "T8"];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));
const tok = (r) => (r.tokens ? r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheCreate : 0);

function cell(model, condition, task) {
  const rs = rows.filter((r) => r.model === model && r.condition === condition && (!task || r.task === task));
  const passed = rs.filter((r) => r.pass);
  return {
    n: rs.length,
    pass: passed.length,
    rate: rs.length ? passed.length / rs.length : null,
    f1: mean(rs.filter((r) => r.f1 != null).map((r) => r.f1)),
    cost: mean(rs.map((r) => r.costUsd ?? 0)),
    costPerPass: passed.length ? rs.reduce((s, r) => s + (r.costUsd ?? 0), 0) / passed.length : null,
    tokens: mean(rs.map(tok)),
    tools: mean(rs.map((r) => r.toolCalls ?? 0)),
    graph: mean(rs.map((r) => r.graphCalls ?? 0)),
    denials: mean(rs.map((r) => r.hookDenials ?? 0)),
    secs: mean(rs.map((r) => (r.durationMs ?? 0) / 1000)),
    errors: rs.filter((r) => r.error).length,
  };
}

const models = [...new Set(rows.map((r) => r.model))];
const conditions = ["off", "gates", "teach"].filter((c) => rows.some((r) => r.condition === c));
const out = [];
out.push(`# Teaching-mode eval — ${conditions.includes("teach") ? "decision run" : "baseline"}`, "");
out.push(`Generated ${new Date().toISOString().slice(0, 16)}Z from ${rows.length} runs. Fixture: \`eval/teaching/fixture.mjs\`;`);
out.push("answer keys hand-built and re-derived by text (`verify-keys.mjs`), never from the graph (NS-27).");
out.push("All measures come from Claude Code's own stream-json events, identically for every condition.", "");

for (const model of models) {
  out.push(`## ${model}`, "");
  out.push("| | " + conditions.map((c) => `**${c}**`).join(" | ") + " |", "| --- | " + conditions.map(() => "---").join(" | ") + " |");
  const all = Object.fromEntries(conditions.map((c) => [c, cell(model, c)]));
  const line = (label, f) => out.push(`| ${label} | ${conditions.map((c) => f(all[c])).join(" | ")} |`);
  line("passed", (x) => `${x.pass}/${x.n}`);
  line("mean cost / run (USD)", (x) => fmt(x.cost, 3));
  line("cost per PASSED run (USD)", (x) => fmt(x.costPerPass, 3));
  line("mean tokens / run", (x) => fmt(x.tokens, 0));
  line("mean tool calls / run", (x) => fmt(x.tools, 1));
  line("mean graph calls / run", (x) => fmt(x.graph, 1));
  line("mean hook denials / run", (x) => fmt(x.denials, 1));
  line("mean wall time (s)", (x) => fmt(x.secs, 0));
  line("harness errors", (x) => String(x.errors));
  out.push("");
  out.push("| task | shape | " + conditions.map((c) => `${c}: pass · F1 · $ · graph · denials`).join(" | ") + " |");
  out.push("| --- | --- | " + conditions.map(() => "---").join(" | ") + " |");
  for (const t of TASKS) {
    const cs = conditions.map((c) => {
      const x = cell(model, c, t.id);
      return x.n ? `${x.pass}/${x.n} · ${fmt(x.f1)} · ${fmt(x.cost, 3)} · ${fmt(x.graph, 1)} · ${fmt(x.denials, 1)}` : "—";
    });
    out.push(`| ${t.id} ${t.title} | ${t.shape} | ${cs.join(" | ")} |`);
  }
  out.push("");

  // Misses, verbatim: a score is only as good as the reader's ability to check it.
  const fails = rows.filter((r) => r.model === model && !r.pass);
  if (fails.length) {
    out.push("<details><summary>Failed runs, with what was missed</summary>", "");
    for (const r of fails) out.push(`- ${r.task} · ${r.condition} · #${r.trial}: ${r.error ?? r.detail ?? "?"}`);
    out.push("", "</details>", "");
  }

  if (conditions.includes("teach") && conditions.includes("gates")) {
    // The rule from design §7, applied mechanically.
    const pr = (c, ids) => mean(ids.map((id) => cell(model, c, id).rate ?? 0));
    const noShapeRegress = SHAPE_TASKS.every((id) => (cell(model, "teach", id).rate ?? 0) >= (cell(model, "gates", id).rate ?? 0));
    const overallOk = (all.teach.rate ?? 0) >= (all.gates.rate ?? 0);
    const costOk = (all.teach.costPerPass ?? Infinity) <= (all.gates.costPerPass ?? Infinity);
    const beatsOff = conditions.includes("off") ? pr("teach", GRAPH_WIN_TASKS) > pr("off", GRAPH_WIN_TASKS) : null;
    out.push("### Decision rule (design §7, fixed before running)", "");
    out.push(`- no shape-task (T2–T4, T9) regresses vs gates: **${noShapeRegress ? "yes" : "NO"}**`);
    out.push(`- overall pass rate ≥ gates: **${overallOk ? "yes" : "NO"}**`);
    out.push(`- cost per passed task ≤ gates: **${costOk ? "yes" : "NO"}**`);
    out.push(`- beats off on T1/T7/T8: **${beatsOff == null ? "n/a" : beatsOff ? "yes" : "NO"}**`);
    out.push(`- **verdict: ${noShapeRegress && overallOk && costOk && beatsOff !== false ? "FLIP the default to teach" : "back to design"}**`, "");
  }
}
process.stdout.write(out.join("\n") + "\n");
