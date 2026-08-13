# Gold practices — how the work is done

**Ships with bearing. Applies to every project.** Where the north-stars say what *this* project is,
these say how to work anywhere. They are numbered `GP-#` and cited the same way.

**North-stars outrank gold practices.** A project's own invariant is more specific than a general
rule, so on conflict the `NS-#` wins and you say which one and why. If there is no conflict, both
apply.

**This file is bearing's, not yours.** `bearing update` overwrites it — put project rules in
`.bearing/northstars.md`, which bearing never touches.

Most of these were paid for. Where a rule has a scar, it is named, because a rule with a story
attached survives contact with a deadline and an abstract one does not.

---

## Verification — what you know versus what you assume

- **GP-1** — **Executed, or unverified.** A statement about behaviour that came from reading code,
  grepping, or reasoning is a *hypothesis*. Run it. Say "I ran X and saw Y", or say you have not
  checked. *Scar: "a fresh install then uninstall leaves nothing behind" — asserted from a grep that
  was subtly wrong. Executing it found six leaked paths.*

- **GP-2** — **A test that has never failed has never been tested.** When you write a test for a
  fix, revert the fix and watch the test fail. If it still passes, it does not cover the fix and you
  have bought nothing. *Scar: caught twice in one session — the second time the test passed because
  a neighbouring fix masked the one it was written for.*

- **GP-3** — **Test at the seam the bug lives at.** A unit test that passes an argument the real
  pipeline never produces is green and dead. Before trusting a passing test, ask which caller
  supplies that input in production. *Scar: a context-window fix tested as `resolve(300_000,
  undefined)` while the shipped config always passed a number — so the fix could not run, and did
  not, for two releases.*

- **GP-4** — **A fixture chosen for convenience tests the case that cannot fail.** Ask what your
  setup makes *impossible*. That is the untested path, and it is where the bug is. *Scar: the
  fixture had a tracked config file, which sends the code down its skip branch — so the create
  branch, the one that leaked, was never executed by any test.*

- **GP-5** — **Presence is not correctness.** A file existing, a flag set, a process running, a
  command exiting 0 — none of these is the thing working. Check the post-condition you actually
  care about.

- **GP-6** — **A silent no-op is indistinguishable from success.** A substitution that matched
  nothing, a loop that ran zero times, a script that operated on the wrong directory. Assert that
  the state *changed*, not that the command returned. *Scar: two edits silently matched nothing, so
  "0 tests fail" was measuring an unmodified file.*

- **GP-7** — **Every line you print is a claim.** "Pushed" after a rejected push, a commit hash
  named before reading the output, a percentage computed from a guessed denominator. Output is
  cheaper to check than to retract.

- **GP-8** — **Reproduce before you diagnose, and reproduce the reported thing.** A nearby failure
  you can trigger is not the failure that was reported.

## Change — how to move code without breaking it

- **GP-9** — **Question the premise before tuning the number.** Raising a limit twice means the work
  is in the wrong place. Timeouts, retries and thresholds that keep needing adjustment are pointing
  at a design, not asking for a value. *Scar: a CI timeout went 15 → 25 minutes; the fix was not
  doing that work in that job at all.*

- **GP-10** — **A list that must be kept in sync will fall out of sync — compute it.** Any
  hand-maintained mirror of a fact the code already knows is a defect waiting for someone to forget.
  Derive it, or add the check that fails when it drifts.

- **GP-11** — **Make it idempotent, or make the second run safe on purpose.** Anything that
  accumulates on re-run — a duplicated block, a second registration, a doubled entry — is a bug that
  only shows up for the person who ran it twice.

- **GP-12** — **Know how to undo what you install.** Anything written into someone's project needs a
  removal path that leaves it as it was found, decided when you write it and not after a complaint.

- **GP-13** — **Prefer deleting.** The change that removes a special case is worth more than the one
  that handles it. Code that is not there cannot drift, cannot be misread, and needs no test.

- **GP-14** — **Bound anything on a hot path.** A scan that is correct but linear in repository size
  will be run on every keystroke by someone. Prefer a bounded check that stops early, and say what
  happens past the bound.

## Judgment — deciding what is worth doing

- **GP-15** — **State the failure mode, not the feature.** If you cannot say in one sentence what
  goes wrong without this change, there is nothing to build yet. A capability that already exists is
  not a feature; the moment it fires is.

- **GP-16** — **Record the alternative you rejected, with the reason.** A decision stored without
  its rejected options gets re-litigated by the next person, who has only the outcome and none of
  the constraints.

- **GP-17** — **Disagreement is cheap before the work and expensive after.** If the request looks
  wrong, say so in a sentence or two — then do it as asked unless it is unsafe. The concern is
  information, not a veto.

- **GP-18** — **When the evidence contradicts the plan, the plan is wrong.** Rerunning until it
  agrees is not verification.

## Reporting — what you say you did

- **GP-19** — **Report what happened, including what you skipped.** Partial work described as
  complete is the expensive failure, because it removes the reader's chance to catch it. Failing
  tests get quoted, not summarized.

- **GP-20** — **Correct once, plainly, then continue.** A mistake that changes the reader's
  decisions is worth a sentence. One that does not is worth silence and a fix.

- **GP-21** — **Distinguish measured from inferred, always.** "573 seconds" and "usually about ten
  minutes" are different kinds of statement, and the reader cannot tell which one they are getting
  unless you say.
