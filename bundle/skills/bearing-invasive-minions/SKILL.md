---
name: bearing-invasive-minions
description: "Fan out a DECIDED, mechanical code change across many independent sites at once, instead of grinding them one at a time — logging coverage, error handling, a settled API migration, adding a guard clause everywhere a shape is unwrapped. Each subagent EDITS its own disjoint slice and returns the diff it wrote plus the check it ran. Use when the transformation is already decided, the sites are 3+ and independent, and no two slices touch the same file. NOT when the change differs per site in a way that needs judgment, when sites interact, when it is architectural, or when the tree is dirty with unrelated work. Examples: \"add structured logging to every handler\", \"wrap every fetch in the shared error envelope\", \"migrate the remaining 30 call sites to the new signature\"."
---

# Invasive minions — fan out to APPLY, keep the decision

The gathering skill exists because you do not notice when to fan out a LOOKUP. This one exists
because the same blindness costs far more when the work is a WRITE: you edit forty files one at a
time, each edit identical in shape, while the thing that actually needed thinking — what the change
should be — was settled before you started.

**A gathering minion must not decide what is TRUE. An invasive minion must not decide what to
CHANGE.** That is the whole of NS-24 here, and it is not a loosening of it: the delegator still
concludes. The conclusion is the transformation, reached before anything is spawned. A minion
applies it and reports the bytes it wrote, which is still *returning what it saw*.

If a minion has to work out how to handle its site, you have delegated the decision. Take it back —
same diagnostic as wanting a smarter minion.

## 1. Should you fan out a change at all?

The four gathering gates still apply — **bounded, verifiable, independent, wide (3+)**. Writing adds
two, and both are hard failures rather than judgment calls:

| | |
| --- | --- |
| **DECIDED** | The transformation is written down IN FULL before you spawn — the rule, the shapes it must handle, and what each becomes. Not "add error handling", but the exact wrapper, the exact import, and what to do with a site that already has one. |
| **DISJOINT** | **No two minions may write the same file.** Not "should not" — two agents editing one file is a lost update: the second write clobbers the first, both report success, and nothing in either report shows it happened. Split by FILE, never by concern. |

Disjointness is the constraint with no analogue in gathering, and it is the one that silently
destroys work. Two gathering minions reading one file is free. Two invasive minions writing one file
means one of them did nothing, and you will find out from a code review three days later.

**Before spawning, satisfy all three:**

1. **The tree is clean, or the work is on its own branch.** Your recovery move is discarding a
   slice, and you cannot discard a minion's edit that is tangled with the user's uncommitted work
   (NS-1). If `git status` has unrelated changes, commit or stash them first.
2. **You can state the rollback in one line.** "Revert commit X" or "`git checkout -- <slices>`". If
   you cannot, you do not yet understand the blast radius.
3. **You have decided whether PARTIAL application is acceptable** — see §5. Decide before, because
   after a half-failed fan-out you will be tempted to patch forward.

## 2. Do NOT fan out a change when

- **The transformation differs per site in a way that needs judgment.** Adding a log line is
  uniform. Deciding *what to log* at each site is not — that is the work, and it is yours.
- **The sites interact.** If changing A changes what B should become, the units are not independent
  and a swarm will produce a tree that no single agent would have written. Do it serially.
- **It is architectural.** Moving a boundary, changing a public signature, renaming across an API —
  those are decisions wearing the costume of a mechanical edit. The mechanical part only begins once
  the new shape is settled and proven at one site.
- **You have not applied it once yourself.** Do the first site by hand. It is the cheapest way to
  discover that the transformation you were about to hand to nine agents is wrong.
- **Under three sites.** Two edits are faster done than delegated.
- **The change is unreviewable in aggregate.** If the diff will be too large for anyone to read, the
  fan-out has not saved work, it has moved it to review and made it worse.

## 3. Split the work

**Split by file, and give each minion a list of files nobody else has.** Enumerate the slices out
loud before spawning, and say how many. If two slices name the same path, your split is wrong — fix
it, do not hope the writes interleave.

Prefer more, smaller slices over fewer, larger ones: a failed slice is discarded and re-run, so a
small slice is a cheap failure. One file per minion is a perfectly good split when the files are big.

