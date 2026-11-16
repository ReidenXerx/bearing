# 🌳 ast-grep

**Searches and rewrites by code shape, and proves the pattern first.** Every `fetch` with no `signal`, every swallowed `catch`, a decided change at 100 sites — matched on the syntax tree, not a regex. The skill carries the traps that make it lie quietly: a pattern that does not parse returns `[]` exactly like a clean codebase, `-l ts` skips `.tsx`. On by default since a real-repo eval showed it earns it; uses ast-grep from `PATH` or `npx`, adds nothing to `package.json`.

The whole of it — every trap, and what to do about each — is the skill the agent loads: [`bundle/skills/bearing-astgrep/SKILL.md`](../../bundle/skills/bearing-astgrep/SKILL.md).

---

[← back to the README](../../README.md)
