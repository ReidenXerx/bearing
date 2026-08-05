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
| **Microscope** | Milestone review that first **adopts the expert role your project implies** (trading repo → quant trader), then spawns lenses per slice — correctness *and* judgment — adversarially verified in waves. → *Catches code that runs perfectly and is still the wrong thing.* |
| **GitNexus** | Hard gates that redirect symbol greps to a real code knowledge graph and demand impact analysis before edits. → *The agent stops guessing at your architecture.* Requires the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server. |

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

Most review asks *"is this code correct?"* — a question a linter can ask. Microscope first **adopts the expert role your project implies**, then asks the question that actually costs you money: *is this the right thing to have built?*

In a trading repo it reviews as a **senior quant trader**. In a payments repo, as a **ledger engineer**. It infers the role from your README, `CLAUDE.md` and the code's own structure — or you pin it in `.bearing/domain.json`.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/microscope.svg" alt="Adopt the domain expert role, map the target, spawn Kind A correctness lenses and Kind B judgment lenses, verify against real logic, keep survivors." width="100%">

**Kind B is the part a linter can never do.** It asks *why does this exist?*, *is this the wrong abstraction?*, *is the complexity worth it?* — and the domain role is what makes it catch **semantic** wrongness: *"this fee is computed on gross, should be net"*, *"win-rate is not a profitability claim"*. Code that runs perfectly and is still wrong.

Lenses aren't a fixed checklist — they're spawned per meaningful slice of the target, important ones get both kinds, and findings that can't survive an adversarial pass never reach you.

### 🕸 GitNexus — the agent stops guessing

Grepping a symbol gives you 40 text matches and no structure. The graph knows what actually calls what.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/gitnexus.svg" alt="A grep is gated: a stale index or a drifted working tree blocks until re-indexed, otherwise it becomes a graph query returning callers, callees and flows." width="100%">

**Two gates, not one.** A stale index blocks until refreshed — and so does *working-tree drift*: edit a few source files and graph queries are held until you re-index, because the graph would otherwise answer about code you already changed.

Beyond redirecting greps, agents get the full surface: `cypher` for structural questions greps can't express, `impact` before edits, `detect_changes` before commits, graph-coordinated `rename`, and statement-level `pdg`/taint tracing.

#### When the graph is *wrong*

Enforcement that can't be escaped is a trap. If the index is fresh but the answer is suspect, the agent takes a bounded escape hatch — and **that becomes a bug report**:

```bash
bearing:fallback -- "impact returned 0 callers for OrderService but grep finds 3"
```

~15 minutes of classical tools, auto-resuming. The reason is logged with the graph state it distrusted (version, node/edge counts, indexed commit) into a durable report you can review with `bearing:fallback-log` — or export as JSON and send to the graph's maintainers.

*The tool keeps a record of its own failures instead of hiding them.*

The only module that can **block** a tool outright rather than advise. Requires the GitNexus MCP server and an index — the one prerequisite in the set.

## Requirements

- Node.js ≥ 22.9.0
- A git repository
- macOS, Linux, Windows, or WSL
- *(GitNexus module only)* the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server

## Commands

```bash
npx bearing install <repo> [--runtime ...] [--features ...]
npx bearing-update <repo>       # pull in a newer bearing, keep your selection
npx bearing-uninstall <repo>
```

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
