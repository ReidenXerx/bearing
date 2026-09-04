# Quick start

Install **bearing** into any git repo. It copies hooks, rules and skills, wires your IDE, and — if you choose the GitNexus module — builds the code graph and verifies the stack.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥ 22.9.0 | `node -v` |
| git | target must be a worktree |
| An agent runtime | Claude Code · Cursor · Zed · Codex |
| *(GitNexus module only)* | the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server |

## Install

```bash
npx bearing            # interactive — explains each module, you pick
```

Or be explicit:

```bash
npx bearing install /path/to/repo --runtime claude --features northstars,taskcore
npx bearing install /path/to/repo --runtime all    --features all
```

### Runtimes

`claude` · `cursor` · `zed` · `codex` · `both` (=cursor+zed) · `all` — or a comma list like `cursor,claude`.

Only Claude Code and Cursor expose tool-interception hooks, so only they can *enforce*. On Zed and Codex the same rules arrive as instruction via `AGENTS.md`. See the matrix in the [README](../README.md#module-support-by-runtime).

### Features

`northstars` · `taskcore` · `microscope` · `gitnexus` · `all`

Each module installs and works independently — none depends on another. Choosing fewer ships fewer files: an intel-only install (`northstars,taskcore,microscope`) writes 9 libs, 3 skills and 4 hooks, with no enforcement gates at all.

Your selection is recorded in the manifest and **inherited on update**, so you only pass `--features` to change it.

### Other flags

```bash
--quick        # skip the graph index build (GitNexus module); build it later
--no-setup     # copy the bundle only — no setup, no index
--skip-verify  # skip the post-install audit
--repo-name X  # when the folder name ≠ the indexed repo name
```

### From a clone

```bash
git clone https://github.com/ReidenXerx/bearing.git
cd bearing
./bin/install.sh /path/to/repo --runtime all
```

## After install (target repo)

1. **Restart your IDE** on the target project — MCP + hooks (Cursor), agent profile (Zed), or hooks + MCP + `CLAUDE.md` (Claude Code) load on restart.
2. `npm run bearing:verify` — runtime-aware kit audit (also runs at end of install).
3. `npm run bearing:health` — human-friendly status for your team.
4. Open a **new Agent chat** and describe your task.
5. Share [`docs/GITNEXUS-TEAM-BUNDLE.md`](../bundle/docs/GITNEXUS-TEAM-BUNDLE.md) with the team (copied to target on install).

> Install overwrites `.cursor/hooks.json` when runtime includes Cursor. Existing file is backed up to `.cursor/hooks.json.bearing.bak`. Global `~/.cursor/mcp.json` is not modified.

## What install does

```
bearing install
  → stepped banner UI (validate → migrate legacy → copy → merge → manifest → setup)
  → migrate legacy bearing layout (rsync skills, old manifest, zed profile)
  → copy bundle (rules, hooks, skills store, scripts, team guide)
  → materialize .bearing/skills/ + symlink into .cursor/ and/or .agents/
  → merge gated package.json bearing:* scripts + .cursor/mcp.json (Cursor)
  → merge .zed/settings.json + AGENTS.md (Zed)
  → gitnexus-setup.sh (--skip-global-mcp)
      → build .gitnexus/ index (unless --quick)
  → npm run bearing:verify
```

Skills live once in `.bearing/skills/` and are **symlinked** — not copied — into IDE skill paths. Updates replace the store and refresh symlinks.

## Update

```bash
./bin/update.sh /path/to/your-repo                  # keeps the installed runtime (read from the manifest)
./bin/update.sh /path/to/your-repo --runtime all    # CHANGE runtime, e.g. add Claude Code to an old install
```

`update` reads the runtime from the manifest, so you only pass `--runtime` to **change** it. Default: `--quick` (skips full re-index). **Migration runs on every update** — old rsync'd `.cursor/skills/*`, `.claude/skills/*`, legacy manifest, and Zed profile key `gitnexus` are cleaned automatically.

> **Fresh clone of an already-installed repo?** The manifest (`.bearing/manifest.json`) is **gitignored**, so it isn't in a new clone — `update` will stop with *"Not installed. Run install first."* That's expected: run **`./bin/install.sh /path/to/repo --runtime all --no-setup`** instead. Install is idempotent — it re-materializes the current bundle and rewrites the manifest without touching your code.

Bulk update every installed repo under a workspace root:

```bash
./bin/update.sh --all /path/to/projects --runtime both --no-setup --skip-verify
```

Restart your IDE after updating.

## Uninstall

```bash
./bin/uninstall.sh /path/to/your-repo
./bin/uninstall.sh /path/to/your-repo --remove-index   # also remove .gitnexus/
```

## Daily commands (target repo)

```bash
npm run bearing:verify          # full kit check (cursor / zed / both)
npm run bearing:health          # team-friendly status
npm run bearing:agent-brief     # session orientation (agents)
npm run bearing:agent-status    # staleness (agents)
npm run bearing:agent-refresh   # re-index when stale
npm run bearing:branch-status   # branch/base summary + branch-aware MCP calls
npm run bearing:pr-impact       # branch-aware PR review playbook
npm run bearing:pdg             # incremental embeddings + skills + PDG (mid-session)
npm run bearing:full-pdg        # full --force rebuild + PDG (pre-commit hook uses this)
npm run bearing:graph-smoke     # Cypher / ACCESSES sanity (CI)
npm run bearing:detect-api      # HTTP router profile
npm run bearing:sync-teaching   # after pulling kit updates
```

### Gate docs in package.json

```bash
npm run bearing.__gate.1.session      # Gate 1 — health, brief, status
npm run bearing.__gate.2.orient         # Gate 2–4 — orient + MCP
npm run bearing.__gate.5.index          # Gate 5 — refresh / embeddings
npm run bearing.__gate.6.verify         # Install / CI verification
npm run bearing.__gate.kit.maintainer   # setup, sync, pack, hooks
```

Source: `scripts/bearing-teaching/script-gates.mjs`

## Advanced capabilities

| Capability | Commands / hooks |
|------------|------------------|
| **Cypher** | Field ACCESSES, N-hop CALLS — `grep-guard`, `read-guard`, `agent-brief` |
| **`rename` MCP** | Graph-coordinated rename — `edit-guard`, prompt-router |
| **API router profile** | `npm run bearing:detect-api` → `.cursor/gitnexus-api-profile.json` |
| **Branch-aware PR review** | `npm run bearing:branch-status -- main`; `npm run bearing:pr-impact -- main` |
| **PDG pre-commit refresh** | `.githooks/pre-commit` runs `npm run bearing:full-pdg` before `bearing:graph-smoke` |
| **Graph smoke test** | `npm run bearing:graph-smoke`; pre-commit after PDG refresh |
| **Zed + Ollama** | See [ZED.md](./ZED.md) — **Zed + GitNexus** profile, local model hints |

See [Architecture](./ARCHITECTURE.md) for diagrams and failure-mode mapping. See [Skills](./SKILLS.md) for task-to-skill routing.

## Release / maintainer docs

- [CHANGELOG.md](../CHANGELOG.md) — notable changes and migration notes.
- [RELEASE.md](./RELEASE.md) — release checklist, privacy scan, and install/update matrix.
