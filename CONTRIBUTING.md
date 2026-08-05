# Contributing

Thanks for helping make graph-first Cursor agents the default — not the sidecar.

## Quick dev loop

```bash
git clone https://github.com/ReidenXerx/bearing.git
cd bearing
npm test
```

## What lives where

| Path | Role |
|------|------|
| `bundle/` | Teaching bundle copied into target repos on install |
| `lib/kit.mjs` | Install / update / uninstall core |
| `bin/*.sh` | Thin CLI wrappers |
| `docs/` | Maintainer + architecture docs for this repo |
| `bundle/docs/` | Team-facing guides copied to target repos |

## Changing enforcement behavior

1. Edit under `bundle/` (rules, hooks, skills, scripts).
2. Run `npm test`.
3. Install into a scratch git repo and run `npm run bearing:verify` there.
4. Open a PR with the test plan checklist filled in.

## Syncing from a production repo

If you maintain a dogfood repo with the latest teaching bundle:

```bash
./scripts/refresh-bundle-from-source.sh /path/to/source-repo
npm test
```

## Commit style

- Focus on **why** in the message body when behavior changes.
- Keep bundle diffs reviewable — one concern per PR when possible.

## Questions

Open a [Discussion](https://github.com/ReidenXerx/bearing/discussions) or issue with the **install / hooks / verify** output attached.
