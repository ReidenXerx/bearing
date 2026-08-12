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
const {
  taskCoreExists,
  taskCorePath,
  sessionKey,
  isPressureNudged,
  setPressureNudged,
  bumpScore,
  lastCheckpointBand,
  setCheckpointBand,
} = await lib("session-primer.mjs");

const config = loadHookConfig(root);
if (!(config.contextPressureThreshold > 0)) process.exit(0); // feature disabled

const p = contextPressure(transcript, config);

// PERIODIC CHECKPOINTS, every `contextCheckpointEvery` of the window.
//
// Fullness alone is a poor trigger: with the window resolving correctly, 90% of 1M is 900,000
// tokens, and across 404 real sessions on one machine only SIX ever got there. The one prompt to
// save state fired in 1.5% of sessions — and the reason it seemed to work before was the false
// alarm, which fired early because the window was wrong.
//
// Bands scale with whatever the window turns out to be: every 100k on a 1M session, every 20k on a
// 200k one. Each band nudges at most once, and only upward, so a compaction that drops the ratio
// does not replay every band on the way back up.
const every = Number(config.contextCheckpointEvery) > 0 ? Number(config.contextCheckpointEvery) : 0.1;
const coreKeyEarly = sessionKey(input.transcript_path);
// The epsilon is load-bearing: 0.7 / 0.1 is 6.999999999999999 in IEEE754, so a session sitting
// exactly on a boundary binned one band LOW and then nudged a second time a few tokens later.
const band = Math.floor(p.ratio / every + 1e-9);
const prev = lastCheckpointBand(root, coreKeyEarly);

// A band spent against a SMALLER window is not a band spent against this one. When evidence arrives
// mid-session and the window is revised upward, "band 9 is done" was a statement about a window that
// turned out not to exist — leaving the rest of the session, which is most of it, with no
// checkpoints at all. Re-anchor to where we now are and carry on upward from there, without firing
// on the revision itself.
if (prev.window && p.window > prev.window) {
  setCheckpointBand(root, coreKeyEarly, band, p.window);
} else if (!p.over && band >= 1 && band > prev.band) {
  setCheckpointBand(root, coreKeyEarly, band, p.window);
  const pct = Math.round(p.ratio * 100);
  const has = taskCoreExists(root, coreKeyEarly);
  emitContext(
    `◔ CONTEXT ~${pct}% (~${Math.round(p.tokens / 1000)}k tok) — checkpoint. ` +
      (has
        ? `Refresh \`${taskCorePath(root, coreKeyEarly)}\` if the task has moved since you wrote it: `
        : `No TASK-CORE for this chat yet — write \`${taskCorePath(root, coreKeyEarly)}\`: `) +
      "GOAL · CONSTRAINTS · DECISIONS(+why) · STATE(done/now/NEXT/todo) · ANCHORS(file:line) · " +
      "GOTCHAS · OPEN-Qs. Terse, AI-facing. Skip it if nothing meaningful changed. " +
      "(Format: the `bearing-taskcore` skill.)",
    "PostToolUse",
  );
  bumpScore(root, "contextCheckpoints");
}

if (p.over) {
  // Nudge once per pressure zone (flag) — but keep nudging while there's still NO task-core,
  // since compacting with no core is straight data loss. Once a core exists, go quiet.
  const coreKey = sessionKey(input.transcript_path);
if (!isPressureNudged(root) || !taskCoreExists(root, coreKey)) {
    const pct = Math.round(p.ratio * 100);
    const kt = Math.round(p.tokens / 1000);
    // Say only what we KNOW. The window is recorded nowhere, so when nothing has proven it we are
    // assuming the smaller one — and asserting "auto-compaction is NEAR" on an assumption is how a
    // 1M session at 20% full got told it was 98% full and started hedging about running out. A
    // guess stated as a fact is worse than a guess stated as a guess (NS-20).
    const certainty =
      p.source === "assumed"
        ? `— IF this is a 200k session auto-compaction is near, but bearing cannot read the window ` +
          `and assumes the smaller one; set \`contextWindowTokens\` in \`.bearing/hooks.local.json\` ` +
          `to settle it. The save-state is cheap either way.`
        : `— auto-compaction is NEAR.`;
    emitContext(
      `⚠ CONTEXT ~${pct}% full (~${kt}k tok) ${certainty} Refresh your TASK-CORE ` +
        // The path is PER CHAT and therefore not guessable — naming the old shared file here sent
        // the agent to write a core that its own recovery would not read.
        `**now**, before the summary drops load-bearing detail: write \`${taskCorePath(root, coreKey)}\` ` +
        "as a DENSE, AI-facing save-state of THIS TASK — GOAL · CONSTRAINTS · DECISIONS(+why) · " +
        "STATE(done/now/NEXT/todo) · ANCHORS(file:line) · GOTCHAS(failed approaches, traps) · " +
        "OPEN-Qs · this-task USER-PREFS. Terse, no prose — it's for you, not humans. It is the ONE " +
        "thing guaranteed to survive compaction; SessionStart reads it back on recovery. " +
        "(Format: the `bearing-taskcore` skill.)",
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
