---
name: bearing-invasive-minions
description: "Fan out a DECIDED, mechanical code change across many independent sites at once, instead of grinding them one at a time — logging coverage, error handling, a settled API migration, adding a guard clause everywhere a shape is unwrapped. Each subagent edits its own slice in isolation — its own git worktree, or a patch file — and nothing lands until you have reviewed that slice. Use when the transformation is already decided, the sites are 3+ and independent, and the slices can be split by file. NOT when the change differs per site in a way that needs judgment, when the sites interact, or when it is architectural. Examples: \"add structured logging to every handler\", \"wrap every fetch in the shared error envelope\", \"migrate the remaining 30 call sites to the new signature\"."
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
| **ISOLATED** | **No minion writes your working tree.** Each works in its own git worktree (Claude Code: spawn it with `isolation: "worktree"`) and commits its slice there, or — on a runtime without worktrees — writes its change as a patch file and edits nothing. Nothing lands until YOU have reviewed it (section 5). |

Split by FILE, never by concern, and keep the slices disjoint. Isolation is what makes a mistake there
survivable: two minions that edited one file used to be a lost update — the second clobbered the
first, both reported success, nothing showed it. Isolated, the second slice simply no longer applies
once the first has landed, and the review says so. That is a re-run, not lost work.

**Do NOT fan out when** the change differs per site in a way that needs thinking (deciding *what* to
log is the work; adding the line is not) · the sites interact, so changing A changes what B should
become · it is architectural, i.e. a decision wearing the costume of a mechanical edit · it is under
three sites.

Apply it once yourself first. It is the cheapest way to find out the transformation is wrong, and it
gives you a worked example to hand the minions.

## 2. Split

By file. Enumerate the slices before spawning — each one a name and the exact list of files it may
touch; that list is what its review checks against. If two name the same path, fix the split. Prefer
more small slices to fewer large ones: a bad slice is rejected and re-run on its own, so small
failures are cheap.

Start from a clean tree, or at least one whose uncommitted changes do not touch the slices. Each
worktree branches from HEAD, so edits you have not committed are invisible to every minion.

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

**4. The same tools you would use.** Grep and Read are the defaults. Hand a subagent the GitNexus
graph only when the user asked for the graph in this task, and say so in its brief: a subagent
never saw that request, so it cannot know the graph was wanted. When it does use the graph, its
zeros and counts carry the same caveats yours do.

**5. Parallel where the runtime allows it**, sequential where it does not. Claude Code can run them
concurrently; treat that as an optimisation, never as a requirement — the routine must produce the
same answer either way.

**6. Coverage is a claim, so keep it honest.** A subagent that died, timed out, or came back
empty-but-confused has REDUCED YOUR COVERAGE, and silence reads as "I checked everything". Re-run
it, or say plainly what went unchecked. Never let the count of agents you spawned stand in for the
count that actually reported.

**7. Every minion runs on the MIDDLE tier** of your model family — `sonnet` for Anthropic, or the
`minionModel` set in `.bearing/hooks.json` / `hooks.local.json`. That holds for minions that
gather and minions that apply, because neither decides anything (NS-24). The tier follows the return
contract, never how important the task feels: if a minion seems to need a smarter model, you handed
it a decision — take that part back. The one subagent that runs on your main model is one whose
return IS the reasoning, a microscope lens, and that is not a minion.

**8. Spot-check before you trust.** Open at least one cited `file:line` per subagent and confirm it
says what the report claims. A fabricated citation is the one failure the return shape cannot catch
on its own.
<!-- END GENERATED: anchored-spawn -->

Plus, verbatim:

> Apply the transformation EXACTLY as specified. Do not improve it, generalise it, or fix unrelated
> things you notice — note those and move on. Touch ONLY the files in your list. If a site does not
> match any shape in the brief, leave it and report it as SKIPPED rather than guessing. Work only
> in your own worktree and COMMIT your slice there when done — or, if you were given no worktree,
> edit nothing and write your whole change as one unified diff to the patch path you were given.

