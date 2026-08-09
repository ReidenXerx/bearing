# Minion harness — design

**Status:** implemented. Module `minions` (Claude Code only); skill `bearing-minions`; trigger in the
always-on contract. This doc is the reasoning behind it, not a plan.

## What it is

The main agent fans out a set of subagents on a cheaper tier to do bounded, mechanical work —
tracing, gathering, cross-referencing — each arriving already anchored on the project's north-stars
and persona, each reporting back evidence the main agent then reasons over.

## What it is NOT

Not "bearing can spawn subagents". Every runtime that matters can already do that. **The capability
exists; the judgment does not.** An agent asked to trace 40 call sites will do it itself, serially,
badly, and never consider fanning out — not because it lacks the tool but because nothing told it
this is the shape of problem that wants one.

That is the whole product thesis, and it is the same one microscope embodies: an agent can already
review code and adopt a persona and argue with itself. Microscope's value is knowing that a
milestone is when to do all three at once. **Minions are that, for gathering.**

So the deliverable is ordered: the TRIGGER first, the harness second. A harness nobody invokes at
the right moment is worth nothing.

## 1. Triggers — when to fan out

Reach for minions when **all** of these hold:

- **Bounded** — each unit of work has a definite end. "Find every call site of `X`" ends; "improve
  the architecture" does not.
- **Verifiable** — the answer is checkable against the repo (a path, a line, a command's output).
  If the main agent cannot check it, it is trusting testimony.
- **Independent** — unit N does not need unit N−1's answer. Sequential work fans out into a queue
  of agents waiting on each other, which is slower than doing it alone.
- **Wide** — 3 or more units. Below that, spawn overhead and the reporting round-trip cost more
  than doing it yourself. At three they already run concurrently, so the round-trip is paid once.

Canonical shapes: migration site discovery, "where is this used and how does it flow", auditing N
files against one rule, cross-referencing a list against the codebase, reading many files to answer
one question.

## 2. Anti-triggers — when it makes things worse

- **The judgment is the work.** Deciding whether a fee should be computed on gross or net is not
  delegable; finding every place the fee is computed is.
- **The answer must be exact and long.** Anything that survives only as a summary is corrupted by
  the round-trip. Have the minion return the raw text, or read it yourself.
- **The context is the point.** A unit that only makes sense given a conversation the minion was
  not in will be answered confidently and wrongly.
- **Small N.** Two units is not a fan-out.

### The rule that prevents the failure mode

**Minions gather. The main agent concludes.**

A minion that returns a conclusion has inserted a lossy summarizer between the evidence and the
decision — which makes this a drift *amplifier*, the exact opposite of what bearing is for. The
main agent must reach its own conclusion from returned evidence it can spot-check.

## 3. Return contract

Every minion returns evidence, not prose:

```
FOUND    <file:line> — <the actual line or output, verbatim>
CHECKED  <what was searched, and how — the exact query/command>
MISSED   <what it could not determine, and why>
```

Three properties this buys:

- **Spot-checkable.** The main agent can open any cited line and confirm. Testimony becomes evidence.
- **A silent nothing is distinguishable from a failure.** `CHECKED` populated with `FOUND` empty
  means it looked and there was nothing. Both empty means it did not understand the task. Without
  this split they are the same message, and the same asymmetric-contract failure as reading a graph
  zero as absence.
- **Cheap to merge.** N reports of citations dedupe mechanically; N reports of prose do not.

## 4. Anchor propagation

Each minion receives, in order:

1. **The relevant north-stars** — not all of them. The subset the task could violate. A minion
   tracing imports does not need the evidence-standard north-stars, and the token cost of shipping
   all of them × N is real.
2. **The persona** from `.bearing/domain.json` — the same pinned one microscope uses, so a minion
   reads a trading repo as a trader.
3. **The task, and its bounds** — what to return, and explicitly what NOT to decide.

## 5. Open questions

- **Tier is config, not identity.** "Sonnet" is today's answer to "cheap enough, smart enough".
  Encode the task shape; let the model be a setting.
- **Runtime reach.** Only Claude Code can spawn subagents with a model choice. Under NS-14 this is a
  Claude-only module and the README must say so plainly rather than implying parity.
- ~~**Relationship to microscope.**~~ **Settled.** The spawn MECHANICS are extracted to
  `scripts/skill-fragments/anchored-spawn.md` and rendered into both skills by `npm run gen:skills`,
  with a test that fails if a copy goes stale. The RETURN CONTRACT is deliberately NOT shared: a
  microscope lens must reason — opinions are the point — and a minion must not (NS-24). Unifying
  those would either silence the lenses or let the minions editorialise.
- **Failure of a minion.** A subagent that dies or times out must not silently reduce coverage. What
  was not checked has to reach the user, the same way a silent cap would.
