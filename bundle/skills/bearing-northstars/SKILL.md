---
name: bearing-northstars
description: Read, cite, and maintain the project's north-stars — the authoritative numbered fixed points (invariants, exact term meanings, evidence standards, settled decisions, graveyard) that outrank every other doc and stop semantic drift. Use when starting work on a project that has .bearing/northstars.md, when a re-anchor fires, when a doc/code conflicts with a north-star, when proposing or rejecting an idea, or when drafting/updating the north-stars themselves.
---

# North-stars — the project's semantic anchor

## The file

**`.bearing/northstars.md`** — what **this project** is. Yours; bearing never overwrites it.

**If this repo also installed gold practices**, `.bearing/gold-practices.md` sits beside it with
`GP-#` rules for how the work is done **anywhere** — bearing's file, refreshed on every update, so
do not edit it; a project rule belongs here in the north-stars. Cite both the same way, and **on
conflict the `NS-#` wins**, because a project's own invariant is more specific than a general rule —
say which one and why rather than averaging them.

## The problem this solves

Code drift is caught by tests. **Semantic drift is not.** You read a stale doc, quietly redefine a
load-bearing term, and everything downstream — research, conclusions, which ideas you champion and
which you discard — forks in the wrong direction while reading perfectly fluent and confident. Long
sessions make it worse: whatever anchored you at session start is diluted by 100k tokens of context.

Mature repos make this *certain*, not merely possible: docs accumulate, contradict each other, and
go stale, while the code moves on. Without a declared fixed point, "what this project is" becomes
whichever document you happened to read last.

**The north-stars are that fixed point.** `.bearing/northstars.md` — short, numbered,
falsifiable propositions. User-owned, committed, authoritative.

## The rules

1. **Read it first**, before forming any premise — new session, recovery, or new task. A PostToolUse
   hook re-anchors you periodically and right after you write a doc; that's a reminder, not a
   substitute for reading the file.
2. **It outranks everything** — every other doc, README, comment, and your own inference. When any
   source conflicts with a north-star, **the north-star wins and the other source is stale.** Say
   so; never silently average two contradictory sources into a mushy middle.
3. **Cite the `NS-#`** whenever you make a consequential claim, pick a direction, or reject an idea.
   *"Per NS-7 (label==execution), this sweep is invalid because the sim stop ≠ the live stop."*
   If you can't cite one for a load-bearing conclusion, **you may be drifting — say that out loud**
   instead of proceeding confidently. Citations are what make drift cheap for a human to spot.
4. **Never silently edit a north-star or work around one.** If one looks wrong, missing, or stale,
   state it plainly and **propose the edit to the user**. The anchor only works if drift can't
   rewrite the anchor.
5. **The graveyard is settled.** Don't re-propose a REJECTED idea without new evidence that
   addresses *why* it was rejected; don't discard a VALIDATED one without evidence that overturns it.
6. **Code beats prose for facts.** If a north-star states a value, verify against the code when it
   matters — and if they disagree, that's a finding to report, not a discrepancy to smooth over.

## Format

Numbered `NS-#`, grouped by type, one dense line each. **Falsifiable** — a concrete conclusion must
be able to violate it. Target ≤ 1 page / ~25 propositions; if it grows past that, it's becoming
documentation instead of an anchor.

```markdown
## Invariants — must always hold
- **NS-1** — <statement a conclusion can violate> — src: docs/FILE.md

## Semantics — exact meaning here (and the common wrong reading)
- **NS-8** — `term` means X, NOT Y. — src: …

## Evidence — what counts as proof in this project
- **NS-12** — A claim of <kind> requires <procedure/threshold>; <weaker thing> is NOT evidence.

## Settled — decided, do not relitigate
- **NS-17** — <decision> — because <why> — src: …

## Graveyard — tried and rejected / validated
- **NS-21** — REJECTED: <idea> — <why it failed>. Re-propose only with evidence addressing that.
- **NS-23** — VALIDATED: <idea> — <evidence>. Don't discard without evidence overturning it.

## Open — explicitly unresolved (do NOT assume either way)
- **NS-25** — <question> — currently undecided.
```

Good vs useless:

| ❌ Useless (unfalsifiable) | ✅ Usable (falsifiable) |
|---|---|
| "Be careful with risk." | "NS-4 — Any strategy claim requires out-of-sample validation ≥ 5 days; in-sample-only results are NOT evidence." |
| "Keep the sim realistic." | "NS-1 — The backtest stop model MUST match the live order's stop model; if they differ the scoreboard is invalid." |
| "Prefer good metrics." | "NS-9 — Win-rate is NEVER a ranker; only NET expectancy is a profitability claim." |

## Writing or updating them (with the user)

1. **Mine, don't invent** — draw candidates from the existing docs, code, and history; anchor each
   with `src:`. Verify contested values against the **code**, not prose.
2. **Hunt conflicts** — where two docs disagree on a load-bearing value, that is exactly where
   agents drift. Do NOT resolve it yourself: surface both sides and **ask the user to adjudicate**.
   An unresolved conflict belongs in `## Open`, never silently decided.
3. **Flag stale docs** — if a doc is superseded, say so in a north-star (`NS-# — docs/X.md is
   SUPERSEDED by docs/Y.md; do not cite it for <topic>`). Stale docs are drift fuel.
4. **Keep it falsifiable and short.** Prefer deleting a vague proposition over keeping it.
5. **The user owns the file.** Propose a diff; let them approve it.

## Anti-patterns

- Treating the north-stars as "more documentation" — they're a **precedence declaration**.
- Citing a north-star you haven't re-read this session.
- Quietly reconciling a conflict between two docs instead of reporting it.
- Letting the file grow into a wall of prose — that recreates the problem it solves.
- Editing it yourself because it "seems outdated". Propose; don't rewrite.

Read them anytime from `.bearing/northstars.md` — that file is the source of truth and is always
present wherever this skill is. (Repos that also installed the GitNexus module get a
`bearing:northstars` npm script that pretty-prints it; `-- --full` for the whole document. The
script is a convenience, never the only way in — north-stars are a core module and must not depend
on the graph module being installed.)
