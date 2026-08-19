<div align="center">

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/bearing-mark.svg" alt="bearing — compass mark" width="72">

# bearing

**An intel layer for AI coding agents.**

Your tests catch code that breaks. Nothing catches an agent that has drifted about what the code *means*.

[![npm](https://img.shields.io/npm/v/bearing?color=3987e5)](https://www.npmjs.com/package/bearing)
[![npm downloads](https://img.shields.io/npm/dt/bearing?color=3987e5)](https://www.npmjs.com/package/bearing)
[![Node](https://img.shields.io/badge/node-%3E%3D22.9.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ReidenXerx/bearing?color=3987e5)](https://github.com/ReidenXerx/bearing)

**Claude Code** · **Cursor** · **Zed** · **Codex**

```bash
npx bearing
```

</div>

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/drift.svg" alt="Without bearing a stale premise is found three days later; with it the north-star outranks the doc and it is caught in one line." width="100%">

A drifted agent doesn't crash. It reads a doc you abandoned in March, re-proposes the feature you already measured and killed, and writes a convincing paragraph about it. You nod. You find out three days later.

That failure has a name — **losing your bearings**.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/social/bearing.gif" alt="Terminal recording: without bearing an agent ships a feature that was measured and killed, found out three days later; with bearing the same intent is caught against NS-9 in one line." width="100%">

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/social/receipts.png" alt="The receipts: 81 docs contradicting each other on live production parameters; 93 bug reports against its own tooling across 47 commits in three weeks; 30 empty results for things that demonstrably existed." width="100%">

**Contributing to a repo that isn't yours?** `npx bearing install . --stealth` keeps `git status` clean — no tracked file is touched. Details under [Install](#install).

## What you get

**Six independent modules. Pick any combination — each works alone, none depends on another.**

| | |
|---|---|
| ⚑ **North-stars** | **Stops killed ideas respawning six months later.** Numbered, authoritative claims about what your project *is* — **outranks every other doc**, re-injected as the session runs. |
| 💾 **Task-core** | **Survives compaction.** A dense save-state of the current task, written **before** the summary lands and drops the detail. |
| 🔬 **Microscope** | **Catches code that runs perfectly and is still wrong.** A panel of lens agents reviews as an expert in *your* domain — each finding must survive its own refutation pass. |
| 🙋 **Consult** | **Asks about the right things, decides the rest.** Asks you only what isn't in the repo — which reading you meant, what a user should see — and decides everything else. Confirms before anything irreversible. |
| 🐜 **Minions** | **Parallelises wide mechanical work.** Cheap anchored subagents return **citations, not opinions** — they gather; your agent concludes. |
| 🕸 **GitNexus** | **Turns 40 text matches into a real code graph.** Hard gates redirect symbol greps to callers and flows. Requires the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server. |

**And one thing that isn't a module:** the agent files bug reports against its own tooling, and the kit will tell you when *its own gates* are the problem. → [the receipts](#it-tells-you-when-its-the-problem)

## Install

```bash
npx bearing                                    # interactive — explains each module
npx bearing install . --runtime claude --features northstars,taskcore
```

`--runtime` `claude` · `cursor` · `zed` · `codex` · `all`  ·  `--features` `northstars` · `taskcore` · `microscope` · `consult` · `minions` · `gitnexus` · `all`

Then restart your IDE. Enforcement needs tool-interception hooks, and only some runtimes expose them:

| | Claude Code | Cursor | Zed | Codex |
|---|:---:|:---:|:---:|:---:|
| North-stars — loaded as authority | ✅ | ✅ | ✅ | ✅ |
| North-stars — re-anchored mid-session | ✅ | — | — | — |
| Task-core — survives compaction | ✅ | — | — | — |
| Microscope — domain-expert review | ✅ | ✅ | ✅ | — |
| Consult — ask vs decide | ✅ | ✅ | ✅ | — |
| Minions — anchored fan-out | ✅ | — | — | — |
| GitNexus — hard gates | ✅ | ✅ | — | — |

### 🥷 Stealth — for repos that aren't yours to change

```bash
npx bearing install . --stealth
```

A normal install is a team decision: it commits hooks, skills, a contract and npm scripts, and
everyone who pulls gets them. That's right for a repo you own and wrong for one you contribute to.

Stealth makes one promise, and it's testable: **`git status` is exactly as clean after the install
as it was before.** No tracked file is modified — not `.gitignore`, not `package.json`, not
`CLAUDE.md`. Ignores go in `.git/info/exclude`, which is per-clone and itself untracked, so the
rules can't travel. The contract is delivered by the session hook instead of a file.

Where a runtime has no per-user channel, bearing says so instead of writing the file anyway. It also
**refuses** to convert a repo where bearing is already committed — un-tracking it for your whole team
is a deliberate, visible act, not something an install flag should do behind your back.

Two things to know: the exclusions live in the clone, so a re-clone doesn't carry the install — run
it again. And uninstall empties only the block it wrote.

---

## ⚑ North-stars

**Docs rot. Comments lie. The agent's own inference fills the gaps.**

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/northstars.svg" alt="Docs, README, comments and the agent's own guess conflict; the numbered north-star wins and the others are declared stale." width="100%">

Write them as claims a conclusion could actually **violate**:

```markdown
- **NS-4** — Win-rate is NEVER a ranker. Only net expectancy is a profitability claim.
- **NS-9** — REJECTED: averaging into a losing position. Measured: adds fill only on the
             weaker cases. Don't re-propose without new evidence.
```

*"Be careful with risk"* can't be violated, so it can't catch anything. **Falsifiable or it's decoration.**

The graveyard stops ideas respawning six months later. If the agent can't cite a north-star for a load-bearing claim, it says so — that's your drift alarm.

> Built for a codebase where 81 documents had come to contradict each other on live production parameters.

### 🥇 Gold practices — the half that isn't yours

North-stars say what *your project* is. `.bearing/gold-practices.md` ships with bearing and says how
the work is done **anywhere** — numbered `GP-#`, cited the same way, and **outranked by your `NS-#`**
whenever they disagree.

**Every rule has a scar, and a rule without one is not in the file.** Nothing about writing tests or
naming things — you already do that. These are the mistakes that got made *anyway*, by a careful
agent, on this codebase:

> **GP-3 — Test at the seam the bug lives at.** A unit test that passes an argument the real pipeline
> never produces is green and dead. *Scar: a context-window fix tested as `resolve(300_000, undefined)`
> while the shipped config always passed a number — so the fix could not run, and did not, for two
> releases.*

Nineteen of them, and two computed guards keep the list honest: every rule must carry a scar, and
every `GP-#` cited anywhere must still exist. The second caught a dangling citation within minutes of
being written.

---

## 💾 Task-core

**Long sessions get compacted. The transcript is summarized and thrown away.**

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/taskcore.svg" alt="Once enough edits have accumulated the task-core is written, so when compaction drops the transcript the goal is read back intact." width="100%">

Written *before* the summary lands — by then the detail is already gone. The trigger is **how much work is unsaved** (edits since the last write), not a context percentage: the window isn't knowable at runtime, and what makes a compaction expensive is unwritten decisions, not fullness.

It stores what a summary reliably loses: `GOAL · CONSTRAINTS · DECISIONS(+why) · STATE · ANCHORS(file:line) · GOTCHAS`. **GOTCHAS is the underrated one** — the approaches you already tried that failed, so the agent doesn't cheerfully re-attempt them.

## 🔬 Microscope

**Most review asks "is this code correct?" — a question a linter can ask.**

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/microscope.svg" alt="A change is split into slices and one lens agent is spawned per slice, all carrying the same pinned domain persona, asking correctness and judgment questions in parallel; every finding must survive an adversarial refutation attempt before it reaches you." width="100%">

It maps your change into slices and spawns **one lens agent per slice** — in parallel where your runtime supports it — each carrying the **same pinned persona**, resolved from your repo at install and stored in `.bearing/domain.json`. A trading repo is reviewed by a quant trader; a payments repo by a ledger engineer. Pinned, so wave 2 can't quietly become a different expert than wave 1.

**Kind B is the part a linter can never do.** It asks *why does this exist?*, *is this the wrong abstraction?* — and catches semantic wrongness: *"this fee is computed on gross, should be net."* Code that runs perfectly and is still wrong.

Then every finding has to survive an adversarial pass that tries to **refute** it. What can't be defended never reaches you.

## 🙋 Consult

**Agents interrupt you for the wrong things, and go quiet for the wrong things.**

Permission to rename a file; silence while they invent a business rule. Consult is the judgment that separates the two, for a senior engineer who does not want to be asked about naming.

**The test that does most of the work: is the answer discoverable in the repo?** Code, tests, config, git history, north-stars — then it goes and finds it, because asking is offloading. If it exists only in *your* head — which of two readings you meant, which tradeoff you prefer, what a user should actually see — no amount of reading produces it. **That** is the question.

And when it does ask: closed options, the tradeoff, a recommendation, and what it will do without an answer. Never *"shall I proceed?"* — that is not a question, it is accountability being handed back to you.

**One-way doors are a different act.** Deleting data, force-pushing, publishing, migrating — it *confirms*, even when the right answer is obvious, because irreversible is the reason, not ambiguity. Reversible work needs no permission.

Then the part that compounds: **an answer that is a RULE gets proposed as a north-star.** Not every answer — a rule constrains future work, an instance doesn't. Ask once, write it down, never ask again.

## 🐜 Minions

**Your agent can already spawn subagents. It doesn't know when it should.**

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/minions.svg" alt="Forty files checked serially by one agent, versus forty cheap subagents each carrying the project's north-stars and persona; they return citations — FOUND file:line, CHECKED, MISSED — and the main agent draws the conclusion itself." width="100%">

So it grinds through forty files serially — or samples five and generalises. Minions is that missing judgment: fan out when the work is **bounded, verifiable, independent and wide** (3+ units), and *don't* when the judgment itself is the work.

Each subagent carries the same north-stars and pinned persona, and returns evidence in a fixed shape:

```
FOUND    src/fees.ts:88 — const fee = gross * RATE
CHECKED  rg "\* RATE" src/ --type ts
MISSED   dynamic dispatch in src/plugins/ — could not resolve
```

**Minions gather. Your agent concludes — they do minimal or zero reasoning.** A subagent that returns a *verdict* puts a cheaper model's summary between the evidence and your decision, which is the drift this whole tool exists to prevent.

That `CHECKED`/`FOUND` split is load-bearing: `CHECKED` filled and `FOUND` empty means *it looked and there was nothing*. Both empty means *it never understood the task*. In prose those are the same sentence.

## 🕸 GitNexus

**Grepping a symbol gives 40 text matches and no structure.**

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/gitnexus.svg" alt="A grep returns 40 unstructured text matches; the graph returns the actual callers and flows — and a zero result is treated as unknown, not as absence." width="100%">

Two gates: a **stale index** blocks until refreshed, and so does **working-tree drift** — edit files and queries hold until you re-index, because the graph would otherwise answer about code you already changed.

**A coverage limit presented as a fact is the failure this is built to survive.** `impact` can return zero callers for a function wired to a live route, because calls through factories and DI seams don't always resolve. So the contract is asymmetric, and the agent is told so:

> **A positive result is strong evidence. A zero is not a finding.** Never conclude "dead code" from an empty graph result — confirm it classically and say which check you ran.

When `impact` grades a change `risk: LOW` but resolved *no* callers, the kit says so before you edit. It warns rather than blocks — re-running returns the same empty answer.

## 🤖 CI

A sticky PR comment, not a merge gate: blast radius per changed symbol, affected flows, security-sensitive paths, import cycles. It **never fails your build** — the graph can't distinguish "nothing calls this" from "I couldn't resolve the callers", and a hard block on that fails honest PRs. `GITNEXUS_CI_MODE=block` is opt-in.

## 🧮 What it costs your context

The honest number, measured rather than guessed.

**Fixed, every session:**

| | tokens |
| --- | --- |
| bearing's contract block (`CLAUDE.md` / `AGENTS.md`) | ~10,300 |
| GitNexus MCP tool schemas (17 tools) | ~14,900 |
| **total** | **~25,200** |

That is **~13% of a 200k window, ~2.5% of a 1M one.** Skills are loaded on demand, not up front —
a session typically pulls one or two, at ~1,500 tokens each.

The second row is not bearing's — those are the graph tool definitions, present whenever the MCP
server is connected, with or without this package. And bearing's own share scales with what you
install:

```
all modules            ~10,300 tokens
intel only (no graph)   ~2,400
north-stars + task-core ~1,600
```

**What it buys back.** One `what breaks if I change this?` costs a few hundred to a few thousand
tokens through the graph, against grepping and then reading what grep points at:

```
                         graph   grep+read   ratio
  lead-sniffer   (234 files)     10,505    199,737    19x
  Sourcerer-Be   (709 files)      7,534    945,338   125x
```

On both, the fixed cost is repaid inside the first two questions.

**Do not take my repos for it — measure yours:**

```bash
npm run bearing:token-benchmark          # or: -- --targets 12 --json
```

It picks your most-called symbols, runs the real `impact` against them, and compares that with
`git grep` plus a 40-line window around every hit — which is what answering by hand actually costs.
It reports losses too: on lead-sniffer the graph lost one of eight, and said so. A symbol with three
callers is cheaper to grep, and a benchmark that never says that is advertising.

<sub>Token figures are estimated at 3.7 chars/token — a calibration constant, not a tokenizer. Assume ±10%.</sub>

## It tells you when it's the problem

Every enforcement tool believes its own rules are correct. This one assumes they might not be, and keeps the evidence.

```bash
npm run bearing:fallback -- "impact returned 0 callers for OrderService but grep finds 3"
```

The reason is captured **with the graph state that produced it** — version, node/edge counts, indexed commit. Not "the graph was wrong once", but *this query, on this index, at this commit*.

One real project accumulated **93 reports across 47 commits in three weeks**. Read together they stopped being complaints and became a diagnosis: 30 were empty results for things that demonstrably existed. That corpus is what the rules above are calibrated against.

The gates get measured too — `bearing:scorecard` reports whether enforcement is earning its keep, and refuses to draw the conclusion for you:

> ⚠ Enforcement is 49% of graph interaction: 57 redirects vs 60 graph calls.

Nothing leaves your repo. There is no telemetry endpoint.

*A tool that can block your work should be able to show you when it was wrong to.*

## Commands

```bash
npx bearing install <repo> [--runtime ...] [--features ...] [--mcp http|stdio|<port>] [--stealth]
npx bearing update <repo>       # keeps your module + transport choices
npx bearing uninstall <repo>    # restores what it overwrote
```

With the GitNexus module: `bearing:northstars` · `bearing:health` · `bearing:refresh` · `bearing:fallback-log` · `bearing:scorecard` · `bearing:verify` · `bearing:token-benchmark`

**Requirements:** Node ≥ 22.9.0 · a git repo · macOS, Linux, Windows or WSL · *(GitNexus module only)* the GitNexus MCP server.

[Quickstart](docs/QUICKSTART.md) · [Skills](docs/SKILLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Zed + local models](docs/ZED.md) · [Changelog](https://github.com/ReidenXerx/bearing/blob/main/CHANGELOG.md) · [Releases](https://github.com/ReidenXerx/bearing/releases)

## License

ISC
