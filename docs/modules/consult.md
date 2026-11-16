# 🙋 Consult

**Agents interrupt you for the wrong things, and go quiet for the wrong things.**

Permission to rename a file; silence while they invent a business rule. Consult is the judgment that separates the two, for a senior engineer who does not want to be asked about naming.

**The test that does most of the work: is the answer discoverable in the repo?** Code, tests, config, git history, north-stars — then it goes and finds it, because asking is offloading. If it exists only in *your* head — which of two readings you meant, which tradeoff you prefer, what a user should actually see — no amount of reading produces it. **That** is the question.

And it asks **before** it writes the rule, not after — as options you click, not a question you have to answer in a paragraph: two to four concrete choices, its recommendation first, one line of tradeoff each, and related questions in one prompt so you answer once. Never *"shall I proceed?"* — that is not a question, it is accountability being handed back to you.

**One-way doors are a different act.** Deleting data, force-pushing, publishing, migrating — it *confirms*, even when the right answer is obvious, because irreversible is the reason, not ambiguity. Reversible work needs no permission.

The contract carries this judgment on its own. A prompt that poses the test at the first edit of a
session is there too, **off by default** — whether to stop and ask is your call; turn it on with
`"consultNudge": true` in `.bearing/hooks.json` and `bearing update`.

Most answers are just applied. The rare one that is a **rule** — one a future task would otherwise break — gets proposed as a north-star in the same reply, so that question is never asked again.

---

[← back to the README](../../README.md)
