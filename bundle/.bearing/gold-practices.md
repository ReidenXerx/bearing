# Gold practices — what went wrong before

**Ships with bearing. Applies to every project.** Where the north-stars say what *this* project is,
these say how the work is done anywhere. Numbered `GP-#`, cited the same way.

**North-stars outrank gold practices.** A project's own invariant is more specific than a general
rule, so on conflict the `NS-#` wins and you say which one and why.

**This file is bearing's, not yours.** `bearing update` overwrites it — project rules belong in
`.bearing/northstars.md`, which bearing never touches.

---

**Every rule here has a scar, and the scar is the point.** There is deliberately nothing about
writing tests, naming things, or keeping commits small: you already do that, and a rule you already
follow costs context and changes nothing. What is here is the set of mistakes that got made *anyway*
— by a competent agent, on this codebase, while being careful — because those are the ones knowing
better does not prevent.

They share a shape. Every one is a moment where **something looked verified and was not**.

---

## The work

- **GP-1** — **Executed, or unverified.** A statement about behaviour that came from reading code,
  grepping, or reasoning is a *hypothesis*. Say "I ran X and saw Y", or say you have not checked.
  *Scar: "a fresh install then uninstall leaves nothing behind" — asserted from a grep that was
  subtly wrong. Executing it found six leaked paths.*

- **GP-2** — **A test that has never failed has never been tested.** After writing a test for a fix,
  revert the fix and watch it fail. If it still passes, it does not cover the fix and you have
  bought nothing. *Scar: twice in one week. The second time a neighbouring fix masked the one the
  test was written for, so the revert check reported zero failures.*

- **GP-3** — **Test at the seam the bug lives at.** A unit test that passes an argument the real
  pipeline never produces is green and dead. Ask which caller supplies that input in production.
  *Scar: a context-window fix tested as `resolve(300_000, undefined)` while the shipped config
  always passed a number — so the fix could not run, and did not, for two releases.*

- **GP-4** — **A fixture chosen for convenience tests the case that cannot fail.** Ask what your
  setup makes *impossible*; that is the untested path. *Scar: the fixture had a tracked config file,
  which sends the code down its skip branch — so the create branch, the one that leaked, was never
  executed by any test.*

- **GP-5** — **An assertion that cannot fail is not an assertion.** *Scar: three in one codebase — a
  substring check against text that always contained it, a revert check written as `return "" ||
  (…)` where the empty string is falsy, and a fixture whose search term matched under both branches.
  All three passed. None tested anything.*

- **GP-6** — **A silent no-op is indistinguishable from success.** A substitution that matched
  nothing, a loop that ran zero times, a script pointed at the wrong directory. Assert that state
  *changed*, not that the command returned 0. *Scar: two edits silently matched nothing, so "0 tests
  fail" was measuring an unmodified file.*

- **GP-7** — **Verify the probe before believing the result.** A failing check is a claim too, and a
  broken harness fails in exactly the shape of a broken feature. When a result is surprising, suspect
  the measurement first. *Scar: a hook run without its project-directory variable operated on the
  wrong root and "proved" a working fix was broken; on another day three separate probe harnesses
  reported confident numbers that were artefacts of shell quoting.*

- **GP-8** — **Every line you print is a claim.** *Scar: "pushed" printed after a rejected push,
  because the echo was not conditional on the exit code; a commit hash named before reading the
  output it came from.*

## The design

- **GP-9** — **A default indistinguishable from an explicit choice disables everything downstream
  that would correct it.** If code treats "the user told me" and "nobody told me" as the same value,
  it cannot tell them apart later — so record the absence, not a stand-in. *Scar: a context window
  defaulted to 200000, which the estimator read as the user's own statement of fact and returned
  immediately; every correction beneath it was unreachable in any real install.*

- **GP-10** — **Question the premise before tuning the number.** A limit that needs raising twice is
  pointing at a design, not asking for a value. *Scar: a CI timeout went 15 → 25 minutes; the fix was
  not doing that work in that job at all.*

- **GP-11** — **A list that must be kept in sync will fall out of sync — compute it.** Any
  hand-maintained mirror of something the code already knows is a defect waiting for someone to
  forget. *Scar: a module-boundary invariant kept as a list broke silently twice before it was
  derived from the imports instead.*

- **GP-12** — **Bound anything on a hot path.** A check that runs "once" runs on every tool call
  unless something stops it. *Scar: an evidence lookup intended to resolve one value per session
  re-read two dozen files on every single tool call, worst case concluding nothing each time.*

- **GP-13** — **Your blast radius includes what you cause other tools to write.** Accounting for
  your own writes is not enough if you invoke something that writes too. *Scar: a mode whose entire
  promise was leaving the repository untouched was verified clean at install — then the indexer it
  triggered appended to a tracked file and created another, and the repo went dirty.*
