---
name: bearing-taskcore
description: "Maintain a dense, AI-facing TASK-CORE save-state so a long task survives context COMPACTION without drift. Load it when: a PostToolUse nudge says edits have accumulated since the core was last written, at a milestone / before a risky pivot / when the task shifts, OR on recovery after a compaction (read it back first). The core is for the model, not humans — terse, anchors over prose. Examples: \"context is filling — save state\", \"update the task core\", \"clean it from log-like things but keep the lessons\", \"checkpoint the task before compaction\", \"recover the task after compaction\"."
---

# Task-core — a compaction save-state that kills drift

When a long task runs, Claude Code **compacts**: it summarizes the conversation and drops the transcript. The generic summary keeps the gist but loses load-bearing detail — a constraint the user gave, a decision's *why*, the exact file:line you were mid-edit on, a dead-end you already ruled out. After compaction the agent **drifts**: re-litigates settled calls, repeats failed approaches, forgets requirements.

The fix: **you** decide what survives. Keep a **task-core** — a dense, machine-facing save-state of the CURRENT TASK — and read it back on recovery. It's the one artifact guaranteed to survive with full fidelity.

**File:** `.bearing/task-cores/<chat-id>.md` — **one per CHAT**, not one per repo. The SessionStart brief names your exact path; use that one. Gitignored; survives compaction *and* new sessions — a task can span both; overwrite it when the task changes.

> Several agent sessions run in the same repository routinely (a second editor window is enough). A single shared file meant they overwrote each other, and on recovery a session would reconstruct from **another chat's task** with full confidence — the exact drift a task-core exists to prevent. If the brief gives you no path, fall back to `.bearing/task-cores/shared.md`.

## When to write / refresh it

- **Unsaved-work nudge** — a PostToolUse hook counts EDITS since the core was last written and prompts after `taskCoreEveryEdits` of them (25 by default; 0 disables). It is *skippable*: refresh if the task actually moved, ignore it if not.
  > It no longer watches how full the context is, because **the window is not knowable at runtime** — the transcript does not record it, the model id does not settle it, and the one real measurement arrives only after a compaction has already happened. Two attempts at inferring it shipped wrong in opposite directions. What matters is not how full the window is but **how much has happened that is not written down**: five edits at 95% lose almost nothing, two hundred at 30% lose a great deal.
- **Nothing warns you that compaction is near.** Assume it can land at any time — that is why the trigger is unsaved work rather than a countdown.
- **Milestones** — a sub-goal done, a decision settled, a pivot. Cheap insurance so a *sudden* auto-compact never catches you with a stale core.
- **Task start / task shift** — seed a fresh core when a new task begins (don't carry the old one).

You don't need to rewrite it every turn — that wastes tokens. Refresh on the nudge and at real milestones.

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

## Distill — on the nudge, when asked, or before compaction

**Update it, clean it from log-like things, keep all lessons, scars and valuable things.**

A rewrite, not an append: a core that only grows becomes the transcript it exists to replace.

One exception to "keep" — if a lesson outlives THIS task, move it to `.bearing/gold-practices.md`
first, then delete it here. The core is per-chat; anything left in it dies with the chat.

Git already keeps the log. A core that duplicates commits pays context for a worse copy.

## On recovery — read it WHOLE

The SessionStart brief points you here. **Read the entire file: no `offset`, no `limit`, no skim.**

The one file where the usual discipline is wrong. The contract says to page large source with
offset/limit, because source is huge and you want one part of it. This is one screen, every line
survived a prune because deleting it would cost you work, and you cannot tell which line that is
until you have read it. A partial read is this file's own failure mode wearing the costume of
recovery: you do not know what you missed, so you proceed confidently on the rest.

Then:

1. Reconstruct the task — goal, constraints, decisions, state, next.
2. **Verify against reality.** It is a point-in-time snapshot; a file may have moved. Confirm an
   anchor before trusting it.
3. Continue from `NEXT`. Do not re-derive what `DECISIONS` settles, and do not repeat what is in
   `GOTCHAS` — that section is there because it already cost someone the time.

## Task-core vs. MEMORY.md

- **MEMORY.md** — durable, cross-session, human-shared *project* memory (who/what/why of the project over time).
- **Task-core** — the *hot working-set for THIS task*, machine-optimized, ephemeral, overwritten per task.

They complement: on recovery, read the **task-core first** (it's the current task), then reconcile with MEMORY.md for durable context.

## Anti-patterns

- Writing it human-pretty (headings, prose, hedging) — wastes the token budget it exists to save.
- Only writing it once at the start — refresh at the nudge and milestones or it goes stale.
- Dumping the whole transcript — the point is *distillation*: decisions, state, anchors, gotchas, next. If it reads like a diary, it's wrong.
- Trusting it blindly on recovery — always verify anchors against the live code.
