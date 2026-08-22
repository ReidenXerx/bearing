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
— by a competent agent, on a real codebase, while being careful — because those are the ones knowing
better does not prevent.

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

## The evidence

- **GP-14** — **Establish a contract from the thing that defines it, never from something that
  calls it.** Rank every source by distance from where the behaviour is decided: the producer's own
  implementation, then its published spec, then anything downstream. A call site tells you what one
  developer *believed* the contract was — which is a claim about them, not about the contract, and
  it carries their bugs forward as evidence.

  The reason this rule gets broken is an assumption, not laziness: that the producer is out of
  reach. Check before believing that. A code search across the organisation's repositories usually
  answers it in one call, with no access request and no waiting. When it genuinely is unreachable,
  the conclusion is still available — but it is now *"the callers behave as if X"*, which is a
  weaker claim than *"the contract is X"*, and it gets written down as the weaker one.
  *Scar: the meaning of two query parameters was settled by reading a frontend mapping helper,
  which was itself inverted. The real contract said the opposite, and both conclusions built on the
  reading were wrong.*

- **GP-15** — **Work the ladder in order, and only descend when a rung genuinely fails.**

  1. **The authoritative artefact** — the spec, the schema, the generated contract. Refresh it
     first: a stale copy is not the artefact, it is a third-hand account of one.
  2. **Detective work.** The producer's own source. How the rest of the codebase already does this
     — an existing caller shows you the *shape*: which call to make, in what order, with what
     wired up. It does **not** show you what the values mean (GP-14), and the two are easy to
     conflate precisely because the example is right there and looks authoritative. Documentation.
     The git history of the lines in question. Past tickets **and their comment threads**, which is
     where the decision usually lives while the ticket body records only what was asked for.
  3. **Ask the person you are working with.**
  4. **Only then block on someone else.**

  Both directions are failures and only one of them is visible. **Skipping up** — handing a person a
  question that rung 1 or 2 already answered — wastes their time and looks like diligence.
  **Skipping down** — guessing where you could simply have asked — produces a confident answer with
  nothing underneath it, and nobody finds out until it is wrong.
  *Scar: two wrong conclusions were escalated to a person while the service's own source, readable
  without asking anyone, went unread.*

## The shared path

- **GP-16** — **The same fix in N places is one implementation with N call sites.** This binds
  *across* separate changes too: three PRs each pasting the same block is the same defect as one
  file pasting it three times, and splitting the work does not license duplicating it. **A copied
  explanatory comment is the tell** — if the prose has to travel with the code, the code should have
  been extracted. *Scar: three separate PRs for one bug each independently reimplemented the same
  ~10-line mechanism, carrying an identical multi-paragraph comment along with it.*

- **GP-17** — **When your tooling lies, fix the tooling.** A wrong selector, a signal that does not
  mean what you thought, a check that passes for the wrong reason: fix it in the shared helper, not
  in the one-off script that happened to hit it. A signal *proven* to lie gets removed, not routed
  around — leaving it in place means the next person believes it. *Scar: three lessons from one test
  run were fixed inside a single verification script while the shared helpers kept the broken
  versions, so every later run inherited them.*

## The handover

- **GP-18** — **Reporting something as unverified is not a handover.** If you could not check it,
  hand over the means to check it. And **finding the data is your job, not theirs**: a link that
  opens the exact case in the exact state, created if none exists, opened by you first to confirm it
  lands where you said — plus why the obvious candidates do not work, because most will not and they
  will otherwise conclude the feature is broken. *Scar: "find an unpaid invoice and click the vendor"
  sends someone hunting through a backend for a record that mostly does not exist — the single most
  expensive part of a manual check, and the part that could have been done for them.*

- **GP-19** — **Send each fact to the reader who can act on it.** A PR description, a status update
  and a handover have different readers, and a fact that is essential in one is noise in another.
  The team-facing artefact carries what a reviewer must act on: the problem, the cause, the fix, how
  to check it, and anything you changed beyond what was asked. Your route to the answer — what you
  have not got to yet, why something is still draft, the approach you nearly took — has a reader
  too, and it is the person you are working with, not everyone who opens the PR later.

  **This is not licence to omit it** (GP-1, GP-8). An unverified claim is still said out loud and
  still gets a means to check it (GP-18); what changes is *where*, not *whether*. The test is one
  question: **would this reader do something differently knowing it?** A limitation they must work
  around, yes. An account of how you got here, no.
  *Scar: a PR body carried notes on what remained unverified and why a branch was still draft —
  written for one person, read by the whole team, and useless to every one of them.*

- **GP-20** — **An instrument that sees a subset reports success in the shape of the whole.** Before
  trusting a count, ask what it CANNOT see — then check whether the thing you are claiming lives
  there. The failure is silent by construction: the part outside the instrument's scope never shows
  up as a zero, it never shows up at all. Where you can, observe the OUTCOME rather than enumerate
  the inputs you happened to think of — press submit instead of counting filled fields, read what
  landed on disk instead of trusting the write. *Scar: two, from opposite ends of a stack — a completeness
  check counted `input[type=text]` with a value and reported "all filled" while a date picker and two
  selects sat empty — neither is an `input[type=text]`; the same run counted error elements BEFORE
  any submit, where the answer is always zero. And a hook meant to count file edits watched the
  edit-tool calls: in a three-day session it saw 6 of ~96, because the other 90 were made through the
  shell, so the threshold it guarded was never once reached.*

- **GP-21** — **Hand over a decision, not a chore.** Whatever mechanical step you leave undone
  becomes the recipient's step — and it is the part most likely to make them defer the whole request.
  Do everything that does not need them, then hand over exactly what does: the prefilled form rather
  than the blank one, the exact command rather than "run the tests", the diff rather than "review the
  branch", closed options with a recommendation rather than an open question. This holds for whoever
  is next, not only a human — a subagent, a reviewer, or your own next session reading the notes you
  left. *Scar: a blank KYC form handed to a person to fill in, when every field but one was already
  known and could have been filled programmatically.*

- **GP-22** — **Declining to answer is the cheapest possible answer, so any comparison by cost
  ranks it first.** Whenever you score two things by what they consume — tokens, time, queries, lines
  — check that both actually produced a result before comparing the cost of producing it. Nothing in
  a cost metric distinguishes a fast answer from a fast refusal, so the failing side does not merely
  escape the penalty, it takes the prize, and the worse it fails the more it wins. The same shape
  appears wherever success is inferred from a proxy: a cache that reports its best hit rate when it
  is returning nulls, a test suite that gets fastest as more of it skips, a search that looks most
  precise when its query matches nothing. Score the answer first, the cost second — and report the
  non-answers by name, because a comparison that silently drops what one side could not handle is
  reporting the score of a team it also picked. *Scar: a benchmark priced `impact` against grep and
  printed 5294x. The graph had returned `impactedCount: 0` in ~250 tokens for a field with 57
  references it could not traverse, against grep's 1.3M — its own advice on that response was
  "confirm with a text search", which the benchmark reported as a 5294x win over text search.*

