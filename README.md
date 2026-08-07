<div align="center">

# bearing

**An intel layer for AI coding agents.**

Cognitive routines that keep an agent anchored to what your project actually is — across long sessions, context compaction, and months of accumulated documentation.

[![Node](https://img.shields.io/badge/node-%3E%3D22.9.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

Works with **Claude Code**, **Cursor**, **Zed**, and **Codex**.

</div>

---

## The problem

Your tests catch code that breaks. **Nothing catches an agent that has drifted about what the code *means*.**

It reads a doc you abandoned in March. It re-proposes the feature you already measured and killed — because the refutation lives in a changelog it never opened. Two hundred thousand tokens in, it's optimising for a goal you never set.

Every answer stays fluent. Confident. Subtly wrong.

**And it never fails loudly.** A drifted agent doesn't crash — it writes a convincing paragraph, you nod, and you find out three days later that the premise was dead on arrival.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/drift.svg" alt="Without bearing: a stale doc becomes a dead premise, every later conclusion inherits it, discovered days later. With bearing: it contradicts NS-4, the north-star wins, caught in one line." width="100%">

That failure has a name — **losing your bearings**. `bearing` gives an agent fixed points it can't drift away from, and makes the drift *visible in one line* when it happens.

## What you get

Four independent modules. **Pick any combination — each works alone, none depends on another.**

| Module | What it does |
|---|---|
| **North-stars** | Numbered, authoritative claims about what your project *is* — invariants, exact term meanings, settled decisions, ideas already rejected and why. **Outranks every other doc**, re-injected as the session runs. → *No more re-litigating decisions you made months ago.* |
| **Task-core** | A dense save-state of the *current task*, written **before** compaction drops the detail and read back on recovery. → *A four-hour task doesn't forget its own goal at hour three.* |
| **Microscope** | Milestone review that spawns a lens **per slice of your change** — correctness *and* judgment — then tries to **refute its own findings** and only reports what survives, iterating in waves. → *Catches code that runs perfectly and is still the wrong thing.* |
| **GitNexus** | Hard gates that redirect symbol greps to a real code knowledge graph and demand impact analysis before edits. → *The agent stops guessing at your architecture.* Requires the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server. |

Plus a **domain persona**, resolved once at install and written into the always-on contract every
runtime reads: a payments repo is reviewed by a ledger engineer, a trading repo by a quant trader.
Not a review-time flag — the expertise is held for *every* task, because "this fee is computed on
gross, should be net" is not a language error and a generic reviewer will never see it.

### What actually makes this different

Every agent tool tells you it will make your agent better. Here is the specific bet this one makes:

**It assumes its own rules are wrong, and keeps the receipts.** The agent files bug reports against
its own tooling. The gates measure whether they are earning their keep. The installer verifies its
own claims and fails when they do not hold. Nothing else in this space is built to be *falsified by
its own telemetry* — and that is the entire reason it can be trusted with a hard block.

- **The agent files the bug reports.** When it doesn't believe a graph answer, it says why — captured with the graph state that produced it, exportable as JSON. → [details](#the-tool-tells-you-when-its-the-problem)
- **The installer checks its own claims.** Eight post-conditions run on every install and update, outside `--skip-verify`. They exist because nine defects once shipped while the installer printed success — a service reported "listening" while crash-looping, a CLI exited 0 having installed nothing. *Presence is not correctness.*
- **The CI report refuses to block.** The graph cannot distinguish "no callers" from "could not resolve callers", so a gate built on it would fail honest PRs. It reports and lets you judge. → [details](#-ci-a-review-report-not-a-gate)
- **A zero is never a finding.** The contract tells the agent, in as many words, that an empty graph result is *unknown*, not *none* — and the kit warns the moment an `impact` verdict grades LOW off callers it never resolved.

## Install

```bash
npx bearing
```

The interactive installer explains each module and lets you choose. Or be explicit:

```bash
npx bearing install . --runtime claude --features northstars,taskcore
npx bearing install /path/to/repo --runtime all --features all
```

`--runtime` — `claude` · `cursor` · `zed` · `codex` · `all`
`--features` — `northstars` · `taskcore` · `microscope` · `gitnexus` · `all`

Then restart your IDE and open a new agent chat.

### Module support by runtime

Enforcement needs tool-interception hooks, and only some runtimes expose them. Everything still *works* everywhere — the difference is whether a rule is **enforced** or merely **instructed**.

| | Claude Code | Cursor | Zed | Codex |
|---|:---:|:---:|:---:|:---:|
| **North-stars** — loaded as authority | ✅ | ✅ | ✅ | ✅ |
| **North-stars** — re-anchored mid-session | ✅ | — | — | — |
| **Task-core** — survives compaction | ✅ | — | — | — |
| **Microscope** — deep review routine | ✅ | ✅ | ✅ | — |
| **GitNexus** — graph contract | ✅ | ✅ | ✅ | ✅ |
| **GitNexus** — hard gates (grep redirected) | ✅ | ✅ | — | — |

**Claude Code gets everything.** Elsewhere the north-stars are read at session start but not continuously reinforced — and that re-injection is what stops an anchor decaying across a long session.

## How each module works

### ⚑ North-stars — one source of truth that outranks the rest

Docs rot. Comments lie. An agent's own inference fills the gaps. North-stars are the **fixed point** that settles every conflict — and the agent has to *cite* them.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/northstars.svg" alt="Docs, README, code comments and the agent's own guess all feed a conflict; the north-star wins and the other source is declared stale." width="100%">

Write them as numbered claims a conclusion could actually **violate**:

```markdown
- **NS-1** — The backtest stop model MUST match the live order's stop model.
              If they differ the scoreboard is invalid.
- **NS-4** — Win-rate is NEVER a ranker. Only net expectancy is a profitability claim.
- **NS-9** — REJECTED: averaging into a losing position. Measured: adds fill only on the
              weaker cases (adverse selection). Don't re-propose without new evidence.
```

*"Be careful with risk"* can't be violated, so it can't catch anything. **Falsifiable or it's decoration.**

If the agent can't cite one for a load-bearing claim, it says so — that's your drift alarm. It can propose changes, but **never edit them silently**: an anchor that drift can rewrite isn't an anchor.

Two details that matter more than they sound:

- **The graveyard stops ideas respawning.** A rejection carries *why it failed*, so an agent can't re-propose it six months later — and can't quietly discard something already validated either.
- **Re-anchoring fires on two triggers**: every N tool calls, *and* immediately after the agent writes a doc — the moment a drifted premise gets written down and becomes "settled".

**Three kinds of memory, and they are not interchangeable:**

| | authored by | scope | lifetime |
|---|---|---|---|
| **North-stars** | **you** | the whole project | permanent, committed, authoritative |
| **Task-core** | the agent | the current task | until the task changes |
| `MEMORY.md` | the agent | running notes | across sessions |

Only the north-stars outrank anything. The other two are the agent's working memory — useful, but never a source of truth.

> Built for a real codebase where 81 documents had come to contradict each other on live production parameters — including a `CLAUDE.md` that routed every agent to a design doc marked superseded.

### 💾 Task-core — the task survives the summary

Long sessions get **compacted**: the transcript is summarized and thrown away. Detail dies there — the goal, the decisions, the thing you told it *not* to do at hour one.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/taskcore.svg" alt="Session starts, context fills, at ~90% the agent writes the task-core before compaction, then reads it back with goal and decisions intact." width="100%">

Written **before** the summary lands, not after — by then the detail is already gone. The pressure trigger reads the *actual* token usage from the transcript rather than guessing.

It stores what a summary reliably loses: `GOAL · CONSTRAINTS · DECISIONS(+why) · STATE(done/now/next) · ANCHORS(file:line) · GOTCHAS · OPEN-Qs`. **GOTCHAS is the underrated one** — the approaches you already tried that failed, so the agent doesn't cheerfully re-attempt them after the reset.

### 🔬 Microscope — reviewed by an expert in *your* domain, not a linter

Most review asks *"is this code correct?"* — a question a linter can ask. Microscope asks the one that actually costs you money: *is this the right thing to have built?*

**It is not a checklist.** It maps your change into slices — flows, layers, seams — and spawns **one lens per slice**, tagged by kind. Important slices get both kinds. Then every finding has to survive a deliberate attempt to **refute** it before you ever see it, and the whole pass repeats in numbered **waves** until clean.

The reviewer is a **domain expert**, resolved at install and pinned in `.bearing/domain.json`: a trading repo gets a senior quant trader, a payments repo a ledger engineer. Inference reads what your repo says about *itself* and weights `package.json` above prose — and when the signals are weak it stays a plain senior engineer and tells you what it suspected, because a confidently wrong specialism skews every judgment downstream. It's yours to edit; bearing never overwrites it.

**It does not need the graph.** With GitNexus installed the map comes from clusters, flows and `impact`. Without it, the same routine runs on a classically-built map — changed files as layers, imports as seams, entry points as flows — and says which path it took, because the map's completeness bounds what the pass can claim to have covered.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/microscope.svg" alt="Adopt the domain expert role, map the target, spawn Kind A correctness lenses and Kind B judgment lenses, verify against real logic, keep survivors." width="100%">

**Kind B is the part a linter can never do.** It asks *why does this exist?*, *is this the wrong abstraction?*, *is the complexity worth it?* — and the domain role is what makes it catch **semantic** wrongness: *"this fee is computed on gross, should be net"*, *"win-rate is not a profitability claim"*. Code that runs perfectly and is still wrong.

Lenses aren't a fixed checklist — they're spawned per meaningful slice of the target, important ones get both kinds, and findings that can't survive an adversarial pass never reach you.

### 🕸 GitNexus — the agent stops guessing

Grepping a symbol gives you 40 text matches and no structure. The graph knows what actually calls what.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/gitnexus.svg" alt="A grep is gated: a stale index or a drifted working tree blocks until re-indexed, otherwise it becomes a graph query returning callers, callees and flows." width="100%">

**Two gates, not one.** A stale index blocks until refreshed — and so does *working-tree drift*: edit a few source files and graph queries are held until you re-index, because the graph would otherwise answer about code you already changed.

Beyond redirecting greps, agents get the full surface: `cypher` for structural questions greps can't express, `impact` before edits, `detect_changes` before commits, graph-coordinated `rename`, and statement-level `pdg`/taint tracing.

#### When the graph is *wrong*

A code graph's coverage limits are fine. **Presenting a coverage limit as a factual negative is not** — and that's the failure this module is built to survive.

`impact` and `context` can return *zero callers* for a function wired to a live HTTP route, because calls through factory-returned objects and destructured DI bindings don't always resolve. A confident zero is worse than no answer: it looks like knowledge, so the agent concludes "dead code, safe to change" and is wrong exactly where it was deciding whether a change was safe.

So the contract is asymmetric, and the agent is told so in as many words:

> **A positive result is strong evidence — what it found is really there. A zero is not a finding.** Never conclude "dead code", "no callers" or "safe to delete" from an empty graph result alone; confirm it classically and say which check you ran.

**Three things enforce that instead of hoping:**

**1. Unreliable `impact` verdicts get flagged, not trusted.** `impact` is the pre-edit safety gate. When it grades a change `risk: LOW` but resolved *no* callers — or only test files — the kit says so the moment the result lands, before the edit:

> ⚠ **IMPACT VERDICT IS UNRELIABLE** — it resolved NO callers and graded the change `risk: LOW`. Treat this as **UNKNOWN blast radius, not LOW** … confirm the caller set classically and say which check you ran.

It warns rather than blocks — re-running `impact` returns the same empty answer, so a block would be a trap.

**2. Distrust becomes a bug report.** If the index is fresh but the answer is suspect, the agent takes a bounded escape hatch:

```bash
bearing:fallback -- "impact returned 0 callers for OrderService but grep finds 3"
```

~15 minutes of classical tools, auto-resuming. The reason is logged with the graph state it distrusted (version, node/edge counts, indexed commit) into a durable report — review it with `bearing:fallback-log`, or export JSON and send it to the graph's maintainers. One real project accumulated 93 reports across 47 indexed commits; that corpus is what the rules above are calibrated against.

**3. The kit audits its own enforcement.** Gates that fire more than they help are worth knowing about, so `bearing:scorecard` and the session brief say it outright:

> ⚠ Enforcement is 49% of graph interaction: 57 redirects vs 60 graph calls.

…along with the two readings — gates misfiring on questions the graph can't answer, or gates correctly catching an agent that keeps reaching for grep — and which evidence tells them apart.

The only module that can **block** a tool outright rather than advise. Requires the GitNexus MCP server and an index — the one prerequisite in the set.

#### One server for the machine, not one per window

MCP stdio spawns a server **per client** by protocol design, so every editor window and agent session gets its own — seven were observed on one machine, all watching the same index, all auto-refreshing when HEAD moved, and all queueing behind a single index lock. The installer can point every runtime at one shared HTTP server instead, and optionally supervise it (systemd user unit · LaunchAgent · scheduled task — no root anywhere, loopback only).

It confirms the port actually answers before writing that config, because a repo aimed at a dead port fails *every* graph call — worse than the contention it replaces.

### 🤖 CI: a review report, not a gate

A pull-request comment — updated in place, not piled up — with blast radius per changed symbol, the execution flows your change touches, security-sensitive paths, and structural regressions like new import cycles. It also lands in the job summary and as inline annotations.

**It never fails your build,** and that is deliberate rather than timid. The graph cannot distinguish *"nothing calls this"* from *"I could not resolve the callers"*, so a hard gate on that signal blocks honest PRs until people learn to route around it. A report a human reads beats a gate they disable. If you want teeth, `GITNEXUS_CI_MODE=block` is one line away.

## The tool tells you when it's the problem

Every enforcement tool believes its own rules are correct. This one assumes they might not be, and keeps the evidence.

**The agent files the bug reports.** When an agent doesn't believe a graph answer, it doesn't silently work around it — it says why, and that becomes a record:

```bash
npm run bearing:fallback -- "impact returned 0 callers for OrderService but grep finds 3"
```

The reason is captured **with the graph state it distrusted** — tool version, node/edge/embedding counts, the indexed commit and when it was built. Not "the graph was wrong once", but *this query, on this index, at this commit*. It survives session clears, because a failure report is a record, not session state.

```bash
npm run bearing:fallback-log --json    # the whole corpus, ready to send upstream
```

One real project accumulated **93 reports across 47 indexed commits in three weeks**. Read together they stopped being complaints and became a diagnosis: 30 were empty results for things that demonstrably existed, ~24 were refresh failures. That corpus is what the graph-zero rules above are calibrated against — and it's exactly the artifact a graph maintainer can act on, because every entry carries the state that produced it.

**The gates are measured too.** `bearing:scorecard` and the session brief report whether enforcement is earning its keep:

> ⚠ Enforcement is 49% of graph interaction: 57 redirects vs 60 graph calls.

…and refuse to draw the conclusion for you. That number reads two ways — gates misfiring on questions the graph can't answer, or gates correctly catching an agent that keeps reaching for grep first — so it names the evidence that tells them apart (a fallback log full of the same complaint means the first; an empty one means the second) and only recommends downgrading to `mode: guide` for the first.

**Nothing here is opt-in.** The telemetry accrues while you work and nothing leaves the repo:

| | |
|---|---|
| `bearing:fallback-log` | where the graph let an agent down — exportable JSON |
| `bearing:scorecard` | this session's gates, redirects, refreshes, fallbacks — with a diagnosis |
| `bearing:stats` | the same across sessions, so one bad afternoon isn't mistaken for a trend |

*A tool that can block your work should be able to show you when it was wrong to.*

**And the installer holds itself to it too.** Eight post-conditions run at the end of every install
and update — deliberately *not* behind `--skip-verify`, because every automated path passes that
flag and that is exactly how things slip through. They check that the recorded gitnexus binary is
what the generated scripts actually call, that every MCP entry matches the transport you chose,
that a shared server really answers, that machine-local state (your in-flight task-core, install
backups) can't be committed, that a declined module left no trace, and that nothing an installed
file tells you to run is missing.

A failure changes the headline and the exit code. It will not print "Install complete" over a
warning — the whole point is that presence is not correctness:

```
! 1 post-install check FAILED — this install is not what it claims:
!   ✗ shared MCP server answers: nothing answering at http://127.0.0.1:39100/mcp
!       fix: start it with `gitnexus mcp --http --port 39100`, or re-run with --mcp stdio
  Install finished with 1 FAILED check
```

## Requirements

- Node.js ≥ 22.9.0
- A git repository
- macOS, Linux, Windows, or WSL
- *(GitNexus module only)* the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server

## Commands

```bash
npx bearing install <repo> [--runtime ...] [--features ...]
npx bearing update <repo>       # pull in a newer bearing, keep your module selection
npx bearing uninstall <repo>
```

The package also installs `bearing-update` and `bearing-uninstall` as commands, which work once it is a dependency. Through `npx` use the subcommand form above — `npx bearing-update` makes npx look for a *package* by that name and 404s.

After install, the repo gets its own scripts — the ones worth knowing:

```bash
npm run bearing:northstars      # print your project's fixed points
npm run bearing:health          # is everything wired and fresh?
npm run bearing:refresh         # re-index after changes
npm run bearing:fallback-log    # where the graph let an agent down (exportable as JSON)
npm run bearing:stats           # session telemetry — gates hit, refreshes, fallbacks
npm run bearing:pr-impact       # branch-aware review playbook
npm run bearing:verify          # full audit of the install
```

## Documentation

[Quickstart](docs/QUICKSTART.md) · [Skills](docs/SKILLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Zed + local models](docs/ZED.md)

## License

ISC
