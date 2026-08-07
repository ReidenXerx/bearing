# Changelog

All notable changes to `bearing` are documented here.

## 1.0.7 — a domain expert on every review, and an installer that checks its own claims

The kit was renamed `gitnexus-agent-kit` → `bearing`, but three identifiers kept the old name
because renaming them touches files in *your* repository. Two were merely stale. One was a bug.

### Fixed

- **An intel-only install no longer creates `.gitnexus/`.** The install manifest lived at
  `.gitnexus/agent-kit-manifest.json`, and writing it created the graph tool's index directory in
  repos that had explicitly declined the GitNexus module — an index directory for an indexer that
  was never installed. NS-13 names four channels through which enforcement must not leak; this was
  a fifth. The manifest now lives at `.bearing/manifest.json`, and the four `gitnexus` entries in
  the managed `.gitignore` block are gated on the module too. `.bearing/.gitnexus-*` stays
  ungated: the **core** session-primer writes it, and `.gitnexus-northstar-counter.json` belongs
  to the north-stars module rather than the graph.
- **The managed `AGENTS.md` / `CLAUDE.md` block is `<!-- bearing:BEGIN -->`.** Matching only a new
  marker would have left the old block in place in every installed repo and appended a second one
  beside it — the exact failure `GITIGNORE_MARKERS_LEGACY` already documents. Both adapters now
  match the current marker or any legacy one, replace the first in place, and drop any duplicate.
- **The gitignore migration pointed at a command that does not exist.** It rewrote
  `(safe to remove via gn-kit uninstall)` into `(safe to remove via gn-agent-kit uninstall)` —
  one dead binary name for another. Both now collapse to `bearing-uninstall` (NS-6).
- Renamed the remaining user-visible strings: the `bearing verification` banner, the
  `bearing installed` health detail, and a sync script that told the user to run `gn-agent-kit`.

### Fixed — uninstall now leaves the repo as it found it

Six leaks, all pre-dating this release. After `install; update; uninstall` a repo was left holding
`.bearing/hooks.json`, an empty `.claude/` with a `{}` settings file, empty `.claude/skills/` and
`.agents/skills/` directories, and a `.gitignore` it never had. It now comes back byte-identical.

- **An update disowned the file the install created.** `.bearing/hooks.json` is seeded only when
  absent, because it is team-shared config the user edits — but skipping the copy also dropped it
  from the manifest's file list, so uninstall no longer knew the kit had put it there. It is now
  re-claimed on update, and *only* when a previous manifest says the kit wrote it: a hooks.json
  that existed before the first install was never ours and is still never touched.
- **`.claude/settings.json` was left as `{}`** once our hooks were stripped out. It now follows
  the rule `.mcp.json` in the same adapter already used — remove the file when what remains is
  empty, keep it when the user has anything else in it.
- **The skill link directories were never removed**, only their contents, and **`.claude/` was
  missing from uninstall's prune list** entirely. Both are rmdir-only, so a directory holding
  anything of the user's survives.
- **A `.gitignore` the kit created was left behind empty.** Whether the repo had one is now
  recorded in the manifest at install time, because by the second run the file exists *because we
  made it* — indistinguishable, after the fact, from the user's own (NS-1).
- **Uninstall stripped the final newline** from a `.gitignore` it was otherwise leaving alone,
  which was enough to show the file as modified in the user's diff.

### Added — the installer now checks its own claims

Every defect below was found by an agent inspecting a real install by hand. A person running
`npx bearing` would have been told about **none** of them — and three would have printed success
while broken. The existing verifier could not have caught a single one: it asks *does this file
exist*, and every failure had the right files in the right places with the wrong content.

`lib/postcheck.mjs` asserts post-conditions against the disk at the end of every install and
update. Each check exists because a real defect shipped through the gap it covers:

