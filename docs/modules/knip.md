# 🧹 knip

**Finds dead code without deleting live code.** Runs [knip](https://knip.dev) with `npx` and treats its list as candidates: on a real NestJS backend 114 of 191 "unused files" were migrations TypeORM loads by glob. The skill names what makes live code look dead — glob-loaded entities, template `import()`, hand-run scripts, packages loaded by name — and how to tell knip without touching the repo. Opt-in; adds nothing to `package.json`.

The whole of it — every trap, and what to do about each — is the skill the agent loads: [`bundle/skills/bearing-knip/SKILL.md`](../../bundle/skills/bearing-knip/SKILL.md).

---

[← back to the README](../../README.md)
