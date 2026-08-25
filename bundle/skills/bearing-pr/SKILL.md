---
name: bearing-pr
description: "Use when opening a pull request, writing or improving a PR description, or preparing a branch for review. Examples: \"Open a PR for this\", \"Write the PR description\", \"Is this branch ready to review?\". For reviewing SOMEONE ELSE'S PR, use bearing-pr-review instead."
---

# Writing a PR someone can actually review

<!-- BEGIN GENERATED: graph-uncertainty — bearing regenerates this block; edits here are replaced on update -->
## The graph can be wrong

A zero is not absence; a near-0.5 `r.confidence` edge is a lead, not proof (~92% of `USES`); a count
can be a floor — `impact` says which in `epistemic`. Before a conclusion that matters, confirm with a
scoped `Grep` (allowed here, not a gate violation) and say which check you ran.
<!-- END GENERATED: graph-uncertainty -->

It matters more here than anywhere else: a PR body states the blast radius **to the team**, in
writing, and you cannot take it back. If `epistemic` is not `"exact"`, write the number as a floor.


## The problem this solves

A reviewer's real questions are *what breaks if this is wrong*, *what else does it touch*, and *how
do I check it*. The default PR body — a bulleted list of what changed — answers none of them, and
answering them from the diff is the reviewer's most expensive work. Do it once, as the author, while
you still remember why.

## Step 0 — Follow the house style if there is one

**Never impose this structure on a repo that has its own.** In order:

1. `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, or any file under
   `.github/PULL_REQUEST_TEMPLATE/` → fill it in, exactly as written. Do not add sections it omits.
2. No template → read the **three most recently merged PRs** for their shape:
   `gh pr list --state merged --limit 3 --json title,body`. Match their headings, their level of
   detail, and their ticket-reference convention.
3. Nothing to go on → use the structure below.

Also match the repo's commit and title convention (`gh pr list` shows it): if titles read
`feat(scope): thing (TICKET-123)`, yours does too.

## Step 1 — Establish the real blast radius

**With the graph:**

```
gitnexus_detect_changes({ scope: "compare", base_ref: "<default-branch>", branch: "<current>" })
```

Read `changed_symbols` and `affected_processes`. For anything HIGH/CRITICAL or surprising, run
`gitnexus_impact({ target: "<symbol>", direction: "upstream" })` on it.

**Without it:** `git diff --stat <base>...HEAD`, then for each changed exported symbol, grep its
call sites. Slower, same question.

**Then do the part that matters: reconcile the tool against reality.** A symbol changing is not the
same as behaviour changing. If five call sites are listed and four are unaffected because your change
is opt-in, *say that, and say why* — otherwise the reviewer re-derives it, or worse, assumes the
risk is real. This is the single highest-value paragraph in a PR body and no template generates it.

## Step 2 — Write it

```markdown
## Summary

What this does and why, in two or three sentences. Link the ticket. If the scope was
negotiated — a comment narrowing it, a decision in review — quote that, so the reviewer
is checking against the agreed scope and not their own guess at it.

## <One section per distinct change>

What it was, what it is now, and **why this way**. Name the alternative you rejected and
the reason — that is the question the reviewer is going to ask.

State the blast radius honestly here: which other callers touch this, why they are or are
not affected, and where a tool's "affected" list overstates the real behaviour change.

## Steps to verify

Numbered, concrete, in the reviewer's hands — what to click, what to type, what should
happen. Group them by area if there is more than one. These are the steps YOU ran.

## Risk / what to watch

Only when there is something real: a migration, a feature flag, a behaviour change behind
a config, something that cannot be undone by revert. Omit the section rather than pad it.
```

## Rules

- **One section per change, not per file.** The reviewer thinks in behaviours; the file list is
  already in the diff.
- **Verification steps must be ones you actually performed.** An unrun step is a guess with a
  checkbox (GP-1). If you could not run something, say so and say why.
- **Explain rejected alternatives** — "why not just change all six call sites" is the
  question, and answering it pre-empts a review round trip.
- **Nothing in the body is for you** (GP-19). What you have not got round to verifying, why something
  is still in draft, your own doubts and plans — those go to chat or the task-core. A real limitation
  the reviewer must act on belongs; narrating your process does not.
- **Anything you changed outside what was asked gets itemised**, however small and however obviously
  correct. An unreported out-of-scope change is indistinguishable from a mistake.
- **If you could not verify something, hand over the means to** (GP-18) — a link that opens the exact
  case in the exact state, not "find an unpaid invoice". Reporting it as unverified is not a handover.
- **Do not restate the diff.** If a line adds nothing a reviewer could not read faster in the diff
  itself, cut it.
- **Screenshots for anything visual**, before/after when behaviour changed.
- **No invented ticket numbers, no invented reviewers.** If you cannot find the ticket, leave the
  link out and say it is missing.

## Before you open it

- Does the title match the repo's convention?
- Would someone who has never seen this code know what to click to check it?
- Is every claim in the body one you verified (GP-1, GP-8)?
- Is the branch actually up to date with the base?