| check | the defect it would have caught |
| --- | --- |
| `scripts_binary` | all 16 npm scripts reverted to `npx gitnexus@latest` after step 7 |
| `mcp_entries` | setup overwrote `.cursor/mcp.json`; the Zed adapter hardcoded npx |
| `mcp_http_live` | the repo pointed at a port where the LaunchAgent had died on exit 127 |
| `local_state_ignored` | task-core, session flags and install backups became committable |
| `agent_docs` | a marker rename appended a second contract block |
| `no_legacy` | two manifests left side by side, free to disagree |
| `declined_clean` | `.gitnexus/` created in a repo that declined the graph module |
| `files_present` | a recorded file missing from disk |

Three deliberate properties:

- **Not behind `--skip-verify`.** That flag exists to skip the slow index build, and every
  automated path in this repo passes it — which is precisely how these reached a real machine.
  The checks read the disk we just wrote and cost milliseconds.
- **In `lib/`, not the bundle.** `scripts/bearing-verify.mjs` is owned by the gitnexus feature and
  so is its fallback, so an intel-only install had no verification at all. The configuration least
  exercised by the author was also the least checked.
- **A failure changes the headline and the exit code.** The summary reads "finished with N FAILED
  checks" rather than "complete", and the process exits non-zero. Environmental problems (a server
  that is not running) print a fix instead of asking for a bug report.

Recorded as NS-20 and NS-21. The negative-case test immediately earned its keep: the first draft
of `scripts_binary` compared with `String.includes`, and `"npx gitnexus@latest".includes("gitnexus")`
is true — a check that could never fail, which is the exact trap NS-9 describes.

### Fixed — `npx gitnexus@latest` came back after every install

1.0.6 added a recorded `gitnexusCmd` so a repo could pin the binary it runs. The manifest recorded
it correctly and `kit.mjs` wrote it correctly — and then **step 7 undid all of it**, because three
shipped components rebuilt their commands from the bare default. Found by installing into a real
repo and reading what actually landed: manifest said `gitnexus`, all 16 npm scripts said `@latest`.

- **`scripts/bearing-teaching/merge-package-scripts.mjs`** is run by `bearing-setup.sh` *after* the
  installer has written the scripts, and rebuilt every one of them from `npx gitnexus@latest`. The
  existing regression test passed `--no-setup`, so the fixture skipped exactly the step that broke
  it (NS-9). It now asks `.bearing/lib/gitnexus-cmd.mjs`, and so does `--snippet`.
- **`bearing-setup.sh` overwrote `.cursor/mcp.json`** with a hardcoded `npx -y gitnexus@latest mcp`
  stdio entry, reverting *both* recorded choices — a repo pointed at a shared http server went
  back to spawning one server per client, recreating the pile-up http exists to prevent. It now
  builds the entry from the new `mcpEntryFor()` resolver. Its own `GITNEXUS_CLI` was pinned the
  same way and now resolves too.
- **The Zed adapter never honoured either choice** — alone among the three, it hardcoded the npx
  entry. Because Zed project settings *win over user settings*, that committed entry superseded a
  correctly configured global one: observed on a real machine as Zed running `analyze` from
  `~/Library/Application Support/Zed/node/cache/_npx` against the same index a bearing refresh was
  writing. Zed now writes the resolved binary. It stays on stdio deliberately even for an http
  repo — Zed's remote-context-server shape is unverified, and guessing a schema in someone's real
  editor config risks a server that will not start at all, which is worse than one that works
  locally. The installer now says so in its next steps instead of leaving it to be discovered.
- **`.bearing/lib/detect-api-router.mjs`** spawned `npx gitnexus@latest cypher` directly, with
  `gitnexusSpawn` sitting unused beside it — so it queried the published analyzer's graph while
  everything else used the installed one.

### Fixed — the CLI silently did nothing through a symlink

`lib/kit.mjs` decided whether it was the entry point by comparing `import.meta.url` against
`process.argv[1]` unresolved. Any symlink on the way in made those differ, so the CLI fell through
and **exited 0 having done nothing**. On macOS this is the ordinary case, not an exotic one: `/tmp`
is a link to `/private/tmp`, so `node /tmp/checkout/lib/kit.mjs install …` looked like a
successful install that installed nothing. Both sides are now resolved with `realpath`.

### Fixed — the macOS shared MCP server never actually started

