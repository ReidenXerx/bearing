---
name: bearing-minions
description: "Fan work out to a swarm of cheap, anchored subagents that GATHER — for wide mechanical work you would otherwise grind through serially: finding every call site, auditing N files against one rule, discovering migration sites, cross-referencing a list against the codebase, 'where is this used and how does it flow'. Use when the work is bounded, verifiable, independent and wide (3+ units). NOT when the judgment IS the work, when the answer only survives verbatim, or when the unit needs conversation context the minion was never in. Examples: \"find every place we do X\", \"which files still use the old API\", \"trace all callers of these 12 symbols\", \"audit every route for auth\"."
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
| **Wide** | **3 or more units.** Below that, spawning and reporting cost more than doing it yourself. At three they already run concurrently, so the round-trip is paid once rather than three times. |

**Do NOT fan out when:**

- **The judgment is the work.** *Deciding* whether a fee should be net or gross is yours. *Finding*
  every place the fee is computed is a minion's.
- **The answer must survive verbatim.** Anything that only survives as a summary is corrupted by the
  round-trip. Have the minion return raw text, or read it yourself.
- **The unit needs context the minion was not in.** It will answer confidently and wrongly.
- **Two units.** That is not a fan-out — do it yourself.
- **You are about to delegate the conclusion.** That is the failure mode this whole skill is shaped
  around — see §4.

## 2. Split the work

One minion per **independent unit**, not per arbitrary chunk. A good split is one where two minions
cannot disagree — they are looking at different things, not the same thing from different angles
(that is microscope's job, and it is a different tool).

Say out loud what the units are and how many, before spawning. If you cannot enumerate them, the
work is not bounded and you should not be here.

## 3. What every minion gets

<!-- BEGIN GENERATED: anchored-spawn — bearing regenerates this block; edits here are replaced on update -->
### Anchored spawn — how to send work out

A subagent starts with **none of your context**. That is what makes it cheap and what makes it
drift, so everything below exists to give it back exactly enough and no more.

**1. Persona.** Read `.bearing/domain.json` and give every subagent the SAME pinned persona bearing
resolved at install. Same in wave 2 as in wave 1, same in every unit of a fan-out — an expert that
changes between agents produces findings you cannot compare.

**2. Anchor.** Include the north-stars this task could actually violate — the relevant subset, not
the whole file. A subagent that never sees them will confidently contradict a settled decision, and
one that sees all of them pays that token cost once per agent.

**3. Bounds.** State the unit, what to return, and **what NOT to decide**. Whatever you leave
unstated, a subagent will decide anyway, using context it does not have.

**4. The same tool discipline you follow.** If this repo has the GitNexus module, a subagent must
use the graph — `query` to orient, `cypher` for structure — not grep. A subagent grepping for call
sites is doing the exact thing the gates exist to redirect, one level down where no gate can see it,
and what it brings back is the weaker kind of evidence.

**5. Parallel where the runtime allows it**, sequential where it does not. Claude Code can run them
concurrently; treat that as an optimisation, never as a requirement — the routine must produce the
same answer either way.

**6. Coverage is a claim, so keep it honest.** A subagent that died, timed out, or came back
empty-but-confused has REDUCED YOUR COVERAGE, and silence reads as "I checked everything". Re-run
it, or say plainly what went unchecked. Never let the count of agents you spawned stand in for the
count that actually reported.

**7. Tier follows the return contract.** A subagent that must REASON needs a capable model; one
that only GATHERS does not. Decide the tier from what you are asking it to return, never from
what the task feels like — and if a gatherer seems to need a smarter model, you have asked it to
reason and should take that part back.

**8. Spot-check before you trust.** Open at least one cited `file:line` per subagent and confirm it
says what the report claims. A fabricated citation is the one failure the return shape cannot catch
on its own.
<!-- END GENERATED: anchored-spawn -->

Plus, verbatim:

> Return what you SAW, not what you concluded. Do not judge, rank, recommend, or summarise. If you
> find yourself writing "this looks like", stop and return the line instead.

## 3b. Which model

**Spawn minions on a MIDDLE tier — `sonnet` by default.** Not merely to save money: it is correct
*because* minions do no reasoning. Gathering citations does not need a flagship, and a whole fan-out
on the top tier costs more than doing the work yourself would have.

Override per machine in `.bearing/hooks.local.json` (`"minionModel": "..."`) if your account has
different models available. If the tier you ask for is unavailable, **run anyway on whatever you
get** — a costlier minion is a nuisance; a skipped unit is a hole in the answer.

**The diagnostic that matters:** if you find yourself wanting a *smarter* minion, stop. That is the
signal that you delegated judgment rather than gathering, and the fix is the split, not the model.
Take that part back.

Same rule when a unit keeps returning `MISSED`: **do that unit yourself.** Do not re-run it on a
bigger model. If it needs reasoning to answer, it was never a minion's by NS-24.

### Enumerate the SHAPES, not just the rule

Whatever reference shapes your units contain, list them. A rule that says "check every `.mjs` path"
meets a `.cjs` path and the minion has no instruction for it — the honest ones return `MISSED`, the
literal ones return nothing, and you cannot tell those apart from a clean result.

**If two minions handle the same evidence differently, your bounds were ambiguous, not their work.**
That divergence is a bug report about your prompt; re-run the unit with the shape named.

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
itself a finding.

**Verify the citations mechanically** rather than eyeballing one:

```bash
node .bearing/lib/verify-citations.mjs src/a.ts:88 src/b.ts:12   # or pipe the FOUND lines in
```

It prints what is actually on each line, and exits non-zero if any do not resolve. A fabricated
`file:line` is the one failure the return shape cannot catch by itself — and "3/12 did not resolve"
is a verdict about the REPORT, not about your code. Treat that report as unverified and re-run it.

Only now form the conclusion. It is yours, drawn from evidence you can point at, not inherited from
a cheaper model's summary.

## 6. Coverage must be honest

If a minion died, timed out, or came back empty-but-confused, **say so in your answer**. Silent
under-coverage reads as "I checked everything" when you did not — the same failure as a silent cap.
Re-run it, or state plainly what went unchecked.

**Read every `MISSED` as being about YOUR split, first.** The first real use of this skill handed a
minion a file that did not exist; it returned `MISSED — no such file` instead of a confident
all-clear, and that is how the bad unit was discovered. A `MISSED` is usually the delegator's
mistake, not the minion's.
