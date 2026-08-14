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

- **GP-14** — **A consumer's reading is not the producer's contract.** Code that *calls* an API is
  evidence of what someone believed it meant, which is not the same thing and is frequently wrong.
  Rank sources by distance from the source of truth: the producer's own implementation, then its
  published spec, then anything downstream. *Scar: the meaning of two query parameters was settled
  by reading a frontend mapping helper — which was itself inverted. The real contract said the
  opposite, and both conclusions built on it were wrong.*

- **GP-15** — **Exhaust the cheaper rung before escalating, and never ask a person what the source
  can answer.** The ladder runs: the authoritative artefact, then your own detective work through
  source, history and prior discussion, then ask the human, then block on someone else. Skipping up
  is the visible failure; skipping *down* — guessing where you could have asked — is the quiet one.
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

- **GP-19** — **The report's audience is not you.** What you have not got round to verifying, why
  something is still in draft, your own doubts and plans — those belong in chat or the task-core. The
  artefact the team reads gets the problem, the cause, the fix, how to check it, and anything you
  changed outside what was asked. A real limitation the reader must act on belongs there; narrating
  your process does not. *Scar: a PR body carried internal notes about what remained unverified —
  written for one person, read by the whole team.*
