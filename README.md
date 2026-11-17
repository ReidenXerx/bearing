<div align="center">

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/bearing-mark.svg" alt="bearing" width="72">

# bearing

**Your tests catch code that breaks. Nothing catches an agent that has drifted about what the code *means*.**

A toolbelt for developers who already work with coding agents: north-stars that outrank stale docs,
memory the agent keeps true, a task-core that survives compaction, ast-grep with the traps that make
it lie, review and fan-out when you ask for them. **You decide when.**

[![npm](https://img.shields.io/npm/v/bearing?color=3987e5)](https://www.npmjs.com/package/bearing)
[![npm downloads](https://img.shields.io/npm/dt/bearing?color=3987e5)](https://www.npmjs.com/package/bearing)
[![Node](https://img.shields.io/badge/node-%3E%3D22.9.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ReidenXerx/bearing?color=3987e5)](https://github.com/ReidenXerx/bearing)

**Claude Code** · **Zed** · **Codex**

```bash
npx bearing
```

**[duduphudu.app/bearing](https://duduphudu.app/bearing/)** — what it does, what it costs, and where it fails


<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/taskcore.png" alt="One real 10-day session, plotted by context size: the context was compacted six times, and the task-core had been saved before every one." width="100%">

A drifted agent doesn't crash. It reads a doc you abandoned in March, re-proposes the feature you
already measured and killed, and writes a convincing paragraph about it. You nod. You find out three
days later. That failure has a name — **losing your bearings**.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/memory.png" alt="Eighty tool calls through the real hooks of a default install. At session start: memory last written 10 days ago, 4 commits since. After 25 edits: save the task-core. At a PR merge: is memory still true. After compaction: recover from memory first. Every other call stays silent." width="100%">

**And it keeps its own memory true.** The next session starts from memory, not from this transcript —
so the agent is asked to maintain it at the moments it goes stale, and writes it itself.
[How, and the knobs](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/memory.md)

## What you get

Sixteen modules, each independent: pick any combination. Seven are on by default; the rest you add.

### Always on

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/northstars-stale.png" alt="An old doc says the fee is 2.9 percent of the gross; a north-star decided later says the net. Without bearing, 5 of 5 agents followed the stale doc; with it, 5 of 5 followed the north-star and said why." width="100%">

**[North-stars](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/northstars.md)** — the project's fixed points, which outrank every stale doc.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/northstars-graveyard.png" alt="Retrying captures automatically was rejected and recorded in the north-stars. When the gateway timed out, without bearing 5 of 5 agents' code retried the capture; with it, 5 of 5 stopped and cited the decision." width="100%">

A rejected idea stays rejected: the agent cites the decision instead of re-proposing it.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/goldpractices.png" alt="The gold-practice rules agents cited most across 18 real Claude Code transcripts in three projects, ranked by how often each was cited." width="100%">

**[Gold practices](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/northstars.md)** — rules earned from real defects, cited by number. **[Task-core](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/taskcore.md)** — the per-chat save-state at the top of this page.

### On your command

Nothing here starts on its own.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/microscope.png" alt="A real review of 740 new lines: five lenses raised 28 findings; one was disproved and three were found twice, so 24 reached the report, ranked 1 critical, 6 high, 10 medium, 7 low." width="100%">

**[Microscope](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/microscope.md)** — "microscope this": a domain-expert review panel whose findings must survive an attempt to disprove them.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/minions.png" alt="A real fan-out: eight subagents swept eight slices of a repo for stale references at once, each returning cited file and line, what it checked and what it missed; 766 cited lines reached one decision." width="100%">

**[Minions](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/minions.md)** — "fan this out": subagents that gather citations, or apply a change you decided. They never decide.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/consult.png" alt="Asked to add formatAmount, without bearing 5 of 5 agents invented a currency format; the repo's style doc already said how. With bearing 5 of 5 used the repo's own rule." width="100%">

**[Consult](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/consult.md)** — asks only what the repo cannot answer, and confirms before anything irreversible.

### Tools, with the traps that make them lie

None adds anything to your `package.json`. ast-grep is on by default; the other three are opt-in.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/astgrep.png" alt="ast-grep: a pattern that does not parse returns an empty result, exit 1 and no error — identical to a search that found nothing. The skill proves every pattern on a known site first." width="100%">

**[ast-grep](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/astgrep.md)** — search and rewrite by code shape, with the pattern proven first.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/history.png" alt="Why does this line exist? git blame names a Prettier commit; blame -w still does; blame --ignore-rev of the formatter names the commit that wrote it, and why." width="100%">

**[Git history](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/history.md)** — why code is this way, past the formatter commit.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/knip.png" alt="The same delete-unused-files task, 12 runs. Without the module, 3 live files were deleted; with it, none." width="100%">

**[knip](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/knip.md)** — what is really unused, as candidates the agent checks before it deletes.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/mergiraf.png" alt="A real merge: git stops on two conflicts; mergiraf resolves both by syntax tree and keeps both sides; then the agent reviews every resolution and type-checks before it commits." width="100%">

**[mergiraf](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/mergiraf.md)** — merge by syntax tree, and read every resolution.

### Rules for the stack you have

Opt-in. They load into every session, so add the ones your code is written in.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/tsjs.png" alt="A typed loader over a legacy client typed any. Without the rule the agent returned the response as an Invoice and a payload missing totalCents passed; with it the response was held as unknown, checked, and the bad payload threw. Without the rule (alone or with the other rules) 0 of 12 runs checked it; with it present, 11 of 12." width="100%">

**[TypeScript / JavaScript](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/tsjs.md)** — code that compiles and is still wrong at runtime.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/frontend.png" alt="A table page where the shared table lives in another folder under a name that never says table. Without the rule the agent wrote a second table by hand; with it, it found and reused the shared one." width="100%">

**[Frontend](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/frontend.md)** — find the component you already have before writing another.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/react.png" alt="Three phone fields in one react-hook-form form. Both versions work; with the rule the Controller wiring is written once, in one field component, instead of once per field." width="100%">

**[React](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/react.md)** — form fields that own their wiring.

### Kits

Each one asks before it installs anything heavier.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/e2e.png" alt="Verifying a Delete button on shared data: the click is stopped inside the browser and recorded; the server sees only reads; the shared data file has the same checksum before and after." width="100%">

**[E2E harness](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/e2e.md)** (Playwright) — "I checked it in the browser" becomes an exit code, without touching shared data.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/publish.png" alt="A README card an agent made from a one-line ask, every figure traced to the docs and the source printed on it; beside it, the renderer refusing a card that never finished drawing." width="100%">

**[Publish](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/publish.md)** (Playwright) — visuals whose every figure comes from a file, and nothing half-drawn.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/gitnexus.png" alt="What calls one helper in GitNexus's own repository: impact found 0 callers and flagged its answer as a lower bound; a Cypher query on the same index found 9 callers; git grep found 15 call sites in 8 files." width="100%">

**[GitNexus](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/gitnexus.md)** (its CLI and MCP server) — the code graph, only when you ask, and checked when its answer is empty.

### What it won't do

Block a tool, push a workflow on you, or decide when you review, fan out or reach for the graph. It
speaks up unasked only to keep the agent's grip on your project, and `npx bearing status` lists each
moment with the knob that turns it off.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/status.png" alt="The real output of npx bearing status on a fresh default install: the contract that is always loaded and its size in tokens, each prompt that fires unasked with its cadence and the setting that turns it off, and the skills that run only when named." width="100%">

## What it costs

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/v2.0.2/docs/assets/cards/cost.png" alt="Drawn to scale against a 200k-token window: about 3,900 tokens a session by default, about 7,400 with every module, about 24,600 with GitNexus when the client loads its tool schemas up front." width="100%">

Skill bodies load only when used. [How it is counted](https://github.com/ReidenXerx/bearing/blob/main/docs/context-cost.md). Nothing leaves your
repo; there is no telemetry.

## Install

```bash
npx bearing                                    # interactive — explains each module
npx bearing install . --runtime claude --features northstars,taskcore
npx bearing install . --stealth                # a repo that isn't yours: git status stays clean
```

`--runtime` `claude` · `zed` · `codex` · `all`  ·  `--features` `northstars` · `goldpractices` · `taskcore` · `microscope` · `consult` · `minions` · `tsjs` · `frontend` · `react` · `astgrep` · `history` · `knip` · `mergiraf` · `publish` · `gitnexus` · `e2e` · `all`

`npx bearing status` says what bearing does in a repo: what is always loaded, each thing that speaks
up unasked with its knob, and the skills you can invoke. `npx bearing doctor` says whether an install
is still healthy and the command that fixes each problem. Stealth, Prettier, several sessions in one
repo: [install details](https://github.com/ReidenXerx/bearing/blob/main/docs/install.md).

Then restart your IDE. The moments a module speaks up need tool-interception hooks, and **only
Claude Code** exposes them:

| | Claude Code | Zed | Codex |
|---|:---:|:---:|:---:|
| North-stars — loaded as authority | ✅ | ✅ | ✅ |
| North-stars — re-anchored mid-session | ✅ | — | — |
| Gold practices — cited as authority | ✅ | ✅ | ✅ |
| Task-core — survives compaction | ✅ | — | — |
| Microscope — domain-expert review | on ask | on ask | — |
| Consult — ask vs decide | ✅ | ✅ | — |
| Minions — anchored fan-out | on ask | — | — |
| TypeScript/JavaScript — traps that compile | ✅ | ✅ | ✅ |
| Frontend — structure and blast radius | ✅ | ✅ | ✅ |
| React — what the types do not catch | ✅ | ✅ | ✅ |
| ast-grep — search and rewrite by shape | ✅ | ✅ | ✅ |
| Git history — why code is this way | ✅ | ✅ | ✅ |
| knip — what is really unused | ✅ | ✅ | ✅ |
| mergiraf — merge by syntax tree, reviewed | ✅ | ✅ | ✅ |
| Publish — visuals with one true claim | ✅ | ✅ | ✅ |
| GitNexus — the graph, only when you ask | on ask | on ask | — |
| E2E — browser verification | ✅ | ✅ | ✅ |

✅ means it fires without being asked; *on ask* means it never does, by design, and answers when you ask. A `—` is not always absence: the **task-core** skill and its
contract section install on every runtime, so you can invoke it by name — what Claude Code adds is
the nudge that fires it unprompted. **Minions** need Claude Code's subagents and are not present at all
where the column says `—`. Microscope, minions and GitNexus fire only when you ask, on any runtime that
has their skill.

## Commands

```bash
npx bearing install <repo> [--runtime ...] [--features ...] [--mcp http|stdio|<port>] [--stealth] [--prettierignore]
npx bearing update <repo>       # keeps your module + transport choices
npx bearing uninstall <repo>    # restores what it overwrote
npx bearing status [<repo>]     # what is loaded, what speaks up unasked + its knob, the skills
npx bearing doctor [<repo>]     # is the install healthy; --all <folder> for every install
```

With the GitNexus module: `bearing:refresh` · `bearing:health` · `bearing:verify` · `bearing:ci` · `bearing:token-benchmark`

**Requirements:** Node ≥ 22.9.0 · a git repo · macOS, Linux, Windows or WSL · *(GitNexus module only)* the GitNexus MCP server.

[Quickstart](https://github.com/ReidenXerx/bearing/blob/main/docs/QUICKSTART.md) · [Skills](https://github.com/ReidenXerx/bearing/blob/main/docs/SKILLS.md) · [Architecture](https://github.com/ReidenXerx/bearing/blob/main/docs/ARCHITECTURE.md) · [Zed + local models](https://github.com/ReidenXerx/bearing/blob/main/docs/ZED.md) · [Changelog](https://github.com/ReidenXerx/bearing/blob/main/CHANGELOG.md) · [Releases](https://github.com/ReidenXerx/bearing/releases)

## License

ISC
