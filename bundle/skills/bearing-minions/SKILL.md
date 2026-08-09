---
name: bearing-minions
description: "Fan work out to a swarm of cheap, anchored subagents that GATHER — for wide mechanical work you would otherwise grind through serially: finding every call site, auditing N files against one rule, discovering migration sites, cross-referencing a list against the codebase, 'where is this used and how does it flow'. Use when the work is bounded, verifiable, independent and wide (~5+ units). NOT when the judgment IS the work, when the answer only survives verbatim, or when the unit needs conversation context the minion was never in. Examples: \"find every place we do X\", \"which files still use the old API\", \"trace all callers of these 12 symbols\", \"audit every route for auth\"."
---

# Minions — fan out to gather, keep the thinking

You can already spawn subagents. What you do not do is notice **when you should** — so you grind
through forty files serially, or worse, sample five and generalise. This skill is that judgment.

**Minions gather. You conclude.** They do **minimal or zero reasoning**.

## 1. Should you fan out at all?

All four must hold:

| | |
|---|---|
| **Bounded** | Each unit has a definite end. "Find every caller of `X`" ends. "Improve the architecture" does not. |
| **Verifiable** | You can check the answer against the repo — a path, a line, a command's output. If you cannot check it, you are trusting testimony. |
| **Independent** | Unit N does not need unit N−1's answer. Sequential work becomes a queue of agents waiting on each other, which is slower than doing it yourself. |
| **Wide** | Roughly 5+ units. Below that, spawning and reporting cost more than the work saved. |

**Do NOT fan out when:**

- **The judgment is the work.** *Deciding* whether a fee should be net or gross is yours. *Finding*
  every place the fee is computed is a minion's.
- **The answer must survive verbatim.** Anything that only survives as a summary is corrupted by the
  round-trip. Have the minion return raw text, or read it yourself.
- **The unit needs context the minion was not in.** It will answer confidently and wrongly.
- **You are about to delegate the conclusion.** That is the failure mode this whole skill is shaped
  around — see §4.

## 2. Split the work

One minion per **independent unit**, not per arbitrary chunk. A good split is one where two minions
cannot disagree — they are looking at different things, not the same thing from different angles
(that is microscope's job, and it is a different tool).

Say out loud what the units are and how many, before spawning. If you cannot enumerate them, the
work is not bounded and you should not be here.

## 3. What every minion gets

1. **The relevant north-stars** — the subset this task could violate, not all of them. A minion
   tracing imports does not need the evidence-standard ones, and the token cost is paid N times.
2. **The persona** from `.bearing/domain.json`, so a minion reads a trading repo as a trader.
3. **Its unit, its bounds, and what NOT to decide** — stated explicitly.

Tell each one, verbatim:

> Return what you SAW, not what you concluded. Do not judge, rank, recommend, or summarise. If you
> find yourself writing "this looks like", stop and return the line instead.

## 4. The return contract

Every minion returns exactly this shape:

```
FOUND    <file:line> — <the actual line or output, verbatim>
CHECKED  <what it searched, and how — the exact query, command or glob>
MISSED   <what it could not determine, and why>
```

Why this shape and not prose:

- **You can spot-check it.** Open a cited line and confirm. Testimony becomes evidence.
- **A silent nothing is distinguishable from a failure.** `CHECKED` filled with `FOUND` empty means
  it looked and there was nothing there. **Both empty means it never understood the task** — a
  completely different fact, and one that looks identical in prose. Collapsing them is the same
  error as reading a graph zero as absence.
- **It merges mechanically.** N lists of citations dedupe. N paragraphs of prose do not.

Reject a report that reasons. If a minion returns "this is probably fine", you have no evidence —
re-run that unit, or check it yourself.

## 5. Then YOU do the thinking

Merge the citations. Look for what nobody found — a `MISSED` from three minions in the same area is
itself a finding. **Spot-check at least one citation per minion**; a fabricated `file:line` is the
one failure this shape cannot rule out on its own.

Only now form the conclusion. It is yours, drawn from evidence you can point at, not inherited from
a cheaper model's summary.

## 6. Coverage must be honest

If a minion died, timed out, or came back empty-but-confused, **say so in your answer**. Silent
under-coverage reads as "I checked everything" when you did not — the same failure as a silent cap.
Re-run it, or state plainly what went unchecked.