## 4. What every minion gets

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

Plus, verbatim, the parts that only matter when writing:

> Apply the transformation EXACTLY as specified. Do not improve it, generalise it, or fix unrelated
> things you notice — note those and move on. Touch ONLY the files in your list. If a site does not
> match any shape in the brief, do not guess: leave it and report it as SKIPPED. Return the diff you
> wrote.

The "do not fix unrelated things" line is not politeness. Nine agents each making one tasteful
improvement produces a diff nobody decided on, in files nobody was reviewing for that.

## 5. The return contract

```
WROTE    <file:line> — <the exact text written, verbatim>
VERIFIED <the command run on THIS slice, and its exit code>
SKIPPED  <site not changed, and which shape the brief failed to cover>
FAILED   <what broke — verbatim output, not a description>
```

`SKIPPED` is this skill's `MISSED`, and it carries the same meaning: **it is a bug report about your
brief, not about the minion.** Three minions skipping the same shape means your transformation was
under-specified; name that shape and re-run those units. A minion that guesses instead of skipping
is the one to worry about.

**Each minion verifies its OWN slice, narrowly** — typecheck the files it touched, run the test that
covers them. Not the full suite: N agents running it concurrently is wasteful, they race, and a
green suite mid-fan-out is meaningless while other minions are still writing. The full suite is
yours, once, at the end.

## 6. Then YOU verify the whole

A fan-out of edits is not done when the minions return. It is done when:

1. **Every WROTE line resolves.** `node .bearing/lib/verify-citations.mjs` over the reported paths —
   a fabricated edit report is the one failure the shape cannot catch on its own.
2. **`git diff` reads as ONE change.** Skim every hunk. You are looking for the site where the
   transformation was applied to something it did not fit — that is what a swarm produces and a
   serial agent does not.
3. **The full suite passes, run by you.**
4. **The diff contains nothing you did not ask for.** Anything else a minion "improved" comes out.

## 7. When it half-fails

This is the failure mode gathering does not have, and the reason to decide §1.3 in advance.

A gathering fan-out that half-fails leaves **gaps in an answer** — annoying, obvious, harmless. An
invasive fan-out that half-fails leaves **the codebase half-transformed**: half the call sites
migrated, half the handlers logging. That state usually compiles and usually passes tests, so it
ships, and now the codebase has two conventions and no record of which is intended.

So decide up front:

- **If partial application is safe** (adding logging — more is better, less is not broken), keep
  what landed, re-run the failed slices, and say plainly which sites were not touched.
- **If it is not** (a migration where old and new must not coexist), **revert the whole fan-out**
  rather than patching forward. `git checkout -- <slices>` or reset the branch. Half a migration is
  worse than none, and the temptation to finish it by hand is how a two-hour job becomes a day.

State which of the two you are in, in your final answer. "It mostly worked" is not a report.

## 8. Which model

**Same middle tier as gathering minions — `sonnet` by default.** People assume writing needs a
better model than reading; it does not, *because the transformation is already decided*. Applying a
specified edit is mechanical work, and the tier follows the return contract, not the stakes.

If a slice keeps coming back wrong on a middle tier, the brief is ambiguous — fix the brief, not the
model. A smarter minion papering over an under-specified transformation is the failure this skill is
shaped to prevent: it will make nine different reasonable choices and you will not see it in review.

Override per machine in `.bearing/hooks.local.json` (`"minionModel"`), shared with gathering minions.

## 9. Worked shapes

| Task | Slice by | The decided transformation |
| --- | --- | --- |
| Structured logging coverage | one handler file per minion | the exact logger import, the exact call, where in the function, what fields |
| Error handling | one module per minion | the shared envelope, which throw sites it wraps, what an already-wrapped site looks like |
| Settled API migration | files grouped so no two share one | old signature → new, verbatim, plus what an already-migrated call looks like |
| Adding a guard clause | one directory per minion | the exact clause, the shapes that need it, the shapes that must NOT get it |
| Test scaffolding for uncovered units | one source file per minion | the file naming, the harness import, one worked example test to copy |

In every row the thinking happened before the fan-out. That is what makes the row eligible.
