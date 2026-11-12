#!/usr/bin/env node
/**
 * Summarise judgment-layer eval results into a markdown report.
 *
 *   node eval/intel/report.mjs <results.jsonl>... > eval/intel/REPORT.md
 *
 * THE DECISION RULE IS WRITTEN HERE, BEFORE ANY RUN, so it cannot be loosened after the numbers are
 * in. Per module, over the module's own tasks, comparing `on` with `off`:
 *
 *   KEEP      `on` passes more trials than `off`; or as many, at no more than 1.25× the cost.
 *   REWORK    `on` passes as many but costs more than 1.25×; or it changes only a flag (says the
 *             right thing) without changing the outcome.
 *   CUT?      `on` passes fewer trials than `off`. A question mark, because with three trials per
 *             cell one flaky run moves a verdict — a CUT here earns a closer look, not a deletion.
 *
 * Every module also pays for the always-on contract on tasks that are not its own; the report shows
 * the overall cost ratio so that price stays visible.
 *
 * ADDED BEFORE THE HARD ROUND RAN (2026-11-12), for tasks that report `found` (partial credit —
 * tasks-hard.mjs): when `on` and `off` pass the same number of trials, the mean `found` decides
 * instead — higher is KEEP, lower is CUT?, equal falls through to the cost rule. A pass is all-or-
 * nothing, and the first round showed what that does at the ceiling: it cannot tell 63 of 75 from 75.
 *
 * ADDED BEFORE THE INVOKED ROUND RAN (2026-11-12), for tasks that report `broken` (decoys a review
 * "fixed" into a bug — tasks-invoked.mjs): when pass and mean `found` both tie, FEWER broken decoys is
 * KEEP and more is CUT?. A review that breaks correct code is worse than one that misses a bug.
 */
import fs from "node:fs";
import { TASKS as BASE_TASKS } from "./tasks.mjs";
import { HARD_TASKS } from "./tasks-hard.mjs";
import { INVOKED_TASKS } from "./tasks-invoked.mjs";

const TASKS = [...BASE_TASKS, ...HARD_TASKS, ...INVOKED_TASKS];

const rows = process.argv.slice(2).flatMap((f) =>
  fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const FLAGS = ["flagged", "invented", "askedNeedlessly", "overkill", "fannedOut", "brokeDecoy"];

function cell(condition, pred) {
  const rs = rows.filter((r) => r.condition === condition && pred(r));
  const flags = Object.fromEntries(FLAGS.map((f) => [f, rs.filter((r) => r[f] === true).length]));
  return {
    n: rs.length,
    pass: rs.filter((r) => r.pass).length,
    cost: mean(rs.map((r) => r.costUsd ?? 0)),
    secs: mean(rs.map((r) => (r.durationMs ?? 0) / 1000)),
    tools: mean(rs.map((r) => r.toolCalls ?? 0)),
    subagents: mean(rs.map((r) => r.subagents ?? 0)),
    broken: rs.some((r) => typeof r.broken === "number") ? mean(rs.filter((r) => typeof r.broken === "number").map((r) => r.broken)) : null,
    found: rs.some((r) => typeof r.found === "number") ? mean(rs.filter((r) => typeof r.found === "number").map((r) => r.found)) : null,
    errors: rs.filter((r) => r.error).length,
    flags,
  };
}

const models = [...new Set(rows.map((r) => r.model))];
const out = [];
out.push("# Judgment-layer eval — results", "");
out.push(`${rows.length} runs · models: ${models.join(", ")} · conditions: off (no bearing) vs on (default modules, no GitNexus).`);
out.push("Scored by checks the harness owns (`eval/intel/tasks.mjs`), never by bearing's telemetry (NS-27).", "");

out.push("## Per task", "");
out.push("| Task | Module | off pass | on pass | found, mean (off → on) | off $ | on $ | off subagents | on subagents | flags (off → on) |");
out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const t of TASKS) {
  const off = cell("off", (r) => r.task === t.id);
  const on = cell("on", (r) => r.task === t.id);
  if (!off.n && !on.n) continue;
  const flags = FLAGS.filter((f) => off.flags[f] || on.flags[f]).map((f) => `${f} ${off.flags[f]}→${on.flags[f]}`).join(", ");
  const found = off.found == null && on.found == null ? "—" : `${fmt(off.found, 1)} → ${fmt(on.found, 1)}` + (off.broken != null || on.broken != null ? ` (decoys broken ${fmt(off.broken, 1)} → ${fmt(on.broken, 1)})` : "");
  out.push(`| ${t.id} ${t.title} | ${t.module} | ${off.pass}/${off.n} | ${on.pass}/${on.n} | ${found} | ${fmt(off.cost)} | ${fmt(on.cost)} | ${fmt(off.subagents, 1)} | ${fmt(on.subagents, 1)} | ${flags || "—"} |`);
}

out.push("", "## Per module — the verdict", "");
out.push("| Module | off pass | on pass | cost ratio on/off | verdict |");
out.push("| --- | --- | --- | --- | --- |");
for (const mod of [...new Set(TASKS.map((t) => t.module))]) {
  const off = cell("off", (r) => r.module === mod);
  const on = cell("on", (r) => r.module === mod);
  if (!off.n || !on.n) continue;
  const ratio = off.cost ? on.cost / off.cost : null;
  const flagOnly = on.pass === off.pass && FLAGS.some((f) => f === "flagged" && on.flags[f] > off.flags[f]);
  const byFound = on.pass === off.pass && off.found != null && on.found != null && on.found !== off.found;
  const byBroken = on.pass === off.pass && !byFound && off.broken != null && on.broken != null && on.broken !== off.broken;
  const verdict =
    on.pass > off.pass ? "KEEP" :
    on.pass < off.pass ? "CUT?" :
    byFound ? (on.found > off.found ? "KEEP (more found)" : "CUT? (less found)") :
    byBroken ? (on.broken < off.broken ? "KEEP (fewer decoys broken)" : "CUT? (more decoys broken)") :
    flagOnly ? "REWORK (changes what it says, not what it does)" :
    ratio != null && ratio > 1.25 ? "REWORK (same outcome, more cost)" : "KEEP";
  out.push(`| ${mod} | ${off.pass}/${off.n} | ${on.pass}/${on.n} | ${fmt(ratio)}× | ${verdict} |`);
}

const allOff = cell("off", () => true);
const allOn = cell("on", () => true);
out.push("", "## Overall", "");
out.push(`- pass: off ${allOff.pass}/${allOff.n} (${pct(allOff.n ? allOff.pass / allOff.n : null)}) · on ${allOn.pass}/${allOn.n} (${pct(allOn.n ? allOn.pass / allOn.n : null)})`);
out.push(`- mean cost per run: off $${fmt(allOff.cost, 3)} · on $${fmt(allOn.cost, 3)} (${fmt(allOff.cost ? allOn.cost / allOff.cost : null)}×)`);
out.push(`- mean seconds per run: off ${fmt(allOff.secs, 0)} · on ${fmt(allOn.secs, 0)}`);
out.push(`- errored runs: off ${allOff.errors} · on ${allOn.errors}`);
const trials = Math.max(0, ...rows.map((r) => r.trial ?? 0));
out.push("", `With ${trials} trial(s) per cell, one run moves a verdict. Read a CUT? as "look closer", never as "delete".`);

out.push("", "## Failures, verbatim", "");
for (const r of rows.filter((r) => !r.pass)) out.push(`- ${r.task} ${r.condition} #${r.trial}: ${r.detail ?? r.error ?? "—"}`);

process.stdout.write(out.join("\n") + "\n");
