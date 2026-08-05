<div align="center">

# bearing

**An intel layer for AI coding agents.**

Cognitive routines that keep an agent anchored to what your project actually is — across long sessions, context compaction, and months of accumulated documentation.

[![Node](https://img.shields.io/badge/node-%3E%3D22.9.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

Works with **Claude Code**, **Cursor**, and **Zed**.

</div>

---

## The problem

Your tests catch code that breaks. Nothing catches an agent that has quietly drifted about what the code *means*.

It reads a stale doc and adopts a premise you abandoned months ago. It re-proposes a feature you already measured and rejected — because the refutation lives in a changelog it didn't read. Two hundred thousand tokens in, it's optimising for a goal you never set. Every answer stays fluent, confident, and subtly wrong, and the only way to catch it is to read the wall of text yourself.

That failure has a name — **losing your bearings** — and it compounds silently. `bearing` gives an agent fixed points it can't drift away from.

## What you get

Four independent modules. Pick any combination; each works alone.

| Module | What it does |
|---|---|
| **North-stars** | A short, numbered, authoritative statement of what your project *is* — invariants, exact term meanings, settled decisions, ideas already rejected and why. It **outranks every other doc**, and is re-injected periodically so a long session can't drift off it. |
| **Task-core** | A dense save-state of the *current task*. When the context window fills, the agent writes it **before** compaction drops the detail — and reads it back on recovery, instead of reconstructing from a summary. |
| **Microscope** | A milestone review routine: several independent lenses, adversarially verified, iterated in waves. Opinionated, not just defect-hunting. |
| **GitNexus** *(optional)* | Hard gates that redirect symbol greps and blind reads to a real code knowledge graph, keep the index fresh, and require impact analysis before edits. The deepest module — and the only one needing an external dependency. |

## Install

```bash
npx bearing
```

The interactive installer explains each module and lets you choose. Or be explicit:

```bash
npx bearing install . --runtime claude --features northstars,taskcore
npx bearing install /path/to/repo --runtime all --features all
```

`--runtime` — `claude` · `cursor` · `zed` · `all`
`--features` — `northstars` · `taskcore` · `microscope` · `gitnexus` · `all`

Then restart your IDE and open a new agent chat.

## How north-stars work

Write down what your project *is*, as numbered claims that a conclusion could actually violate:

```markdown
- **NS-1** — The backtest stop model MUST match the live order's stop model.
              If they differ the scoreboard is invalid.
- **NS-4** — Win-rate is NEVER a ranker. Only net expectancy is a profitability claim.
- **NS-9** — REJECTED: averaging into a losing position. Measured: adds fill only on the
              weaker cases (adverse selection). Don't re-propose without new evidence.
```

Vague guidance is useless here — *"be careful with risk"* can't be violated, so it can't catch anything. A north-star has to be falsifiable.

From then on the agent **cites them** (`per NS-4, ranking by win-rate is invalid here`), and when a doc contradicts one, **the north-star wins and the doc is stale**. If it can't cite one for a load-bearing claim, it says so — which is your signal that it may be drifting. It can propose changes, but never edit them silently: an anchor that drift can rewrite isn't an anchor.

> Built for a real codebase where 81 documents had come to contradict each other on live production parameters — including a `CLAUDE.md` that routed every agent to a design doc marked superseded.

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

## Documentation

[Quickstart](docs/QUICKSTART.md) · [Skills](docs/SKILLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Zed + local models](docs/ZED.md)

## License

ISC