That clause about improvements is the one that earns its place: nine agents each making one tasteful
improvement produces a diff nobody decided on, in files nobody was reviewing for it. The commit is
the other half — an uncommitted worktree still reviews, but a minion that committed nothing and
saved nothing has handed you a report with no change behind it.

## 4. The return contract

```
SLICE    <name> — <branch, worktree path, or patch file>
WROTE    <file:line> — <the exact text written>
VERIFIED <the check run on THIS slice, and its exit code>
SKIPPED  <site not changed, and which shape the brief failed to cover>
FAILED   <what broke, verbatim>
```

**`SKIPPED` is the reason to use this at all.** It is a bug report about your brief — three minions
skipping the same shape means your specification had a hole. Name the shape, re-run those units.
A serial agent would have quietly decided nine times and you would find out, if ever, in review.

Each minion checks its **own slice** narrowly — typecheck what it touched, run the test that covers
it. In its own worktree that check is not racing anyone else's half-written edits.

## 5. Review, then land — one slice at a time

The minions applied; **you accept or reject**, slice by slice, before anything reaches your tree.
Accepting is a decision, so it never goes to a subagent (NS-24).

**1. The mechanical check** — everything that is not judgment:

```bash
node .bearing/lib/minion-review.mjs <branch|worktree-dir|file.patch> --allow <the slice's files or dir/>...
```

It rejects a slice that touched a file outside its list, one that no longer applies to HEAD (a
second slice that edited a file the first already changed lands here, as a conflict instead of a
lost update), and one that is empty. Otherwise it prints the diff.

**2. Your review** — the judgment the check cannot make. Read every hunk and ask one question: *does
this match a shape in the brief?* Look hardest for the site where the transformation was applied to
something it did not fit — that is what a swarm produces and a serial agent does not. Check that
each SKIPPED is a real gap in the brief, not a site the minion found inconvenient.

**3. Land or reject.**
- **Accept** → the same command with `--land`. It applies the slice to your working tree and index —
  never commits; that stays yours or the user's — and keeps the patch, so `git apply -R --index
  <patch>` takes that slice back on its own.
- **Reject** → name the reason, fix the brief or the split, and re-run only that slice. Do not patch
  a rejected slice by hand: the fix belongs in the brief, or slice 31 makes the same mistake.

**4. Then the whole.** Once the slices you accepted have landed, run the suite once, yourself. Remove
the worktrees and branches you are done with — `git worktree remove <path>` and `git branch -D
<branch>`, landed or rejected alike; Claude Code cleans up only the ones a minion left unchanged.

If some slices were rejected, the only question that matters is whether a half-applied change is
safe. Adding logging: keep what landed, re-run the rest, say which sites were not touched. A
migration where old and new must not coexist: take the landed slices back rather than finishing it
by hand — that is how a two-hour job becomes a day.

## 6. Which model

**Every minion runs on the MIDDLE tier of your model family — `sonnet` for Anthropic** — the same as
gathering minions. Writing feels like it should need more; it does not, *because the transformation
is already decided*, and reviewing what came back is your job, on your model. The tier follows the
return contract, not the stakes.

If a slice keeps coming back wrong, fix the brief, not the model. A smarter minion papering over an
ambiguous transformation will make nine different reasonable choices and you will not see it in
review. To pin a different middle-tier model, set `minionModel` in `.bearing/hooks.json` (team) or
`.bearing/hooks.local.json` (this machine).

## 7. Worked shapes

| Task | Slice by | The decided transformation |
| --- | --- | --- |
| Structured logging coverage | one handler file per minion | the logger import, the call, where in the function, which fields |
| Error handling | one module per minion | the shared envelope, which throw sites it wraps, what an already-wrapped site looks like |
| Settled API migration | files grouped so no two share one | old signature → new, verbatim, plus what an already-migrated call looks like |
| Adding a guard clause | one directory per minion | the exact clause, the shapes that need it, the shapes that must NOT get it |
| Test scaffolding for uncovered units | one source file per minion | the file naming, the harness import, one worked example to copy |

In every row the thinking happened before the fan-out. That is what makes the row eligible.
