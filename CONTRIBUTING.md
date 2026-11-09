# Contributing

Thanks for helping. bearing installs an intel layer — north-stars, task-core, review and fan-out
judgment, and an opt-in code graph — into other people's repositories, so most changes are judged by
what they do to a repo that is not ours. Read `.bearing/northstars.md` first: it outranks every
other doc here.

## Quick dev loop

```bash
git clone https://github.com/ReidenXerx/bearing.git
cd bearing
npm test
```

## What lives where

| Path | Role |
|------|------|
| `bundle/` | Everything an install copies into a target repo: hooks, libs, skills, scripts, docs |
| `lib/kit.mjs` | Install / update / uninstall core; `lib/migrate.mjs` retires what older versions left |
| `lib/adapters/` | One adapter per runtime (Claude Code, Zed, Codex) |
| `scripts/contract/`, `scripts/skill-fragments/` | Sources for generated text — `npm run gen:contract`, `npm run gen:skills` |
| `bin/*.sh` | Thin CLI wrappers |
| `docs/` | Architecture, quick start, release checklist, the project page |
| `bundle/docs/` | Team-facing guides copied to target repos |

## Changing behaviour

1. Edit under `bundle/` (hooks, libs, skills, scripts) or `lib/`.
2. Run `npm test`. A new test should fail with your fix reverted (NS-9).
3. Install into a scratch git repo and run `npm run bearing:verify` there — an update over an
   install made by the previous version is the case that finds the most.
4. Open a PR with the test plan filled in.

## Commit style

- Focus on **why** in the message body when behaviour changes.
- Keep bundle diffs reviewable — one concern per PR when possible.

## Questions

Open a [Discussion](https://github.com/ReidenXerx/bearing/discussions) or an issue with the
**install / verify** output attached.
