# Eval harness

Two complementary approaches to measuring GitNexus value:

1. **Real-repo benchmark** (`bench-realrepo.mjs`) — tests **your kit** (hooks + rules + skills + MCP + PDG)
2. **SWE-bench Verified** (`swebench/`) — tests **GitNexus MCP** alone (industry-standard comparison)

> ⚠️ These measure different things. The real-repo benchmark proves your kit's enforcement
> adds value ON TOP of MCP. SWE-bench proves MCP helps agents explore code. See the
> [two-tier breakdown](#what-each-tier-proves) below.

## Quick start

```bash
# 1) Dry run — validate task specs, see the matrix (no model needed)
npm run eval

# 2) Smoke test the runner contract with the bundled stub
npm run eval -- --runner "node eval/runners/example-runner.mjs"

# 3) Real run via the cursor-agent CLI (headless) — budget model
npm run eval -- --runner "node eval/runners/cursor-agent.mjs" --model composer-2.5-fast
```

A report is written to `eval/report.md`.

The bundled `cursor-agent` runner is **real**: it copies each task's fixture into an
isolated temp workspace, installs the kit for the ON condition (rules + hooks + MCP + a
fresh `gitnexus analyze`), drives `cursor-agent -p --output-format stream-json`, then runs
the task's machine `check`. Headless `cursor-agent` honors workspace `.cursor/hooks.json`
and `.cursor/mcp.json`, so the ON condition genuinely exercises the enforcement layer —
verified live: classical edits get blocked and the agent switches to `gitnexus_rename` /
`impact` / `query`.

Only tasks with a machine `check` are scored in real runs; check-less tasks appear in the
`--dry-run` matrix as illustrative specs.

### Runner knobs (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `GITNEXUS_EVAL_TIMEOUT_MS` | `420000` | Per-condition cursor-agent budget. On timeout the run is killed but partial token usage is still captured from the stream. |
| `GITNEXUS_EVAL_KEEP` | unset | Keep temp workspaces for inspection. |
| `GITNEXUS_EVAL_NPX_MCP` | unset | Use `npx -y gitnexus@latest mcp` instead of a locally-installed `gitnexus` binary. The local binary boots much faster; only set this if you have no global install. |

> First-ever run may prompt once for workspace trust / MCP approval; after that it's
> non-interactive. The runner pins the MCP server to your local `gitnexus` to avoid
> per-run `npx` registry resolution (which can cost minutes).

### Reading the numbers

Easy tasks tend to tie (a capable model solves them with or without the kit). The
interesting signal is on tasks where the baseline silently misses call sites, over-includes,
or thrashes. The goal of this harness is to find and characterize those cases.

## How it works

For each task in `eval/tasks/*.json`, the harness spawns your runner twice with env:

| Var | Value |
| --- | --- |
| `GITNEXUS_KIT` | `on` or `off` — your runner enables/disables the kit hooks accordingly |
| `GITNEXUS_TASK_ID` | task id |
| `GITNEXUS_TASK_PROMPT` | the prompt to give the agent |
| `GITNEXUS_TASK_JSON` | full task spec (fixture + check) |
| `GITNEXUS_MODEL` | model slug (from `--model`) |

Your runner must print **one JSON line**:

```json
{ "pass": true, "tokens": 12345 }
```

## Writing a real runner

A real runner should, per invocation:

1. Reset a fixture repo to a known state.
2. If `GITNEXUS_KIT=on`, install/enable the kit (`npx bearing install .`); if `off`, disable hooks.
3. Drive an agent on `GITNEXUS_TASK_PROMPT` (e.g. via `@cursor/sdk` or the `cursor-agent` CLI).
4. Run the task's success check (see each task's `rubric`).
5. Print `{"pass": <bool>, "tokens": <int>}`.

