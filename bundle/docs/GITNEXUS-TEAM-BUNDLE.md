# GitNexus module — team guide

What bearing's GitNexus module put in this repo, and how the team uses it. GitNexus is **opt-in and user-invoked**: nothing blocks a tool or pushes the agent to the graph. Ask for it in a prompt ("use gitnexus to find what this change affects") and the `bearing-gitnexus` skill loads.

> **Installer:** [`bearing`](https://github.com/ReidenXerx/bearing) — `npx bearing install` / `update` / `uninstall` for any repo. Updates remove what older versions installed and this one retired.

> **Status in plain language:** `npm run bearing:health`.

## What's installed

| Included | Purpose |
| --- | --- |
| `CLAUDE.md` / `AGENTS.md` | Always-on agent contract |
| `.claude/settings.json` + `.claude/hooks/**` | Session brief, north-star re-anchoring, and a note on `impact` results whose counts are only a floor (Claude Code only). None of them blocks a tool call. |
| `.bearing/lib/cypher-helpers.mjs` | Copy-paste Cypher recipes (ACCESSES, CALLS, overrides) |
| `.bearing/skills/` + symlinks | Skills, including `bearing-gitnexus` (loads when you ask for the graph) |
| `scripts/bearing-setup.sh` | One-shot team installer |
| `scripts/sync-cursor-bearing-teaching.sh` | Re-sync skills symlinks after pull |
| `scripts/bearing-verify.mjs` | Runtime-aware kit verification |
| `scripts/bearing-agent.mjs` | Agent CLI (`agent-status` / `agent-refresh`) |
| `.vscode/settings.json` | npm task settings (optional) |
| `.gitnexusignore` | GitNexus-only excludes (large caches) |
| `bearing:*` npm scripts | Written into `package.json` (none in a stealth install) |

**Automatic:** install, update and `bearing:setup` **add or overwrite** the `bearing:*` scripts in `package.json` (creating it if missing). Scripts of your own are left alone.

## NOT included (per-target repo)

| Excluded | Why |
| --- | --- |
| `.gitnexus/` index | Built at install, then refreshed when you ask (`npm run bearing:agent-refresh`, or ask your agent) |
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
npm run bearing:clean-tmp            # project temp only
npm run bearing:agent-refresh
```

## Install (another repo)

```bash
/path/to/bearing/bin/install.sh /path/to/their-repo --runtime claude --features +gitnexus
```

## After install (every dev)

1. **Restart your IDE** (MCP + hooks)
2. `npm run bearing:agent-status` — is the index current?
3. When you want the graph, say so in the prompt — "use gitnexus to …" — and the `bearing-gitnexus` skill loads.

**Refreshing:** nothing refreshes the index on its own — no commit hook, no CI job — and nothing is blocked while it is stale. On a large repo a refresh takes minutes, so when to run one is your call. Graph answers from a stale index may be wrong rather than refused, so refresh before relying on them: ask your agent ("refresh the gitnexus index", or `/bearing-gitnexus refresh` in Claude Code), or run `npm run bearing:agent-refresh`. It diagnoses first and does the least that fixes the gap.

## Daily commands

```bash
npm run bearing:verify          # full kit check
npm run bearing:agent-status    # is the index current?
npm run bearing:agent-refresh   # re-index — or ask your agent
npm run bearing:sync-teaching   # re-link skills after pulling
npm run bearing:setup -- --quick  # hooks/skills only, skip index
```

## Prerequisites

- Node.js >= 22.9.0
- git
- Claude Code, Zed and/or Codex with MCP enabled
