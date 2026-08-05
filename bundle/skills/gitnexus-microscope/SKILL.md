---
name: gitnexus-microscope
description: "Deep multi-lens audit ('microscope waves') for MILESTONE moments — feature done / big-task checkpoint / shared-code refactor / pre-ship, or when asked to 'audit / find real bugs / is this solid'. NOT for small localized changes. Goes beyond cascade code-review: it opinionates (relevance, soundness, over-engineering) as a senior domain expert, verifies findings adversarially, and iterates in waves. Examples: \"microscope this\", \"audit before we ship\", \"find the real oversights\", \"deep review this refactor\"."
---

# Microscope waves — deep, opinionated, verified audit

This is **not** a cascade code review or a linter pass. A microscope wave scrutinizes a target from many independent angles, **has real opinions** (is this even needed? is this the right approach? is it over-engineered?), verifies every finding **against real logic — not "does it run"**, and iterates in numbered **waves** until clean. It's the power-composition of the whole GitNexus toolset.

## When to run (trigger) — and when NOT (scope gate)

Fire at **milestone boundaries**: a feature is "done" / pre-PR / pre-ship · a checkpoint in a large multi-step task · after a refactor touching shared/hub code · the user asks to "audit / review deeply / find real bugs / is this solid?".

**Scope gate (avoid harm):** run the full waves only when the work is *substantial* — multi-file, OR touches a hub (check with `impact` blast-radius), OR high-risk path. A small localized change → **skip**, or run one quick lens. Don't fan out six agents on a one-file fix. This is a **capability you invoke**, not a mandatory gate — use judgment.

## Two KINDS of lenses (not a fixed list)

You **spawn concrete lenses dynamically from the map** — one per meaningful flow / layer / architectural surface / seam — and each lens is one of two KINDS. Important slices get **both** kinds.

| KIND | The question | Sub-angles |
| --- | --- | --- |
| **A — Correctness** ("is it right?") | Does this slice actually work + do the right computation? | logic/formula correctness · null/empty/boundary edge-cases · state/env-threading/data-freshness/races · cross-surface consistency & contract agreement · security/taint · performance/cost |
| **B — Judgment / opinion** ("is it the *right thing*, and worth it?") | Abstract, evaluative — a senior expert's *taste*, not a defect list | **necessity/relevance** (should this exist? dead weight? YAGNI?) · **soundness of approach** (right way? simpler design?) · **intent alignment** (achieves the real goal, not just "runs") · **proportionality** (complexity vs value; over/under-engineered) · **conceptual integrity** (fits the mental model? abstraction boundaries + naming right?) |

Kind B is what separates this from cascade review — a linter never asks *"why does this exist?"* or *"wrong abstraction — do X instead."*

## The routine (one wave)

```
0. SCOPE-GATE: substantial? (impact blast-radius). If not → skip or one lens.
1. PERSONA:  adopt "senior <this project's domain> engineer" (see Domain persona).
2. MAP:      GitNexus enumerates the lenses for you —
             READ clusters (layers/areas) + processes (flows) + impact/detect_changes (changed surface)
             → the list of slices/seams to scrutinize.
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

> Stale index → `npm run gitnexus:agent-refresh` first (the map depends on a fresh graph + PDG).

## Domain persona (generalize, don't hardcode)

The judgment lenses need a domain expert, not a generic reviewer. **Adopt "a senior engineer expert in *this project's* domain."**

- **Pinned?** If `.bearing/domain.json` exists (e.g. `{ "domain": "payments", "persona": "staff payments/ledger engineer" }`), use it.
- **Else infer** the domain from `README`, `package.json` description, `CLAUDE.md`, and the GitNexus `clusters`/`processes` names — then state the persona you adopted in one line before reviewing.

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