The launchd path shipped in 1.0.6 marked UNVERIFIED. Running it on a Mac showed the warning was
right, and in the predicted place.

- **The LaunchAgent exited 127 in a restart loop.** An absolute `ProgramArguments` path is not
  enough: gitnexus is an "env node" shebang script, and launchd starts with a minimal PATH that has
  no version-manager bin dir, so `env` could not find `node`. `servicePathEnv()` now puts the
  binary's own directory first — where nvm, volta, fnm and nodenv all keep the matching `node` —
  and the systemd unit had the identical latent bug.
- **`installService` reported `ok: true, "listening on 127.0.0.1:39100"` for that dead agent**,
  because it only checked that `launchctl bootstrap` had *loaded* the definition. Loading a
  service and running a server are different events. The caller's fallback-to-stdio path was
  therefore unreachable — it would have written an http entry pointing at nothing, which fails
  every graph call. It now confirms the port answers before claiming success.

Verified on macOS 27: agent runs, survives `kill -9` via KeepAlive, and is listening again ~1s
later. The Task Scheduler path remains unverified.

### Compatibility

- **Every manifest reader consults the old paths.** The manifest *is* an install's identity —
  `update`, `uninstall` and `update-all` discovery all key off it, so a reader that knew only the
  new path would report an installed repo as never installed and `update-all` would silently stop
  seeing every repo installed before this release. Install and update move the file and prune the
  emptied `.gitnexus/` (rmdir only, so a real index is never touched).
- **The `gitnexus:*` npm script aliases are unchanged** (NS-15), and so is the Zed `zed-gitnexus`
  profile — that one names the actual GitNexus MCP server, not the kit's old name.

### Added — a domain persona, resolved once and used everywhere

The headline claim — a trading repo reviewed by a quant trader, a payments repo by a ledger
engineer — was implemented in exactly ONE skill. `.bearing/domain.json` appeared in the README and
in `bearing-microscope` and nowhere else: nothing created it, nothing seeded it, and no other skill,
contract or session brief read it. Every review skill except microscope worked as a generic
engineer, and microscope re-inferred the domain on each wave, so wave 2 could adopt a different
persona than wave 1 while folding in wave 1's findings.

- **Resolved once at install**, written to `.bearing/domain.json`, and substituted into the
  always-on contract every runtime reads. Inference reads only what the repo says about ITSELF —
  package metadata, README, `CLAUDE.md` — and weights `package.json` above prose.
- **A near-miss is recorded as `suggestedDomain` rather than adopted.** A wrong specialism biases
  every downstream judgement; "senior engineer" biases nothing. Equal weighting classified bearing
  itself as a *trading* repo, purely because its README explains a feature using a trading example.
- **The file is yours.** Edit it and the contract follows; update never overwrites it.

### Changed — CI reports instead of gating

The merge gate failed PRs when a high-blast-radius symbol changed without tests, and that is the
wrong shape for this signal: the graph cannot distinguish "nothing calls this" from "I could not
resolve the callers", so a hard block on it fails honest PRs until people learn `[skip ci]`. It now
posts a sticky PR comment, a job summary and inline annotations — blast radius per changed symbol,
affected flows, security-sensitive paths, import cycles — and **never fails the build**.
`GITNEXUS_CI_MODE=block` is opt-in.

### Fixed — the placeholder check missed the placeholder it was written for

`checkPersonaResolved` looked only for `__BEARING_PERSONA__`. The bug it shipped alongside was
`__GITNEXUS_REPO__` reaching the Cursor rule verbatim, so the regression guard could not have caught
the regression — it covered the right FILES and the wrong TOKEN. Both are now read from the exported
constants, so substitution and verification share one source, and the failure names which token in
which file.

### Changed — the README and diagrams

- **3374 words to 1335.** The old page explained the product to someone already convinced. Hook,
  four modules and install now sit above the fold, one section per module led by its diagram, and
  the deep material stays in `docs/`.
- **The diagrams draw one claim each.** The microscope one had twelve boxes at 11px, which reads as
  "this is complicated" — and it *understated* the feature by drawing two lenses, when the skill
  spawns one lens agent per slice, in parallel where the runtime allows, each carrying the same
  pinned persona.
