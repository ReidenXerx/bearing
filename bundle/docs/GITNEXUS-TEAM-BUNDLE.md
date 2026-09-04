# GitNexus agent teaching bundle — team install

Portable **contract + hooks + skills + scripts** for graph-first agents. Claude Code gets the enforcement hooks; Zed and Codex get the contract (only Claude Code can intercept tool calls). Built for this repo; reusable on other projects with one rename step.

> **Standalone installer:** [`bearing`](https://github.com/ReidenXerx/bearing) — `install` / `update` / `uninstall` scripts for any repo (upstream for this teaching bundle). Updates **migrate** legacy `bearing` layouts automatically.

> **What enforcement feels like** for a developer, in plain language: run `npm run bearing:health`.

## What's in the bundle

| Included | Purpose |
| --- | --- |
| `CLAUDE.md` / `AGENTS.md` | Always-on agent contract |
| `.claude/settings.json` + `.claude/hooks/**` | Block grep-first; symbol grep → the graph; impact before edits; **session brief on start** (Claude Code only) |
| `.bearing/lib/cypher-helpers.mjs` | Copy-paste Cypher recipes (ACCESSES, CALLS, overrides) |
| `.bearing/skills/` + symlinks | Playbooks (enforcement, scenarios, exploring, …) |
| `scripts/bearing-setup.sh` | One-shot team installer |
| `scripts/sync-cursor-bearing-teaching.sh` | Re-sync skills symlinks after pull |
| `scripts/bearing-verify.mjs` | Runtime-aware kit verification |
| `scripts/bearing-agent.mjs` | Agent CLI (`agent-status` / `agent-refresh`) |
| `scripts/install-git-hooks.sh` + `.githooks/pre-commit` | PDG index refresh on commit |
| `.vscode/settings.json` | npm task settings (optional) |
| `.gitnexusignore` | GitNexus-only excludes (large caches) |
| `package.json.scripts.snippet.json` | npm scripts to merge |

**Automatic:** `install-from-bundle.sh` and `bearing:setup` run `merge-package-scripts.mjs --write`, which **adds or overwrites** all `bearing:*` and `hooks:install` scripts in `package.json` (creates `package.json` if missing).

## NOT included (per-target repo)

| Excluded | Why |
| --- | --- |
| `.gitnexus/` index | Built locally via `npm run bearing:refresh`; pre-commit upgrades it with `npm run bearing:full-pdg` |
| `.claude/skills/gitnexus-area-*/` | Area skills from `gitnexus analyze --skills` on **that** codebase |
| IDE skill symlinks | Created by install/update from canonical store |

## Large generated caches (recommended)

If the repo has thousands of non-source files (e.g. large data shards, generated reports, fixtures), add them to **both**:

- **`.gitignore`** — keep git clean
- **`.gitnexusignore`** — same gitignore syntax; keeps `gitnexus analyze` fast

Example: ignore `data/` and `reports/` in both files. After changing ignores, re-index:

```bash
npm run bearing:agent-refresh
```

## /tmp full (tmpfs ENOSPC)

On Linux, `/tmp` is often a **tmpfs** (RAM disk, ~7–8G). When it hits 100%, `gitnexus analyze` fails with ENOSPC even if your NVMe has hundreds of GB free.

All `bearing:*` npm scripts route temp files to **`.tmp-agent/`** on the project disk (override: `GITNEXUS_TMPDIR`).

If refresh still fails:

```bash
df -h /tmp
sudo du -sh /tmp/* 2>/dev/null | sort -hr | head -10
rm -rf /tmp/cursor-sandbox-cache/*    # often safe
npm run bearing:clean-tmp            # project temp only
npm run bearing:agent-refresh
```

## Pack (this repo)

```bash
npm run bearing:pack
# → gitnexus-cursor-teaching-v2-YYYYMMDDTHHMMSSZ.tar.gz
```

## Install (another repo)

```bash
tar -xzf gitnexus-cursor-teaching-*.tar.gz -C /path/to/their-repo --strip-components=1
cd /path/to/their-repo
GITNEXUS_REPO_NAME=their-repo-name bash scripts/bearing-teaching/install-from-bundle.sh
```

Or use the standalone kit (recommended):

```bash
/path/to/bearing/bin/install.sh /path/to/their-repo --runtime both
```

## After install (every dev)

1. **Restart your IDE** (MCP + hooks / Zed profile)
2. `npm run bearing:agent-status` — index fresh?
3. Start Agent chats with: *"Read bearing-workspace skill, then …"*

**Auto-refresh:** On Agent session start, hooks run `npm run bearing:agent-refresh` if the index is behind HEAD (skip with `GITNEXUS_SKIP_SESSION_REFRESH=1`). While stale, a shell guard blocks non-gitnexus commands until refresh succeeds — agents must not tell users to run analyze manually.

## Daily commands

```bash
npm run bearing:verify          # full kit check
npm run bearing:agent-status    # staleness (agent runs autonomously)
npm run bearing:agent-refresh   # re-index when stale
npm run bearing:sync-teaching   # after pulling rule/skill updates
npm run bearing:setup -- --quick  # hooks/skills only, skip index
```

## Prerequisites

- Node.js >= 22.9.0
- git
- Claude Code, Zed and/or Codex with MCP enabled
