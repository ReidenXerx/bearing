<div align="center">

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/bearing-mark.svg" alt="bearing" width="72">

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


<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/hero.png" alt="Your tests catch code that breaks; nothing catches an agent that has drifted. Without bearing: a design doc is abandoned in March, the agent re-proposes the idea you measured and killed, and you find out three days later. With bearing: you record it once as a north-star, NS-9, measured and rejected; the north-star outranks the abandoned doc, and the idea is caught, cited and not re-proposed." width="100%">

A drifted agent doesn't crash. It reads a doc you abandoned in March, re-proposes the feature you
already measured and killed, and writes a convincing paragraph about it. You nod. You find out three
days later. That failure has a name — **losing your bearings**.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/memory.png" alt="Your agent keeps its own memory true. At session start, when memory is a week old and commits have landed since, it reconciles memory before trusting it. While it works, when edits pile up, it saves the task-core again. At a milestone — a PR merged, a tag, a release, a publish — it checks whether memory still says what is true. After compaction it reads the task-core and memory back first. bearing asks; the agent writes; every prompt has a knob." width="100%">

**And it keeps its own memory true.** The next session starts from memory, not from this transcript —
so the agent is asked to maintain it at the four moments it goes stale, and writes it itself.
[How, and the knobs](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/memory.md)

## What you get

Sixteen modules, each independent: pick any combination. Seven are on by default; the rest you add.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/anchors.png" alt="Always on: north-stars outrank every stale doc; gold practices are rules earned from real defects, cited by number; the task-core is a per-chat save-state written before compaction." width="100%">

**Always on, and the reason it exists.** [North-stars](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/northstars.md) · [gold practices](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/northstars.md) · [task-core](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/taskcore.md)

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/onask.png" alt="On your command: microscope this starts a domain-expert review panel whose findings must survive refutation; fan this out starts subagents that return citations, never verdicts; consult asks only what the repo cannot answer and confirms before anything irreversible." width="100%">

**Nothing here starts on its own.** [Microscope](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/microscope.md) · [minions](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/minions.md) (gathering, and applying a decided change) · [consult](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/consult.md)

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/tools.png" alt="Each tool ships with its traps: ast-grep searches by code shape and proves its pattern first; git history finds why code is this way past the formatter commit; knip lists unused code as candidates only; mergiraf merges by syntax tree and the agent reads every resolution." width="100%">

**ast-grep is on by default; the other three are opt-in.** None adds anything to your `package.json`. [ast-grep](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/astgrep.md) · [Git history](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/history.md) · [knip](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/knip.md) · [mergiraf](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/mergiraf.md)

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/rules.png" alt="Code that compiles and is still wrong: TS/JS rules for as, unions and ||; frontend rules for near-duplicate components and shared-component edits; React rules for form fields." width="100%">

**Opt-in, for the stack you have.** [TypeScript / JavaScript](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/tsjs.md) · [Frontend](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/frontend.md) · [React](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/react.md)

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/kits.png" alt="Opt-in kits: E2E turns I checked it in the browser into an exit code and records narrated demos; Publish makes visuals with one true claim, looked at before they ship; GitNexus is a code graph used only when you ask." width="100%">

**Each one asks before it installs anything heavier.** [E2E harness](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/e2e.md) (Playwright) · [Publish](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/publish.md) (Playwright) · [GitNexus](https://github.com/ReidenXerx/bearing/blob/main/docs/modules/gitnexus.md) (its CLI and MCP server)

**What it won't do:** block a tool, push a workflow on you, or decide when you review, fan out or
reach for the graph. It speaks up unasked only to keep the agent's grip on your project — a brief at
session start, the north-stars again as the context grows, a nudge when unsaved work piles up before a
compaction, a memory check after a merge or a release — and `npx bearing status` lists each one with
the knob that turns it off.

## Measured, not asserted

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/receipts.png" alt="Receipts: bearing's own graph gates cost 4 to 5 times as much per solved task over 180 runs, so they were retired; 9 of 9 runs used ast-grep once a skill carried its traps, on a real 650-file repo; 0 of 6 runs deleted live code with the knip module and 2 of 6 without it; across 107 runs, five code-intelligence setups did not beat grep at 650 files." width="100%">

Every number traces to a report with a hand-checked answer key:
[gates](https://github.com/ReidenXerx/bearing/blob/main/eval/teaching/REPORT.md) · [ast-grep](https://github.com/ReidenXerx/bearing/blob/main/eval/intel/REPORT-REAL.md) ·
[knip](https://github.com/ReidenXerx/bearing/blob/main/eval/intel/REPORT-TOOLS.md) · [code intelligence](https://github.com/ReidenXerx/bearing/blob/main/eval/codeintel/REPORT.md).
Nothing leaves your repo; there is no telemetry.

<img src="https://raw.githubusercontent.com/ReidenXerx/bearing/main/docs/assets/cards/cost.png" alt="About 3,900 tokens a session by default, 2 percent of a 200k window; about 7,400 with every module; about 24,600 if you add GitNexus and your client loads its tool schemas up front." width="100%">

Skill bodies load only when used. [The numbers, and the claim this page used to make and dropped](https://github.com/ReidenXerx/bearing/blob/main/docs/context-cost.md).

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