- Rasterising caught three defects invisible in the source: arrows missing a `y2` rendered
  `undefined`, sub-labels overlapped the card beneath them, and a backward connector routed straight
  through the boxes it was meant to pass under. The generator now **fails** on text that would
  overflow the canvas, since SVG clips silently.

## 1.0.6 — one MCP server for the whole machine, instead of one per client

MCP stdio spawns one child process **per client**, by protocol design. Every editor window and
every agent session therefore gets its own GitNexus server — seven were observed on one machine,
all watching the same index, all auto-refreshing when HEAD moved, and all queueing behind a single
index lock with a 600 s timeout. That contention blocked real work.

GitNexus already ships the fix: `gitnexus mcp --http` (v1.6.9) is one long-running server that
resolves repositories per request, so a single process serves every repo on the machine.

### Added

- **The installer asks how the MCP server should run**, rather than deciding for you. The http
  option installs a background service on your machine, and that is not something to arrange
  behind your back. Only asked when the GitNexus module is actually selected.
- **The choice is recorded and re-applied on every update.** bearing still always writes the MCP
  entry — that is what keeps it predictable — but it writes what you chose instead of a hardcoded
  default. Non-interactive: `--mcp http|stdio|<port>|<url>`, or `BEARING_MCP`.
- **Optional service setup**: a systemd user unit on Linux, a LaunchAgent on macOS, a scheduled
  task on Windows. No root anywhere, loopback only, and the removal command is printed with it.

### Fixed

- **`bearing update` silently reverted a hand-configured MCP entry.** A repo deliberately pointed
  at a shared server, or at a locally built gitnexus, had that overwritten with
  `npx gitnexus@latest` at the next update — undoing a whole daemon setup without a word and
  recreating the pile-up it was installed to fix.
- **The README documented two commands that 404.** `npx bearing-update <repo>` makes npx resolve a
  *package* by that name, which does not exist. The subcommand form (`npx bearing update <repo>`)
  is the one that works through npx.

### Known limitations

- Only the **systemd** path has been executed. The launchd and Task Scheduler paths are written
  from documented behaviour and are **untested** — the file says so, a successful install on those
  platforms says so, and the manual `gitnexus mcp --http` command is printed either way. The rule
  that broke the first systemd draft (these supervisors do not inherit your shell's PATH, so the
  binary must be named absolutely) is applied and tested on all three.
- Task Scheduler has no equivalent of `Restart=on-failure`, so on Windows the server stays down
  until next logon if it dies mid-session.
- A service definition bearing did not write is never touched, and a failed service install falls
  back to stdio rather than leaving you with a config pointing at a dead port.

## 1.0.5 — the compound-command notice was silent on the shape it exists for

1.0.4 added a notice telling the agent that a blocked shell command was blocked WHOLE, so
`python3 edit.py && grep ...` could not be read as "the edit landed, only the grep was blocked".
It fired on `&&`, `||` and `;`.

**The incident it was written for has none of those.** It was a heredoc followed by a search on
the next line — a `python3` heredoc that rewrote several call sites, then a `grep` beneath it.
Bash rejects the whole line, so the rewrites never ran, and the notice stayed silent because a
newline is not an operator. A newline separates steps exactly as `;` does. It now counts, so the
notice covers the shape that actually costs silent edits.

Backslash line-continuations are excluded — `foo \` then `--bar` is one step, and warning there
would report lost work when none was. That exclusion also handles CRLF, where the byte before the
newline is the carriage return rather than the backslash; without it the exclusion failed silently
on Windows.

Over-warning is the deliberate direction: the notice fires only on a **deny**, where "nothing ran"
is true by construction. A missing notice costs silently-lost work; a redundant one costs a line.

### Added

- `lib/classify.test.mjs` — behavioural coverage for the shipped guard core, which previously had
  none. Pins the compound-notice shapes and the scoped-grep allow *with its paired deny*, since an
  allow with no paired deny widens silently into "greps are fine".

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
