#!/usr/bin/env node
// Claude Code PostToolUse → estimate how full the context window is; when auto-compaction is
// NEAR, nudge the agent to refresh its TASK-CORE (dense AI save-state) BEFORE the summary drops
// detail. PreCompact can't inject context or make the agent act, so this PostToolUse hook is
// where the pre-compaction "migrate the task" trigger lives (additionalContext is valid here).
import path from "node:path";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* empty */
}

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const transcript = input.transcript_path || "";
if (!transcript) process.exit(0);

const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);
const { loadHookConfig } = await lib("hook-helpers.mjs");
const { contextPressure } = await lib("context-pressure.mjs");
const { emitContext } = await lib("claude-emit.mjs");
const { taskCoreExists, isPressureNudged, setPressureNudged, bumpScore } =
  await lib("session-primer.mjs");

const config = loadHookConfig(root);
if (!(config.contextPressureThreshold > 0)) process.exit(0); // feature disabled

const p = contextPressure(transcript, config);

if (p.over) {
  // Nudge once per pressure zone (flag) — but keep nudging while there's still NO task-core,
  // since compacting with no core is straight data loss. Once a core exists, go quiet.
  if (!isPressureNudged(root) || !taskCoreExists(root)) {
    const pct = Math.round(p.ratio * 100);
    const kt = Math.round(p.tokens / 1000);
    emitContext(
      `⚠ CONTEXT ~${pct}% full (~${kt}k tok) — auto-compaction is NEAR. Refresh your TASK-CORE ` +
        "**now**, before the summary drops load-bearing detail: write `.bearing/.gitnexus-task-core.md` " +
        "as a DENSE, AI-facing save-state of THIS TASK — GOAL · CONSTRAINTS · DECISIONS(+why) · " +
        "STATE(done/now/NEXT/todo) · ANCHORS(file:line) · GOTCHAS(failed approaches, traps) · " +
        "OPEN-Qs · this-task USER-PREFS. Terse, no prose — it's for you, not humans. It is the ONE " +
        "thing guaranteed to survive compaction; SessionStart reads it back on recovery. " +
        "(Format: the `gitnexus-taskcore` skill.)",
      "PostToolUse",
    );
    setPressureNudged(root, true);
    bumpScore(root, "contextPressureNudges");
  }
} else if (p.ratio < config.contextPressureThreshold - 0.1) {
  // Pressure fell well below the line (a compaction shrank the transcript) → re-arm the nudge.
  setPressureNudged(root, false);
}
// otherwise: stay silent (hysteresis band, or over-threshold with a fresh core already written)
