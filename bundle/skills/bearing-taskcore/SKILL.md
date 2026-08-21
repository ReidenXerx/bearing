---
name: bearing-taskcore
description: "Maintain a dense, AI-facing TASK-CORE save-state so a long task survives context COMPACTION without drift. Load it when: a PostToolUse nudge says edits have accumulated since the core was last written, at a milestone / before a risky pivot / when the task shifts, OR on recovery after a compaction (read it back first). The core is for the model, not humans — terse, anchors over prose. Examples: \"context is filling — save state\", \"checkpoint the task before compaction\", \"recover the task after compaction\"."
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

## On refresh — a rewrite, not an append

The nudge fires every N edits and says *refresh*. **That means rewriting the file so it describes
the task as it is NOW** — not adding today's paragraph to yesterday's. A core that only ever grows
becomes the thing it exists to replace: a transcript, with the same problem of burying the load-
bearing detail in narrative.

One test per line, applied on every refresh:

> **If I deleted this line, would a future me redo work or repeat a mistake?**

Keep it if yes. Delete it if no. Specifically:

| Drop | Keep |
| --- | --- |
| Finished steps whose outcome is now IN THE CODE — the code says it better | The **why** behind a decision, when it still constrains what comes next |
| Resolved OPEN-Qs (fold the answer into DECISIONS, delete the question) | Gotchas that would still bite — a trap you could walk into again today |
| GOTCHAS about code that no longer exists | The user's exact wording on a constraint |
| ANCHORS to files you are finished with | ANCHORS you will open again |
| A DONE list that has become a changelog | One line of DONE, if it stops you re-opening a settled question |

**Git already keeps the log.** Completed work lives in commits, which are searchable, dated and
permanent — a task-core that duplicates them is paying context for a worse copy.

A healthy core stays roughly the same SIZE across refreshes: things leave as things arrive. If it
grows every time, it is being appended to rather than rewritten, and the signal is thinning with
every pass.

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
