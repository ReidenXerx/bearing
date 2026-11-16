# 🦒 mergiraf

**Merges parallel work by syntax tree — and makes the agent read every resolution.** Two minions add an import and a method to the same class: git conflicts, [mergiraf](https://mergiraf.org) keeps both. It does so silently and `git merge` commits at once, so the skill merges with `--no-commit` and nothing configured, and the main agent — never a subagent — reads each `mergiraf review` before committing, then typechecks: a clean merge is not a correct one. Opt-in; needs the mergiraf binary.

The whole of it — every trap, and what to do about each — is the skill the agent loads: [`bundle/skills/bearing-mergiraf/SKILL.md`](../../bundle/skills/bearing-mergiraf/SKILL.md).

---

[← back to the README](../../README.md)
