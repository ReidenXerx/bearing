# Quick start

Install **bearing** into any git repo. It copies the contract, hooks and skills for the modules you pick, wires your agent runtime, and checks its own work.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥ 22.9.0 | `node -v` |
| git | the target must be a git worktree |
| An agent runtime | Claude Code · Zed · Codex |
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

`claude` · `zed` · `codex` · `all` (= all three) — or a comma list like `zed,claude`.

Only Claude Code exposes tool-interception hooks, so only there do the nudges fire by themselves (the north-star re-anchor, the task-core reminder). Zed and Codex get the same rules through `AGENTS.md`. None of the hooks blocks a tool call. See the matrix in the [README](../README.md#install).

### Modules

`northstars` · `goldpractices` · `taskcore` · `microscope` · `consult` · `minions` · `tsjs` · `frontend` · `react` · `astgrep` · `gitnexus` · `e2e` · `all`

The default install is the first six. Each module installs and works on its own — none depends on another. **GitNexus is opt-in**: the interactive installer explains what it is and what it costs, and asks; `--features +gitnexus` adds it directly. Once installed it pushes nothing — ask for it in a prompt ("use gitnexus to find what this change affects") and the `bearing-gitnexus` skill loads.

Your selection is recorded in the manifest and **inherited on update**, so you only pass `--features` to change it (`+e2e`, `-minions`, or a full list).

### Other flags

```bash
--stealth          # for a repo that isn't yours: nothing tracked changes (see below)
--quick            # GitNexus module: skip the index build; build it later
--no-setup         # copy the bundle only — no setup, no index
--skip-verify      # skip the post-install audit
--repo-name X      # when the folder name ≠ the indexed repo name
--mcp http|stdio   # GitNexus module: one shared server, or one process per client
--gitnexus-cmd C   # GitNexus module: the gitnexus binary to call (default: the installed one, else npx)
```

**Stealth** installs for you only: ignores go in `.git/info/exclude` (per clone, never pushed), no npm scripts are added, and the contract is injected each session instead of written to `CLAUDE.md`. `git status` stays clean.

### From a clone

```bash
git clone https://github.com/ReidenXerx/bearing.git
cd bearing
./bin/install.sh /path/to/repo --runtime claude
```

## After install

1. **Restart your agent** on the target project — hooks, MCP and skills load on restart.
2. Open a **new chat** and describe your task.
3. With the GitNexus module: `npm run bearing:health` for a plain-language status, `npm run bearing:verify` for the full audit (it also runs at the end of install).

## What install does

```
bearing install
  → validate the target repo
  → migrate an older install (renamed paths, retired hooks and skills, old manifests)
  → copy the bundle for the selected modules
  → materialize .bearing/skills/ and symlink it into .claude/skills/ and/or .agents/skills/
  → wire the runtime: .claude/settings.json hooks, CLAUDE.md / AGENTS.md contract,
    and — GitNexus only — the MCP server and the bearing:* npm scripts
  → write the manifest (what it installed, so update and uninstall touch only that)
  → GitNexus only: scripts/bearing-setup.sh builds the .gitnexus/ index (unless --quick)
  → verify
```

Skills live once in `.bearing/skills/` and are **symlinked**, not copied, into the runtime's skill path. Updates replace the store and refresh the links; a retired skill's link is removed, and your own skills are never touched.

A **status line** for Claude Code ships with bearing but is NOT wired by an install — it is one bar at the bottom of every session in every project, so it is a machine-wide opt-in, not a per-repo one. Turn it on once with `npx bearing statusline` (installs `~/.claude/statusline.sh` and wires `~/.claude/settings.json`); `npx bearing statusline --remove` takes it back out. A `statusLine` you configured yourself is never overwritten — bearing installs the script and prints the one line to switch, leaving the choice to you. It shows context, 5h/7d quota burn with an on-pace warning, prompt-cache TTL and machine vitals, and stays quiet unless something is off. One copy covers every repo: it reads the project directory out of the session payload. Tunables (`SL_NERD`, `SL_VITALS`, `SL_MEM_WARN_MB`, `SL_IO_WARN`) are documented in the script header.

## Update

```bash
npx bearing update /path/to/your-repo                    # keeps the recorded runtime and modules
npx bearing update /path/to/your-repo --features +e2e    # add a module
npx bearing update /path/to/your-repo --full             # also rebuild the GitNexus index
```

`update` reads the runtime and modules from the manifest, so you only pass them to **change** them. It defaults to `--quick` (no re-index). **Migration runs on every update**: anything an older version installed and this one retired — hooks, libs, skills and their links, npm scripts, the pre-commit index refresh and its CI workflows — is removed, and a second update changes nothing.

> **Fresh clone of an already-installed repo?** The manifest (`.bearing/manifest.json`) is **gitignored**, so it isn't in a new clone — `update` stops with *"Not installed. Run install first."* That's expected: run **`npx bearing install /path/to/repo --no-setup`** instead. Install is idempotent — it re-materializes the current bundle and rewrites the manifest without touching your code.

Update every installed repo under a folder:

```bash
npx bearing update-all /path/to/projects --no-setup --skip-verify
```

Restart your agent after updating.

## Uninstall

```bash
npx bearing uninstall /path/to/your-repo
npx bearing uninstall /path/to/your-repo --remove-index   # also remove .gitnexus/
```

## GitNexus commands (target repo, GitNexus module only)

```bash
npm run bearing:health          # plain-language status
npm run bearing:verify          # full kit check
npm run bearing:agent-status    # is the index fresh?
npm run bearing:agent-refresh   # re-index — or ask your agent: "refresh the gitnexus index"
npm run bearing:branch-status   # branch/base summary + branch-aware MCP calls
npm run bearing:pr-impact       # branch-aware PR review
npm run bearing:full-pdg        # full --force rebuild + PDG
npm run bearing:graph-smoke     # Cypher / ACCESSES sanity check (CI)
npm run bearing:detect-api      # HTTP router profile
npm run bearing:fallback -- "…" # file a report when the graph was wrong
```

Nothing refreshes the index on its own — no commit hook, no CI job. On a large repo a refresh takes minutes, so you decide when: ask your agent ("refresh the gitnexus index", or `/bearing-gitnexus refresh` in Claude Code) or run `bearing:agent-refresh`. Either way it diagnoses first and does the least that closes the gap.

A stealth install has no npm scripts; run the same commands as `node scripts/bearing-agent.mjs <command>`.

See [Architecture](./ARCHITECTURE.md) for how the pieces fit, and [Skills](./SKILLS.md) for what each skill is for. With Zed and a local model: [ZED.md](./ZED.md).

## Release / maintainer docs

- [CHANGELOG.md](../CHANGELOG.md) — notable changes and migration notes.
- [RELEASE.md](./RELEASE.md) — release checklist, privacy scan, and install/update matrix.
