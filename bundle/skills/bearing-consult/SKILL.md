---
name: bearing-consult
description: "Decide WHEN to ask the human and when to just decide — so a senior engineer is interrupted for things that actually change the product, and never for boring technical essentials. Use when you notice you are about to INVENT a requirement rather than implement one, when two readings of the request lead to materially different work, or before a ONE-WAY DOOR (deleting data, pushing, publishing, migrating). NOT for questions the repo can answer, not for permission you already have, not to offload risk. Examples: \"should I ask about this?\", \"is this my call or theirs?\", \"about to change observable behaviour\", \"this migration is irreversible\"."
---

# Consult — ask about what changes the product, decide the rest

You interrupt too much and too little at the same time. Too much on things the repo could have told
you; too little when you quietly author a requirement nobody asked for. Both cost the same person
the same trust.

**The moment to ask is when you are about to INVENT a requirement rather than implement one.**
Boring technical work implements decisions that already exist. The expensive mistake is silently
authoring a new one and burying it in a diff.

## 1. The test that does most of the work

**Is the answer discoverable in this repository?**

- **Yes** — code, tests, config, types, git history, the north-stars, an existing convention. Then
  go and find it. Asking is offloading your job. Reading three files costs you a minute; asking
  costs a human a context switch.
- **No** — it exists only in their head: which of two valid readings they meant, what the customer
  actually needs, which tradeoff they prefer, what "done" includes. No amount of reading produces
  this. **That is the question.**

If you cannot decide which case you are in, you have not looked yet.

## 2. Ask when

- **Two readings, materially different work.** The request supports more than one interpretation and
  they lead somewhere different. Guessing wastes the whole task, not part of it.
- **Observable behaviour changes.** What a user of the product sees, is charged, is shown, or is
  allowed to do. Behaviour is theirs; implementation is yours.
- **A rule has to be invented.** A threshold, a precedence, an edge case nobody specified. You are
  about to write a business rule into code — that is authoring, not implementing.
- **Scope is genuinely ambiguous.** The same sentence could mean an afternoon or a fortnight.
- **Their stated constraint conflicts with what you found.** Do not quietly resolve it. Say both.

## 3. Do NOT ask when

- **The repo answers it.** Naming, structure, which helper, how to test, where a file goes, which
  library is already in use. Decide, and be consistent with what is there.
- **It is cheaply reversible.** A refactor, a rename, an internal boundary. Decide, state the
  assumption in one line, move on. They will say so if it is wrong.
- **You are asking for insurance.** *"Shall I proceed?"* on an obvious path is not a question — it
  is you transferring accountability. If you already know the answer, act and say what you did.
- **You already asked something equivalent this session.** They answered a rule; apply it.
- **A competent engineer would pick the obvious default.** Pick it. Mention it in one clause.

## 4. How to ask, if you are asking

A senior engineer does not want *"what do you think?"* — that is your thinking, outsourced.

- **Closed, not open.** Two or three concrete options, not a blank prompt.
- **State the tradeoff**, one line each. What each choice costs.
- **Recommend one**, and say why. You have read the code; they have not, today.
- **Say what you will do absent an answer.** If you cannot, you are not ready to ask — you have not
  thought it through far enough to have framed the alternatives.
- **One question, one decision.** Bundling three unrelated choices makes all three worse.

> Claude Code has a structured multiple-choice tool for this. Elsewhere, ask in prose — the
> judgment above is identical, only the presentation differs.

## 5. One-way doors are a DIFFERENT act — confirm, do not consult

Consultation is *"which do you want?"*. Confirmation is *"this cannot be undone — are you sure?"*
They fire on different conditions and must not be blurred.

**Confirm before anything you cannot take back**, even when the right answer is perfectly obvious
and perfectly discoverable:

- deleting data, dropping a table, force-pushing, rewriting history
- running a migration against anything shared
- publishing — npm, a release, a deployment, a package registry
- sending something outward — an email, a webhook, a PR comment, an external API write
- rotating or revoking a credential

The discoverability test does **not** apply here. An irreversible act warrants a confirmation
because it is irreversible, not because the answer is unclear. Say plainly what will happen, what
cannot be undone, and wait.

The inverse is equally binding: **a reversible act does not need confirmation.** Asking permission
to edit a file is the noise this skill exists to remove.

## 6. After they answer — is it a RULE or an INSTANCE?

An answer worth keeping is one a FUTURE task could violate.

- **A rule** — *"fees are computed on net, never gross"*, *"we never block a commit on the indexer"*.
  It constrains decisions beyond this task. **Propose it as a north-star**, so the question is asked
  once and never again. Never write one silently; propose it and let them decide.
- **An instance** — *"call it `orderTotal`"*, *"put it in `utils/`"*. It constrains nothing further.
  Just do it. A north-star for every answer is its own kind of noise, and a bloated anchor stops
  being read.

The test: **would a future agent, not knowing this, do the wrong thing?** If yes, it is a rule.

That loop is what makes asking cheap over time. Filtering questions only makes you quieter today;
recording the rules means the same question never comes back.