See `eval/runners/example-runner.mjs` for the contract (it's a deterministic stub).

## Tasks

Each `tasks/*.json` is a self-contained spec: `id`, `title`, `prompt`, `rubric`, and a `hypothesis`
explaining the expected kit advantage. Add your own — keep them small and objectively checkable.

## Real-repo experiments

Toy fixtures are too easy for capable models. To probe real lift, run against a real codebase:

```bash
# 2-arm (OFF vs KIT — proves total kit value):
node eval/bench-realrepo.mjs \
  --task eval/realrepo-tasks/transitive-callers-impact.json \
  --repo /path/to/your/repo \
  --model composer-2.5-fast --trials 2

# 3-arm (OFF vs MCP vs KIT — proves kit enforcement adds value ON TOP of MCP):
node eval/bench-realrepo.mjs \
  --task eval/realrepo-tasks/transitive-callers-impact.json \
  --repo /path/to/your/repo \
  --model composer-2.5-fast --trials 2 --arms 3
```

**Choosing the repo.** The `repo` field in each task JSON is only an example/default
(it points at one author's local clone). Override it for your machine with **either**:

```bash
node eval/bench-realrepo.mjs --task <task.json> --repo /path/to/your/repo ...
# or
GITNEXUS_BENCH_REPO=/path/to/your/repo node eval/bench-realrepo.mjs --task <task.json> ...
```

`--repo` takes precedence over `GITNEXUS_BENCH_REPO`, which takes precedence over the
task JSON's `repo` field. The ground-truth sets in the bundled tasks were derived against
the example repo, so for a different repo you'll need to regenerate `groundTruth` (via
`gitnexus_impact` / `gitnexus_cypher`) for the scores to be meaningful.

This is **read-only** — it never mutates your project (the task only writes a small answer file,
deleted after each trial):

Every arm runs against an isolated `rsync` copy of `repo` under `~/.cache/gn-bench/` —
the original repo is never touched. The graph for the MCP/KIT arms is (re)built inside a
Docker container. If a graph build fails, the run **aborts** rather than letting that arm
silently score against an empty graph (which would masquerade as the OFF baseline).

- **OFF** = a source-only copy with `.cursor`/`.agents`/`.gitnexus` stripped — a clean grep-only
  baseline. No graph built.
- **MCP** = a source copy with `.cursor`/`.agents` stripped; the graph is built in Docker — the
  agent has graph access but no hooks, rules, or skills. Proves MCP-only value.
- **KIT** = a source copy with `.cursor`/`.agents` kept and the graph built in Docker — the agent
  has the graph **plus** kit enforcement (hooks/rules/skills). Proves total kit value.

Stale `gn-bench-*` copies and leftover `gn-bench-*` Docker containers from crashed prior
runs are best-effort pruned at startup (skipped silently if Docker isn't installed).

Scoring is recall (name mode) or precision/recall/F1 (`"scoreBy": "path"`) against a
graph-derived ground-truth set baked into the task spec. Write a task spec (see
`eval/realrepo-tasks/`) with: `repo`, `prompt`, `answerFile`, `threshold`, and a `groundTruth`
list (derive it once via `gitnexus_impact` / `gitnexus_cypher`).

### Available real-repo tasks

The bundled tasks were authored against a `crypto-trading-bot` repo (the `repo` field in each
JSON is just that example/default path). Point them at your own repo with `--repo` /
`GITNEXUS_BENCH_REPO` as described above.

| Task | What it tests | grep ceiling | graph ceiling | **kit ceiling** |
|------|-------------|-------------|---------------|-----------------|
| `enter-control-useauth-impact` | Transitive callers in mirrored monorepo | 0.87 | 1.0 | Same — MCP-only |
| `transitive-callers-impact` | 3-level call chain (formatResearchApiError) | ~86% | 1.0 | Same — MCP-only |
| `call-chain-impact` | Call chain tracing (calculateCurrentExposure) | ~80% | 1.0 | Same — MCP-only |
| `field-write-access` | ACCESSES write edges (planExecution vars) | Can't distinguish read/write | 1.0 | Same — MCP-only |
| `pdg-control-dependence` | PDG control dependence (exposure limits) | Can't determine control | 1.0 | Same — PDG-only |
| **`safe-rename-kit-enforced`** | Coordinated rename (formatResearchApiError) | Misses indirect refs | 1.0 via `rename` | **Kit forces `rename` instead of StrReplace** |
| **`detect-changes-before-commit`** | Pre-commit blast radius (calculateCurrentExposure) | No enforcement | Agent *can* run it | **Kit blocks commit until `detect_changes` runs** |

The **bold** rows are where your kit adds value on top of MCP. These are the ones to focus on for proving the kit's contribution.

## What each tier proves

| Tier | Harness | Measures | Proves |
|------|---------|----------|--------|
| **Kit value** | `bench-realrepo.mjs` + `cursor-agent` | Hooks + rules + skills + MCP + PDG vs bare agent | **Your product** adds measurable value on top of raw MCP |
| **MCP value** | `swebench/` (SWE-bench) | Agent + MCP vs agent alone (no hooks) | GitNexus graph helps agents explore code (d3thshot proved: 30% fewer tokens) |

The kit value tier is what you need for your product claims. The MCP value tier reproduces d3thshot's result.

### 3-arm design (OFF / MCP / KIT)

The 3-arm design lets you decompose the kit's contribution:

```
KIT lift  = KIT score − MCP score   (hooks + rules + skills on top of MCP)
MCP lift  = MCP score − OFF score   (graph alone, no enforcement)
Total lift = KIT score − OFF score   (everything vs nothing)
```

- **MCP-only tasks** (transitive callers, PDG, field-write) should show MCP lift ≈ total lift
  (kit adds little because the task doesn't require enforcement).
- **Kit enforcement tasks** (safe-rename, detect-changes) should show KIT lift > MCP lift
  (the hooks force behavior that an ungated agent skips).

## SWE-bench Verified benchmark

Industry-standard comparison: run SWE-bench Verified with and without GitNexus MCP.
This measures **MCP value** (graph helps agents explore), NOT kit enforcement value.

```bash
# Quick test (50 instances)
./eval/swebench/run-benchmark.sh --model deepseek/deepseek-chat-v3-0324 --instances 50

# Full SWE-bench Verified (500 instances)
./eval/swebench/run-benchmark.sh --model deepseek/deepseek-chat-v3-0324
```

See [`eval/swebench/README.md`](swebench/README.md) for full documentation.