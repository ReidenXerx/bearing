---
name: bearing-invasive-minions
description: "Fan out a DECIDED, mechanical code change across many independent sites at once, instead of grinding them one at a time — logging coverage, error handling, a settled API migration, adding a guard clause everywhere a shape is unwrapped. Each subagent EDITS its own disjoint slice and returns the diff it wrote. Use when the transformation is already decided, the sites are 3+ and independent, and no two slices touch the same file. NOT when the change differs per site in a way that needs judgment, when the sites interact, or when it is architectural. Examples: \"add structured logging to every handler\", \"wrap every fetch in the shared error envelope\", \"migrate the remaining 30 call sites to the new signature\"."
---

# Invasive minions — fan out to APPLY, keep the decision

Minions exist because you do not notice when to fan out a LOOKUP. This is the same blindness on a
WRITE: forty files edited by hand, every edit identical in shape, while the only thing that needed
thinking — what the change should be — was settled before the first one.

**A gathering minion must not decide what is TRUE. An invasive minion must not decide what to
CHANGE** (NS-24). The conclusion is the transformation, and you reach it before anything spawns.

## The brief is the point, and it is worth writing even alone

Writing the transformation down is not paperwork for the swarm — it is the artifact that makes the
whole thing work, and it helps YOU first:

- **It survives compaction.** A 40-site change carried as intention is lost the moment the window
  turns over; the same change written down is resumable.
- **It keeps you consistent.** Applied from your head, site 30 gets a slightly different treatment
  from site 3 and nothing ever reveals it. Applied from a brief, divergence is visible.
- **It is where the bug is.** Most of what goes wrong in this work is an under-specified
  transformation, not a bad edit.

So write it even when you decide not to fan out. A brief you cannot write is a change you have not
finished thinking about.

## 1. Gates

The four from gathering — **bounded, verifiable, independent, 3+** — plus two:

| | |
| --- | --- |
| **DECIDED** | The rule, the shapes it must handle, and what each becomes. Not "add error handling" but the exact wrapper, the exact import, and what an already-wrapped site looks like. |
| **DISJOINT** | **No two minions write the same file.** Two agents editing one file is a lost update: the second clobbers the first, both report success, and nothing in either report shows it. Split by FILE, never by concern. |

DISJOINT is the only hard one — it is the failure that destroys work silently. The rest is judgment.

**Do NOT fan out when** the change differs per site in a way that needs thinking (deciding *what* to
log is the work; adding the line is not) · the sites interact, so changing A changes what B should
become · it is architectural, i.e. a decision wearing the costume of a mechanical edit · it is under
three sites.

Apply it once yourself first. It is the cheapest way to find out the transformation is wrong, and it
gives you a worked example to hand the minions.

## 2. Split

By file. Enumerate the slices before spawning; if two name the same path, fix the split. Prefer more
small slices to fewer large ones — a bad slice is discarded and re-run, so small failures are cheap.

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

> Apply the transformation EXACTLY as specified. Do not improve it, generalise it, or fix unrelated
> things you notice — note those and move on. Touch ONLY the files in your list. If a site does not
> match any shape in the brief, leave it and report it as SKIPPED rather than guessing.

That last clause is the one that earns its place: nine agents each making one tasteful improvement
produces a diff nobody decided on, in files nobody was reviewing for it.

## 4. The return contract

```
WROTE    <file:line> — <the exact text written>
VERIFIED <the check run on THIS slice, and its exit code>
SKIPPED  <site not changed, and which shape the brief failed to cover>
FAILED   <what broke, verbatim>
```

**`SKIPPED` is the reason to use this at all.** It is a bug report about your brief — three minions
skipping the same shape means your specification had a hole. Name the shape, re-run those units.
A serial agent would have quietly decided nine times and you would find out, if ever, in review.

Each minion checks its **own slice** narrowly — typecheck what it touched, run the test that covers
it. Not the full suite: agents racing it concurrently prove nothing while others are still writing.

## 5. Finishing

Run the suite once, yourself. Then read `git diff` looking for **one thing**: the site where the
transformation was applied to something it did not fit. That is what a swarm produces and a serial
agent does not, and it is worth the skim even on a large diff.

If some slices failed, the only question that matters is whether a half-applied change is safe.
Adding logging: keep what landed, re-run the rest, say which sites were not touched. A migration
where old and new must not coexist: revert the whole fan-out rather than finishing it by hand —
that is how a two-hour job becomes a day.

## 6. Which model

**Middle tier — `sonnet` by default**, the same as gathering minions. Writing feels like it should
need more; it does not, *because the transformation is already decided*. The tier follows the return
contract, not the stakes.

If a slice keeps coming back wrong, fix the brief, not the model. A smarter minion papering over an
ambiguous transformation will make nine different reasonable choices and you will not see it in
review. Override per machine with `minionModel` in `.bearing/hooks.local.json`.

## 7. Worked shapes

| Task | Slice by | The decided transformation |
| --- | --- | --- |
| Structured logging coverage | one handler file per minion | the logger import, the call, where in the function, which fields |
| Error handling | one module per minion | the shared envelope, which throw sites it wraps, what an already-wrapped site looks like |
| Settled API migration | files grouped so no two share one | old signature → new, verbatim, plus what an already-migrated call looks like |
| Adding a guard clause | one directory per minion | the exact clause, the shapes that need it, the shapes that must NOT get it |
| Test scaffolding for uncovered units | one source file per minion | the file naming, the harness import, one worked example to copy |

In every row the thinking happened before the fan-out. That is what makes the row eligible.
