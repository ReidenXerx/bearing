# ⚑ North-stars

**Docs rot. Comments lie. The agent's own inference fills the gaps.**

Write them as claims a conclusion could actually **violate**:

```markdown
- **NS-4** — Win-rate is NEVER a ranker. Only net expectancy is a profitability claim.
- **NS-9** — REJECTED: averaging into a losing position. Measured: adds fill only on the
             weaker cases. Don't re-propose without new evidence.
```

*"Be careful with risk"* can't be violated, so it can't catch anything. **Falsifiable or it's decoration.**

The graveyard stops ideas respawning six months later. If the agent can't cite a north-star for a load-bearing claim, it says so — that's your drift alarm.

> Built for a codebase where 81 documents had come to contradict each other on live production parameters.

## 🥇 Gold practices — the half that isn't yours

North-stars say what *your project* is. `.bearing/gold-practices.md` ships with bearing and says how
the work is done **anywhere** — numbered `GP-#`, cited the same way, and **outranked by your `NS-#`**
whenever they disagree.

**Every rule has a scar, and a rule without one is not in the file.** Nothing about writing tests or
naming things — you already do that. These are the mistakes that got made *anyway*, by a careful
agent, on this codebase:

> **GP-3 — Test at the seam the bug lives at.** A unit test that passes an argument the real pipeline
> never produces is green and dead. *Scar: a context-window fix tested as `resolve(300_000, undefined)`
> while the shipped config always passed a number — so the fix could not run, and did not, for two
> releases.*

## 💭 Memory — kept true, not just kept

In Claude Code, the north-stars module also asks one question at the moments memory goes stale: after a merge, a
tag, a release or a publish, the agent is asked whether its project memory still says what is true.
In the session brief, a memory file that is a week or more old with commits since gets the same
question. It never writes memory itself. Turn it off with `"memoryNudge": false` in
`.bearing/hooks.json`, then `bearing update`; `npx bearing status` shows how often it fired.

---

[← back to the README](../../README.md)
