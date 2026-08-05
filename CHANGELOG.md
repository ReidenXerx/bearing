# Changelog

All notable changes to `bearing` are documented here.

## 1.0.0 — first public release (as `bearing`)

> **Why the number went down.** Everything below 1.0.0 shipped privately as `gitnexus-agent-kit`.
> This is the first release published to npm, so the version resets rather than inheriting a history
> nobody outside the project can see. Older entries are kept for provenance.

### Renamed

- `gitnexus-agent-kit` → **`bearing`**: package, CLI (`bearing`, `bearing-update`, `bearing-uninstall`), repo, and the whole internal surface — `.gnkit/` → `.bearing/`, `gitnexus-*` hooks → `bearing-*`, `gitnexus:*` scripts → `bearing:*`, skills, Cursor rules and data files.
- **Every legacy npm script name still works** as an alias, so a pre-commit hook calling `npm run gitnexus:full-pdg` keeps working after upgrading.
- Migration moves your `.gnkit/` contents — north-stars, task-core, per-machine config — rather than leaving a fresh directory beside them. If both exist it refuses to guess and says so.

### Added

- **Feature modules.** `--features northstars,taskcore,microscope,gitnexus` — each installs and works independently, none depends on another. An intel-only install ships no enforcement gates, so a repo without GitNexus is never told to run a command it does not have.
- **Interactive installer** that explains each module and lets you choose.
- **North-stars** — user-owned, authoritative, numbered project invariants that outrank every other doc and are re-anchored mid-session.
- **Task-core** — a dense save-state written before compaction and read back on recovery.
- **Fallback → telemetry bridge** — every graph-distrust escape hatch is logged with the graph state, reviewable via `bearing:fallback-log`.
- **Codex** runtime (contract tier — `AGENTS.md`, no tool gates).
- Node CLI entry point: fixes `npx` (npm symlinks broke the old bash wrappers) and drops the bash dependency, so Windows works without WSL.
- Per-machine config override `.bearing/hooks.local.json` and `GITNEXUS_CONTEXT_WINDOW`.

### Fixed

- Drift gate counted **zero** for new source files in a new directory (git collapses untracked dirs) and for **deleted** source files — both now counted, the latter clearing once the index is rebuilt.
- Context-pressure estimator fell back to a byte count of an unbounded transcript, reporting a 273 MB log as ~78M tokens and firing "context full" on every tool call.

## 1.2.0 — GitNexus v1.6.8 alignment

### Added

- First-class Cursor + Zed runtime support via `--runtime cursor|zed|both`.
- Zed project profile: **Zed + GitNexus**, `.agents/skills` symlinks, and `AGENTS.md` guidance.
- PDG-aware pre-commit refresh: `.githooks/pre-commit` runs `npm run bearing:pdg` before graph smoke checks.
- GitNexus v1.6.8 tool routing for `trace`, `pdg_query`, PDG `impact`, and taint `explain`.
- Security review skill covering taint, PDG flows/controls, trace, and impact.
- CUDA source detection (`.cu`, `.cuh`) in hooks and review helpers.
- Branch-aware review commands:
  - `npm run bearing:branch-status`
  - `npm run bearing:pr-impact`
- Persistence/database health checks in `health` and `doctor`.
- Bulk update command for installed repos:
  - `./bin/update.sh --all [search-root] --runtime both`
- Skill index docs for routing tasks to the right playbook.

### Changed

- Mid-session agent refresh stays lightweight (`bearing:agent-refresh`), while commit-time refresh uses PDG.
- Update can upgrade an existing cursor-only or zed-only install to `both`.
- Zed-only installs now include shared helper modules required by target repo CLI commands without enabling Cursor hooks.
- Generated MCP snippets now use current v1.6.8 parameter names (`search_query`, Cypher `statement`).
- Help examples now use neutral placeholder repo names.

### Fixed

- Zed-only `gitnexus-agent.mjs health/brief/verify` compatibility.
- Incorrect “Index built” status when install/update used `--no-setup`.
- Private/source repo name leakage in public docs and maintainer scripts.
- Legacy mirrored skills using outdated MCP argument names.

### Migration notes

- To upgrade an installed repo to Cursor + Zed support:

  ```bash
  ./bin/update.sh /path/to/repo --runtime both --no-setup --skip-verify
  ```

- To upgrade every installed repo under a workspace root:

  ```bash
  ./bin/update.sh --all /path/to/projects --runtime both --no-setup --skip-verify
  ```

- After update, restart Cursor/Zed and run in target repos:

  ```bash
  npm run bearing:health
  npm run bearing:verify
  ```
