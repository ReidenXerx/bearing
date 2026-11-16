# 💭 Memory maintenance — the agent keeps its own memory true

Memory is what the **next** session starts from. A coding agent writes it when it thinks of it, and
nothing else keeps it current: a decision changes, a PR merges, the plan moves on, and next week's
session trusts a file that describes last week's project. bearing asks the agent to maintain it at
the four moments it goes stale. The agent does the writing; bearing never writes memory itself.

| When | What the agent is told |
|---|---|
| **Session start** — memory is 7+ days old *and* commits have landed since | Reconcile it before relying on it: update or delete what is no longer true. Silent when memory is fresh or nothing was committed. |
| **While it works** — 25 edits since the task-core was last written | Refresh the task-core: goal, decisions and why, state, `file:line` anchors, what already failed. A compaction can land at any time and gives no warning. |
| **At a milestone** — `gh pr merge`, `gh release create`, a `git tag` that creates a tag, `npm`/`pnpm`/`yarn publish` | Does memory still say what is true? If the project's state, a decision, what is next or how you work changed, update it now — one fact per file, stale entries corrected or deleted. Nothing changed, nothing to write. |
| **After compaction** — the transcript was summarised away | Read the task-core and memory back first, whole, and reconcile them with the code before continuing. |

The milestone prompt stays quiet when memory was written in the last 30 minutes, and speaks at most
once per 30 minutes, so merge-then-tag is one milestone, not two.

**Knobs** (in `.bearing/hooks.json`, then `bearing update`): `memoryNudge: false` turns off the
milestone and weekly prompts, `memoryStaleDays` sets the week, `taskCoreEveryEdits` sets the edit
count (`0` = off). `npx bearing status` lists each one with how often it fired in the last 30 days.

**Where it runs.** The prompts need tool hooks, which only Claude Code exposes; it ships with the
north-stars and task-core modules, both on by default. On Zed and Codex the contract still tells the
agent to keep memory and a task-core, and the task-core skill can be invoked by name.

---

[← back to the README](../../README.md)
