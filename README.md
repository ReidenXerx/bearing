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

**Claude Code** · **Zed** · **Codex**

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

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/token-cost.svg" alt="bearing costs about 25,200 tokens per session — 13 percent of a 200k context window, 2.5 percent of 1M — split between bearing's own contract (10,300) and the GitNexus tool schemas (14,900). One 'what breaks if I change this' question costs 13.2 times less through the graph than through grep on an 894-file repo, and 3 times less on a 374-file repo." width="100%">

**It will not blow up your context.** ~25,200 tokens a session — and one *what breaks if I change this?*
costs 3–13× less through the graph than grepping and reading the hits. Measure it on your own repo
with `npm run bearing:token-benchmark`; [the numbers, and where the graph LOSES](#what-it-costs-your-context).

## What you get

**Eleven independent modules. Pick any combination — each works alone, none depends on another.**
| | |
|---|---|
| ⚑ **North-stars** | **Stops killed ideas respawning six months later.** Numbered, authoritative claims about what your project *is* — **outranks every other doc**, re-injected as the session runs. |
| 🏅 **Gold practices** | **The mistakes that get made anyway.** Numbered `GP-#` rules earned from real defects — a claim from reading rather than running is unverified, a test that has never failed has never been tested. Language- and project-neutral. |
| 💾 **Task-core** | **Survives compaction.** A dense save-state of the current task, written **before** the summary lands and drops the detail. |
| 🔬 **Microscope** | **Catches code that runs perfectly and is still wrong.** A panel of lens agents reviews as an expert in *your* domain — each finding must survive its own refutation pass. |
| 🙋 **Consult** | **Asks about the right things, decides the rest.** Asks you only what isn't in the repo — which reading you meant, what a user should see — and decides everything else. Confirms before anything irreversible. |
| 🐜 **Minions** | **Parallelises wide mechanical work.** Cheap anchored subagents return **citations, not opinions** — they gather; your agent concludes. |
| 🧪 **TS/JS rules** | **Catches code that compiles and is still wrong.** Numbered `TS-#` rules for the traps `tsc` and ESLint both stay silent about — `as` that verifies nothing, a union that falls through on the next variant, `||` overwriting a deliberate `0`. |
| 🧱 **Frontend** | **Stops the near-duplicate component and the silent shared-component edit.** Search by shape before building a table or a panel; an optional prop with a safe default is yours, anything that changes what existing callers render is an ask. |
| ⚛️ **React** | **Catches the form bugs that fail silently.** A field owns its `Controller`; spreading `field` keeps the `ref` that focus-on-error needs; a `name` typed `FieldPath<T>` turns a renamed field into a compile error instead of a value missing from the payload. |
| 🕸 **GitNexus** | **Turns 40 text matches into a real code graph.** Hard gates redirect symbol greps to callers and flows. Requires the [GitNexus](https://github.com/abhigyanpatwari/GitNexus) MCP server. |
| 🎭 **E2E** | **Turns "I checked it in the browser" into an exit code.** A harness your agent finishes: working substrate plus the scars, and a way to test a destructive write *without performing it*. Opt-in — it writes `.e2e/` and needs Playwright. |

**And one thing that isn't a module:** the agent files bug reports against its own tooling, and the kit will tell you when *its own gates* are the problem. → [the receipts](#it-tells-you-when-its-the-problem)

## Install

```bash
npx bearing                                    # interactive — explains each module
npx bearing install . --runtime claude --features northstars,taskcore
```

`--runtime` `claude` · `zed` · `codex` · `all`  ·  `--features` `northstars` · `goldpractices` · `taskcore` · `microscope` · `consult` · `minions` · `tsjs` · `frontend` · `react` · `gitnexus` · `e2e` · `all`

Then restart your IDE. Enforcement needs tool-interception hooks, and **only Claude Code** exposes
them:

| | Claude Code | Zed | Codex |
|---|:---:|:---:|:---:|
| North-stars — loaded as authority | ✅ | ✅ | ✅ |
| North-stars — re-anchored mid-session | ✅ | — | — |
| Gold practices — cited as authority | ✅ | ✅ | ✅ |
| Task-core — survives compaction | ✅ | — | — |
| Microscope — domain-expert review | ✅ | ✅ | — |
| Consult — ask vs decide | ✅ | ✅ | — |
| Minions — anchored fan-out | ✅ | — | — |
| TS/JS rules — cited in-context | ✅ | ✅ | ✅ |
| Frontend rules — cited in-context | ✅ | ✅ | ✅ |
| React rules — cited in-context | ✅ | ✅ | ✅ |
| GitNexus — hard gates | ✅ | — | — |
| E2E — browser verification | ✅ | ✅ | ✅ |

✅ means it fires without being asked. A `—` is not always absence: the **task-core** skill and its
contract section install on every runtime, so you can invoke it by name — what Claude Code adds is
the nudge that fires it unprompted. **Minions** and the **GitNexus gates** genuinely need hooks and
are not present at all where the column says `—`.

### 🎨 Prettier — so two tools stop rewriting each other

An install puts ~90 tracked, formattable files into your repo — the hook lib alone is 31 `.mjs`
modules — and every one is bearing's, replaced wholesale on the next update. If you format on
commit, Prettier reformats all 90, the next `bearing update` overwrites them back, and that diff
returns every cycle.

If the installer finds Prettier (`.prettierrc*`, `prettier.config.*`, a `prettier` key or
dependency in `package.json`, or just a `.prettierignore`), it **asks** — and quotes back what it
found, since you are being asked to let an installer edit your formatter's config:

```
This repo runs Prettier (found package.json: devDependencies.prettier)
Add 5 bearing-owned paths to .prettierignore?
  1  Yes — stop the two tools rewriting each other's work
  2  No — leave .prettierignore alone (your files, your call)
```

Non-interactive installs decide with `--prettierignore` / `--no-prettierignore`; **saying nothing
means no**, because `.prettierignore` is your repo's configuration and bearing does not edit it
uninvited. The answer is remembered, so an update refreshes the block rather than re-asking, and
`--no-prettierignore` later takes it back out. Only paths bearing **wholly owns** are listed —
`CLAUDE.md` and `AGENTS.md` are yours, so they keep being formatted. Uninstall removes the block,
and deletes the file only if bearing created it.

Stealth installs skip this and say so: `.prettierignore` is a tracked file, and writing it would
break the one promise stealth makes.

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

## 🎭 E2E harness

Opt-in: it is the one module off by default, because it writes a new top-level `.e2e/` and wants a
Playwright download. `--features …,e2e`, or pick it in the wizard.

Not a test framework — Playwright is the capability, and your agent already has it. What it ships is
the **shape and the scars**: a report whose exit code is the product, polling waits instead of
sleeps, request readers that assert on the *body* because a 2xx can carry an error envelope, and
`blockWrites` — intercept a mutation, capture the payload, fulfil it locally, so "does this button
send the right thing" stops being an irreversible experiment.

Screenshots are keyed by *what they are of*, not by filename. The next capture of a view replaces
it, so a directory of shots is always current and never accumulates `editor-final-2.png`. It
catalogues itself.

The harness is meant to **grow**. When a verifier hits something the kit handled badly, the agent
appends it to the scars list and fixes it at the next milestone — not mid-run, because results from
a harness that no longer exists are not results.

Every scar in the shipped README is one that produced a **green run over a real failure**: a skip
stored as a pass turning an all-skipped run into a pass, a URL pattern that matched the list instead
of the create, a blanket POST block that severed the session and made a working feature look missing.

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

**What it buys back.** Answering `what breaks if I change this?` through the graph, against
grepping and then reading what grep points at. Two graph numbers, because they answer two different
questions — `--summary-only` gives counts and risk, the full response gives every call site, which
is what `git grep` gives you:

```
                             summary    sites   grep+read   vs sum   vs sites
  lead-sniffer (234 files)    10,505   65,645     199,737     19x        3.0x
  Sourcerer-Be (709 files)     7,534   71,446     945,338    125x       13.2x
```

**`vs sites` is the honest column** — like for like. The 19x/125x figures compare a summary against
grep's locations, which flatters the graph by however much the call-site list would have cost. Both
are real questions; pick the row that matches the one you were going to ask.

Repaid inside one to two questions either way.

**Do not take my repos for it — measure yours:**

```bash
npm run bearing:token-benchmark          # or: -- --targets 12 --json
```

It picks your most-called symbols, runs the real `impact` against them, and compares that with
`git grep` plus a 40-line window around every hit — which is what answering by hand actually costs.
It reports losses too: on lead-sniffer the graph loses one of eight, and says so in the table. A
symbol with three callers is cheaper to grep, and a benchmark that never admits that is advertising.

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
npx bearing install <repo> [--runtime ...] [--features ...] [--mcp http|stdio|<port>] [--stealth] [--prettierignore]
npx bearing update <repo>       # keeps your module + transport choices
npx bearing uninstall <repo>    # restores what it overwrote
```

With the GitNexus module: `bearing:northstars` · `bearing:health` · `bearing:refresh` · `bearing:fallback-log` · `bearing:scorecard` · `bearing:verify` · `bearing:token-benchmark`

**Requirements:** Node ≥ 22.9.0 · a git repo · macOS, Linux, Windows or WSL · *(GitNexus module only)* the GitNexus MCP server.

[Quickstart](docs/QUICKSTART.md) · [Skills](docs/SKILLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Zed + local models](docs/ZED.md) · [Changelog](https://github.com/ReidenXerx/bearing/blob/main/CHANGELOG.md) · [Releases](https://github.com/ReidenXerx/bearing/releases)

## License

ISC
