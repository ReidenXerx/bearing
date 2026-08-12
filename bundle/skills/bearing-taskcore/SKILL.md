---
name: bearing-taskcore
description: "Maintain a dense, AI-facing TASK-CORE save-state so a long task survives context COMPACTION without drift. Load it when: a PostToolUse nudge says context is ~90% full, at a milestone / before a risky pivot / when the task shifts, OR on recovery after a compaction (read it back first). The core is for the model, not humans — terse, anchors over prose. Examples: \"context is filling — save state\", \"checkpoint the task before compaction\", \"recover the task after compaction\"."
---

# Task-core — a compaction save-state that kills drift

When a long task runs, Claude Code **compacts**: it summarizes the conversation and drops the transcript. The generic summary keeps the gist but loses load-bearing detail — a constraint the user gave, a decision's *why*, the exact file:line you were mid-edit on, a dead-end you already ruled out. After compaction the agent **drifts**: re-litigates settled calls, repeats failed approaches, forgets requirements.

The fix: **you** decide what survives. Keep a **task-core** — a dense, machine-facing save-state of the CURRENT TASK — and read it back on recovery. It's the one artifact guaranteed to survive with full fidelity.

**File:** `.bearing/task-cores/<chat-id>.md` — **one per CHAT**, not one per repo. The SessionStart brief names your exact path; use that one. Gitignored; survives compaction *and* new sessions — a task can span both; overwrite it when the task changes.

> Several agent sessions run in the same repository routinely (a second editor window is enough). A single shared file meant they overwrote each other, and on recovery a session would reconstruct from **another chat's task** with full confidence — the exact drift a task-core exists to prevent. If the brief gives you no path, fall back to `.bearing/task-cores/shared.md`.

## When to write / refresh it

- **Periodic checkpoints** — a PostToolUse hook nudges every 10% of the window (`contextCheckpointEvery`), each band once. These are *skippable*: refresh the core if the task has actually moved, otherwise ignore them. Waiting for the 90% warning is not a plan — on a 1M window that is 900k tokens, which most sessions never reach.
- **Context-pressure nudge** — at ~90% (`contextPressureThreshold` × the window) it says compaction is near. **Refresh the core immediately** — this is the last reliable window before the summary lands. The window is inferred from evidence, not assumed; if bearing says it is assuming, set `contextWindowTokens` in `.bearing/hooks.local.json`.
- **Milestones** — a sub-goal done, a decision settled, a pivot. Cheap insurance so a *sudden* auto-compact never catches you with a stale core.
- **Task start / task shift** — seed a fresh core when a new task begins (don't carry the old one).

You don't need to rewrite it every turn — that wastes tokens. Refresh on the nudge and at real checkpoints.

## The format (dense, for the model — not humans)

Terse. No prose transitions, no politeness, no restating the obvious. **Anchors over narrative.** Optimize signal-per-token — the only reader is you, post-compaction.

```
# TASK-CORE — <one-line task> (refreshed @ <marker>)
GOAL:        <what "done" looks like, measurable>
CONSTRAINTS: <hard invariants — must / never; the user's non-negotiables>
DECISIONS:   <choice → why>   (settled — so you don't re-litigate them)
STATE:
  DONE: <✓ fact + file:line anchor>
  NOW:  <current sub-step>
  NEXT: <the exact next action(s)>
  TODO: <remaining, ordered>
ANCHORS:  <file:line → what's there / why it matters>   (your map to resume fast)
GOTCHAS:  <failed approaches, traps, non-obvious facts — so you don't repeat them>
OPEN-Qs:  <unresolved / needs a decision>
USER-PREFS(this task): <corrections + constraints the user gave THIS task>
```

**Include** the things a summary drops: the *why* behind decisions, dead-ends already ruled out, exact anchors, the user's precise wording on constraints, the immediate next action. **Exclude** narrative recap, tool-by-tool history, and anything re-derivable from the code in seconds.

## On recovery (post-compaction / resume)

The SessionStart brief points you here. **Read the task-core FIRST**, before acting:
1. Reconstruct the task from it — goal, constraints, decisions, state, next.
2. **Verify against reality** (the core is a point-in-time snapshot; a file may have moved). Don't trust an anchor blindly — confirm it.
3. Continue from `NEXT`. Do **not** re-derive what the core already settles, and do **not** repeat anything in `GOTCHAS`.

## Task-core vs. MEMORY.md

- **MEMORY.md** — durable, cross-session, human-shared *project* memory (who/what/why of the project over time).
- **Task-core** — the *hot working-set for THIS task*, machine-optimized, ephemeral, overwritten per task.

They complement: on recovery, read the **task-core first** (it's the current task), then reconcile with MEMORY.md for durable context.

## Anti-patterns

- Writing it human-pretty (headings, prose, hedging) — wastes the token budget it exists to save.
- Only writing it once at the start — refresh at the nudge and milestones or it goes stale.
- Dumping the whole transcript — the point is *distillation*: decisions, state, anchors, gotchas, next. If it reads like a diary, it's wrong.
- Trusting it blindly on recovery — always verify anchors against the live code.
