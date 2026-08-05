# Changelog

All notable changes to `bearing` are documented here.

## 1.0.4 — dogfooding, a broken uninstall, two dead gates, and field feedback

Installing `bearing` into its own repo for the first time, then auditing the paths dogfooding
doesn't reach, then acting on a report from an agent using the kit in a live project.
**Anyone on 1.0.3 should upgrade — it cannot uninstall.**

### Fixed — critical

- **`uninstall` crashed partway through.** It threw whenever no backup was recorded (the normal
  case) and, being the first adapter in the cleanup loop, took the rest with it: hooks stayed
  registered against deleted files, the MCP server stayed configured, and the manifest survived so
  the repo still looked installed.
- **`uninstall` and module-deselection deleted files they had overwritten.** Install stashes a
  colliding `.githooks/pre-commit` or `.vscode/settings.json` beside itself; removing ours without
  restoring theirs left a hole with the content stranded in a `.bearing-backup`. Both now put the
  original back.
- **Deselecting a module removed nothing.** Re-installing with fewer features left every file,
  hook, MCP entry and npm script in place — so turning GitNexus off left its gates enforcing.
- **The large-source-read gate had never fired once.** It referenced an unbound `config`; the
  `ReferenceError` was swallowed by its own fail-open catch and reported as "0 lines", so no file
  was ever large enough to gate.

### Fixed — the tool blocking legitimate work

- **A stale index was a total lockout.** One commit of drift and the agent could not run `ls`, tail
  a log, read a `.csv`, or run tests until a full reindex. Staleness now gates only what a stale
  *graph* would have answered.
- **`Glob` was inverted.** `**/*` — the broadest sweep there is — was allowed, while `src/order.js`
  was denied and told to use `query` with a concept, which cannot find a file you named by path.
- **Scoped searches were denied and sent to a tool that can't answer them**: a grep in one named
  file, a search in `tests/`, and counting occurrences, all redirected to `cypher ACCESSES`.
- **A blocked shell command implied the rest of it ran.** A denied Bash call blocks the *whole*
  line, but the message named only the offending segment — so `python3 edit.py && grep …` read as
  "the edit landed". Sequenced commands now say outright that nothing executed.

### Added — the kit distrusts the graph, and itself

- **Unreliable `impact` verdicts are flagged.** When the pre-edit gate grades a change `risk: LOW`
  but resolved no callers — or only test files — the agent is told to treat it as unknown blast
  radius and confirm classically. It warns rather than blocks: re-running `impact` returns the same
  empty answer.
- **"A graph ZERO is not evidence of absence"** is now part of the always-on contract. Positives
  are strong evidence; zeros mean *unknown* and must be confirmed before any "dead code" call.
- **The kit audits its own enforcement.** `bearing:scorecard` and the session brief report whether
  the gates are earning their keep, and name the evidence that distinguishes "gates misfiring" from
  "gates working on a grep-happy agent".

### Fixed — first-run experience

- **`npx bearing` advertised the wrong product.** Six strings still listed three runtimes after
  Codex shipped, including the runtime picker's "All" option — so choosing All looked like it
  excluded Codex.
- **The banner box stopped closing** once the greeting grew, and the installer asked "quick or full
  index?" in installs with no indexer.
- **`update-all` claimed "Index built"** for repos with no GitNexus module, and reported a failed
  reindex as the whole update failing.

## 1.0.3 — 20 defects fixed after an adversarial review

Two independent reviewers audited the install/migration core and the runtime hooks, reproducing
every finding end-to-end. **Anyone on 1.0.x should upgrade** — several of these made the tool
unusable or destructive.

### Fixed — critical

- **`npx bearing` died immediately.** The interactive installer — the command the README leads with
  — threw a `ReferenceError` on its first line.
- **Any install without the `gitnexus` module crashed**, after writing the manifest, leaving a
  half-installed repo.
- **The feature filter applied to FILES only.** `settings.json` still registered every hook,
  `package.json` still got every script, `.mcp.json` still wired GitNexus — so a filtered install
  spawned a missing module on every tool call.
- **`uninstall` deleted your north-stars** and `hooks.local.json` (untracked by the kit's own
  gitignore, so unrecoverable). It now removes only what it installed and reports what it kept.

### Fixed — the tool blocking legitimate work

- Repos living under `~/src` or `~/go/src` had **every file** treated as source: every large Read
  denied and every Edit gated, repo-wide. Classification is now repo-relative.
- Piping into `rg`/`ag`/`ack` was denied — `npm run build 2>&1 | rg error` blocked, with a Cypher
  query offered as the fix.
- `TODO`/`FIXME` greps were denied as symbols, redirected to a lookup that cannot resolve.
- A **failed refresh locked the session permanently** and re-locked it every session; the escape
  hatch existed but was unreachable.
- A repo with **no commits** denied `ls`, `cat`, Read, Grep and Edit.
- **`bearing update` tripped its own drift gate**, blocking graph queries right after updating.
- Deny messages now name the two ways out (`bearing:fallback`, `mode: guide`).

### Fixed — protecting your files

- Install **overwrote `.vscode/settings.json` and `.githooks/pre-commit`** without a backup, and
  uninstall then deleted them. Pre-existing files are now saved to `<file>.bearing-backup`.
- The pre-install backup was **re-taken from the already-modified file** on every update, so
  uninstall "restored" kit artifacts.
- Team-tuned `.bearing/hooks.json` was **reverted on every update** (e.g. `mode: guide` → blocking).
- A `.gitignore` rule appended with `>>` was **absorbed into the managed block and deleted** on the
  next update.
- `update --features` was silently ignored; migration failures were rendered as successes.

### Fixed — performance and precision

- The read guard read entire files to compare one line count (398ms / 230MB on 54MB); now a bounded
  scan (104ms → 2ms on 9.4MB).
- Context-pressure tail cap 8MB → 32MB — past it the estimator reports "unknown", which reads as
  "not full" exactly when the window is filling.
- `git … commit` was a substring match, denying `git rev-parse HEAD^{commit}` and friends.

75 tests, up from 69 — every fix has a test that fails when the fix is reverted.

## 1.0.2 — proper diagrams

### Changed

- README diagrams are now generated **SVG** (`npm run gen:diagrams`) rather than ASCII: rendered
  boxes, colour-coded outcomes, readable on light and dark. Served over absolute raw URLs so they
  display on npm and GitHub alike, with no external renderer and no dependency on npm's
  relative-link rewriting. 1.0.1 shipped the ASCII interim — this is the version worth looking at.

## 1.0.1 — npm presentation fixes

### Fixed

- **README diagrams rendered as raw code on npmjs.com.** npm does not execute mermaid, so five
  `flowchart` blocks displayed as literal text to anyone arriving via npm. Replaced with generated
  SVG (`npm run gen:diagrams`) served over absolute raw URLs, so they render on npm and GitHub
  alike — no external renderer, and no reliance on npm's relative-link rewriting.
- Package `description` and `keywords` were stale: missing the Codex runtime and still carrying the
  pre-rename framing. Added `homepage` and `bugs` links.
- The version assertion in the test suite pinned a literal string, which would have failed on every
  future release. It now checks semver shape plus a matching CHANGELOG entry.

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
