---
name: bearing-microscope
description: "Deep multi-lens audit ('microscope waves') for MILESTONE moments — feature done / big-task checkpoint / shared-code refactor / pre-ship, or when asked to 'audit / find real bugs / is this solid'. NOT for small localized changes. Goes beyond cascade code-review: it opinionates (relevance, soundness, over-engineering) as a senior domain expert, verifies findings adversarially, and iterates in waves. Examples: \"microscope this\", \"audit before we ship\", \"find the real oversights\", \"deep review this refactor\"."
---

# Microscope waves — deep, opinionated, verified audit

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->


This is **not** a cascade code review or a linter pass. A microscope wave scrutinizes a target from many independent angles, **has real opinions** (is this even needed? is this the right approach? is it over-engineered?), verifies every finding **against real logic — not "does it run"**, and iterates in numbered **waves** until clean. With the GitNexus module installed it is the power-composition of that whole toolset; without it the same routine runs on a classically-built map.

## When to run (trigger) — and when NOT (scope gate)

Fire at **milestone boundaries**: a feature is "done" / pre-PR / pre-ship · a checkpoint in a large multi-step task · after a refactor touching shared/hub code · the user asks to "audit / review deeply / find real bugs / is this solid?".

**Scope gate (avoid harm):** run the full waves only when the work is *substantial* — multi-file, OR touches a hub (`impact` blast-radius with the graph; `git diff --stat` plus who-imports-this without it), OR high-risk path. A small localized change → **skip**, or run one quick lens. Don't fan out six agents on a one-file fix. This is a **capability you invoke**, not a mandatory gate — use judgment.

## Two KINDS of lenses (not a fixed list)

You **spawn concrete lenses dynamically from the map** — one per meaningful flow / layer / architectural surface / seam — and each lens is one of two KINDS. Important slices get **both** kinds.

| KIND | The question | Sub-angles |
| --- | --- | --- |
| **A — Correctness** ("is it right?") | Does this slice actually work + do the right computation? | logic/formula correctness · null/empty/boundary edge-cases · state/env-threading/data-freshness/races · cross-surface consistency & contract agreement · security/taint · performance/cost |
| **B — Judgment / opinion** ("is it the *right thing*, and worth it?") | Abstract, evaluative — a senior expert's *taste*, not a defect list | **necessity/relevance** (should this exist? dead weight? YAGNI?) · **soundness of approach** (right way? simpler design?) · **intent alignment** (achieves the real goal, not just "runs") · **proportionality** (complexity vs value; over/under-engineered) · **conceptual integrity** (fits the mental model? abstraction boundaries + naming right?) |

Kind B is what separates this from cascade review — a linter never asks *"why does this exist?"* or *"wrong abstraction — do X instead."*

## The routine (one wave)

> **With or without the graph.** Microscope does not require GitNexus. Steps 0 and 2 have a graph
> path and a classical path; every other step is identical. Use the classical path whenever the
> graph module is not installed, the index is stale and cannot be refreshed, or a graph call
> returns nothing — and **say which path you used**, because the map's completeness bounds how much
> the wave can claim to have covered.

```
0. SCOPE-GATE: substantial? If not → skip or one lens.
             graph:     impact blast-radius on the changed symbols.
             classical: `git diff --stat <base>...HEAD` — multi-file? shared/hub dir? risky path?
1. PERSONA:  use .bearing/domain.json (written at install). See Domain persona.
2. MAP:      enumerate the slices/seams to scrutinize.
             graph:     READ clusters (layers/areas) + processes (flows)
                        + impact/detect_changes (changed surface).
             classical: changed files grouped by directory = the layers;
                        their imports/exports = the seams;
                        entry points (routes, CLI, jobs, exported API) = the flows.
                        Read the files — this is a slower map, not a missing one.
3. SPAWN:    one lens per meaningful slice, tagged KIND A or B (both on core slices);
             + cross-cutting lenses (security, performance) where relevant.
             Parallel agents IF the runtime has multi-agent orchestration; else run sequentially.
4. EACH LENS: verify against REAL logic (trace the value, read the branch), not plausibility.
             Kind-B lenses OPINIONATE — argue necessity/soundness/proportionality with the WHY.
5. VERIFY:   adversarially re-check each finding — try to REFUTE it; keep only what survives. Cite file:line.
6. SYNTHESIZE: one report — deduped across lenses, severity-ranked (CRITICAL/HIGH/MEDIUM/LOW),
             each item = a defect OR an opinion, with the WHY + file:line + a concrete recommendation.
7. WAVES:    fix criticals → fold the remainder + any new/user findings → run the next NUMBERED pass →
             repeat until clean. Record each pass to memory as a handoff.
```

> **Graph module installed and the index is stale?** Refresh it first with the
> `bearing:agent-refresh` script — the graph map is only as good as the index. If that script is
> not in this repo's `package.json`, the graph module is not installed: take the classical path
> above rather than going looking for it.

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

## Lens model tier

**Lenses run on your MAIN model — do not downgrade them.** A lens's job is judgment: is this the
wrong abstraction, is this needed at all, is this fee on gross when it should be net. That is
reasoning, and reasoning is what a cheaper tier gives up first.

This is the opposite of a minion, deliberately. Minions run on a middle tier *because* they do no
reasoning (NS-24); a lens is the case where the reasoning IS the deliverable. Same harness, opposite
answer, and the return contract is what decides it.

## Domain persona

The judgment lenses need a domain expert, not a generic reviewer.

**Read `.bearing/domain.json`.** bearing writes it at install and injects the same persona into the
always-on contract, so you are almost certainly already holding it — the file is the authority when
they disagree. State it in one line before reviewing.

```json
{ "domain": "payments", "persona": "staff payments and ledger engineer" }
```

- `persona` is the user's to edit; treat it as pinned, never re-derive over the top of it.
- `domain: null` with a neutral persona means inference was **not confident** — check
  `suggestedDomain`, and if the project clearly has a specialism the file missed, say so and
  propose the correction rather than silently adopting your own guess. A persona that changes
  between waves makes wave N+1's findings incomparable with wave N's.
- File missing entirely (pre-1.0.7 install)? Infer from `README`, `package.json` description and
  `CLAUDE.md`, state what you adopted, and suggest pinning it.

An expert in the domain catches *semantic* wrongness ("this fee is computed on gross, should be net") and *taste* issues ("this whole abstraction is unnecessary") that a language-only reviewer never sees.

## Guardrails (don't harm strong models)

- **Scaffold the stance, not the answers.** Have *real* opinions — push back, question necessity, propose better designs, defend them with the *why*. Don't emit shallow, safe, generic takes to fill a rubric.
- **Verify before asserting.** Every finding survives an adversarial refutation attempt and cites file:line. No "looks risky" without proof.
- **Proportional effort.** Lens count scales with the target; the scope gate keeps small tasks cheap.

## Output shape

```
# Microscope Pass #N — <target> (persona: senior <domain> engineer)
## CRITICAL
- <defect|opinion> — <why it matters> — file:line — <recommendation>
## HIGH / MEDIUM / LOW … (same shape)
## Verified-correct (high-value confirmations)
## Bottom line + next wave
```
