# GitNexus: from gates to teaching — step 1 audit

> **Superseded 2026-11-06.** The teaching mode this describes was built, measured and rejected
> (NS-29): its moments almost never fired. GitNexus is now opt-in and user-invoked instead (NS-25).
> Kept as the record of how that decision was reached; see `eval/teaching/REPORT.md` for the numbers.

**Status:** audit only; nothing in the product has changed. The north-star changes in §7 were
**approved and applied 2026-11-06**, with two consolidations against the drafts: NS-6 folded into
NS-5 (tombstoned), and the two measurement drafts merged into one entry, NS-27. NS-28 is the
graveyard entry.

**The question.** Should bearing stop hard/soft-blocking Grep, Read, Bash and Edit to force the
graph, and instead teach the agent to use GitNexus at the moments where it actually wins?

**Short answer from the data: yes.** Most of what the gates intercept are questions the graph cannot
answer: the code lives in another checkout, or the question isn't about a symbol at all. And where
the graph does answer, a quarter of the times an agent distrusted it, it was confidently wrong in
the code shapes the fleet's frontend repos are made of. Details follow, and the measurement gaps in
§5 have to be closed before the switch, not after.

---

## 1. What enforces today

| Layer | What it is | Size |
| --- | --- | --- |
| 5 PreToolUse guards | `bearing-{grep,read,bash,edit,mcp}-guard.mjs`: thin glue, the decisions live in libs | 294 lines |
| 1 PostToolUse audit | `bearing-impact-audit.mjs`: warns on a LOW impact verdict from unresolved callers. Never blocks | 104 lines |
| The classifier | `classify.mjs`: 19 `deny` branches, 32 `allow` branches. Most allows are carve-outs added after a deny misfired; the comments are a list of scars | 1,004 lines |
| gitnexus-owned libs | 18 files incl. the classifier, health/brief, refresh, smoke, arch doc | 3,052 lines |
| GitNexus-shaped code in **core** | `check-staleness`, `load-staleness`, `stale-policy`, `cypher-helpers`, `graph-capabilities`, `rename-helpers`, plus parts of `session-primer` / `hook-helpers`. Pulled into core by the computed closure (NS-2), so they ship even to installs that declined GitNexus | 1,254 lines in the six whole files, of core's 2,990 |
| The contract | `scripts/contract/enforcement-contract.md` → every CLAUDE.md / AGENTS.md | 457 lines, most of it "where the tool is silently wrong" |
| Escape machinery | `bearing:fallback` window, fallback log, `mode: guide`, the stale loop, drift-refresh blocks | spread across the above |

Gates by trigger:

| Gate | Fires on | Blocks? |
| --- | --- | --- |
| grep-guard | Grep/Glob that looks like a symbol, field or broad source sweep | deny → `context` / `cypher` / `query` |
| read-guard | Read of a source file over the line threshold | deny → `query` → `context` |
| bash-guard | shell grep/rg/ag on a symbol; staleness; `git commit` before `detect_changes` | deny |
| edit-guard | first source edit before any `impact`; editing on a stale index | deny |
| mcp-guard | graph call while the index has drifted past the threshold | deny → refresh |
| impact-audit | after `impact` returns LOW from an unresolved caller set | warns |

## 2. Fleet baseline: what the gates actually did

Telemetry from every repo with bearing installed (`.bearing/.gitnexus-telemetry.jsonl`), 36 sessions
across 8 repos, from August to November 2026.

| | Count |
| --- | --- |
| GitNexus MCP calls | 1,246 |
| Grep → graph redirects | 628 |
| Large Read → graph redirects | 584 |
| Impact-before-edit gates | 11 |
| detect_changes-before-commit gates | 13 |
| Stale-edit blocks | 16 |
| Drift-refresh blocks | 5 |
| Classical-fallback grants (agent distrusted the graph) | 72 |

**There was one redirect for every graph call (1,212 vs 1,246).** The gates tied to a real moment
(impact-before-edit, commit, stale-edit and drift: 45 in all) were outnumbered by redirects about
27 to one.

Per repo (anonymised; `F` = React/TS frontend monorepo, `D` = desktop app, `T` = trading bot,
`C` = TS backend monorepo, `L` = TS backend, `S` = Next.js app, `B` = this repo, `P` = Python
backend):

| repo | sess | graph calls | grep redir | read redir | fallbacks |
| --- | --- | --- | --- | --- | --- |
| F | 5 | 258 | 119 | 22 | 16 |
| D | 9 | 175 | 151 | 58 | 18 |
| T | 7 | 514 | 101 | 334 | 8 |
| C | 2 | 66 | 50 | 30 | 13 |
| L | 2 | 95 | 62 | 42 | 8 |
| S | 1 | 78 | 47 | 86 | 7 |
| B | 4 | 58 | 72 | 11 | 2 |
| P | 6 | 2 | 26 | 1 | 0 |

Repo `P` is the clearest single case: 26 redirects against **2** graph calls. The gates fired, and
the agent did not take the graph up on it.

## 3. Why agents fell back: 169 logged reasons

Every `bearing:fallback` carries a written reason (`.bearing/.gitnexus-fallback-log.jsonl`). All 169
across the fleet were read and classified:

| Class | n | Share | Meaning |
| --- | --- | --- | --- |
| **Outside the index's scope** | 87 | 51% | linked git worktrees, PR refs, other branches, other repos, `node_modules`, `.e2e/`, `.bearing/`, files outside the repo, uncommitted work. The graph never had this code |
| **Graph confidently wrong or incomplete** | 41 | 24% | `ACCESSES` / `CALLS` / `impact` returned 0 or 1, often with `epistemic: "exact"`, while real callers existed |
| **Index machinery failed** | 18 | 11% | a refresh that hung for 30+ minutes, a held lock, an index marked FAILED by a killed pre-commit, and staleness reporters contradicting each other and the CLI |
| **Not a symbol question** | 13 | 8% | string literals, CSS, config keys, prose, logs, SDK/browser-API calls |
| Needs verbatim line reads | 3 | 2% | line-level audits |
| Unclassified / kit bugs / audit tests | 7 | 4% | |

**Half the friction is a scope problem, and the gate can't see it.** The single largest cluster, 55
reports from one repo, is a developer working in linked worktrees while the index tracked the main
checkout on an old branch. Every Grep and Read in the worktree was redirected to a graph that had
never seen that code. The classifier has an allow for "unindexed paths", but a worktree of the
same repo is not unindexed by path. It is a different TREE.

**The graph is wrongest in exactly the code where it was forced hardest.** The 41 confident-wrong
cases cluster in a handful of shapes, nearly all TypeScript/React:

- properties of plain object literals (`helpers.renderX`): `ACCESSES` returns nothing
- JSX: a component rendered as `<DataTable/>` across 52 files reported `impactedCount: 1`, `exact`
- default exports imported by path, barrel re-exports, `inject()(observer())` wrappers
- DI-injected stores (`this.injected.store.method()`), React context (`context.switchAccount()`)
- callbacks passed as props (`onFiltersChange={presenter.onFiltersChange}`)
- ORM columns and table consts (Drizzle), destructured hook state

These are not edge cases in the fleet's frontend repos. They are how those repos are written.

**Teaching implication:** the contract has to say *where* `impact`/`context` is a count and where it
is a lead, by code shape. Plain function and method calls are reliable. Anything rendered as JSX,
passed as a value, or reached through an object, injection or context is a floor, and the agent should
grep the tag or the property name.

## 4. Where the graph genuinely wins (from the same data)

The fallbacks show where it LOSES. Where it wins comes from the measured side:

- **Blast radius of a plain function or method, across modules:** the token benchmark measured 3×
  (234-file repo) to 13.2× (709-file repo) cheaper than grep-and-read.
- **`detect_changes` before a commit or PR review:** it maps hunks to processes, which nothing else
  does. But it is wrong on linked worktrees (one fallback records it reporting HIGH risk for a
  symbol the diff never touched).
- **Graph-resolved renames:** `rename` with `dry_run`. Its `text_search` edits still need review
  (the contract already says so).
- **Structural questions with no text form:** override chains, N-hop call paths, process steps,
  "what does this type contain".

## 5. Measurement gaps: why the baseline cannot be run yet

1. **The telemetry counts interceptions, not outcomes.** `bearing:stats` prints "Value: 86 lazy-search
   redirects" as if a redirect were value. It records that a redirect happened, not whether the graph
   then answered, the agent fell back, or the answer was wrong. A helpful redirect and a false deny
   are the same row. Under teaching, the equivalent risk is counting nudges shown instead of nudges
   that changed what the agent did next.
2. **The eval harness has no live runner.** `eval/runners/cursor-agent.mjs` is the only real runner,
   and Cursor was removed in 1.2.0. A `claude -p` runner is needed.
3. **The eval tasks don't discriminate.** The last report (`eval/report.md`) is a 100%/100% ceiling
   on two rename tasks, and says so itself.
4. **The real-repo benchmark's ground truth is graph-derived** (`eval/BENCHMARK-realrepo.md`: "Ground
   truth: 23 files (graph-derived closure)"). It grades the graph against the graph, so it cannot
   detect the 24% confident-wrong class above, by construction.
5. **The graph cannot see bearing's own enforcement code.** `bundle/.bearing/**` is excluded from the
   index, so in this repo the gates redirect questions about the classifier to a graph that returns
   zero for it (logged twice during this audit).

What a usable baseline needs: a Claude Code runner; tasks drawn from the fallback log's real shapes
(JSX consumers, object-literal properties, a worktree, a string-literal search, a cross-module blast
radius), with **hand-verified ground truth**; and three conditions: kit off, gates (today), and
teaching. Running it costs real model quota, so how many tasks and trials is a budget decision.

## 6. Replacement map (proposal)

| Today | Proposed | Why |
| --- | --- | --- |
| grep-guard deny | **PostToolUse lesson**: when a grep for an identifier returns many hits across many files, append "this was a who-uses question; `context` returns N resolved callers". Only when the identifier IS in the graph and the path IS in scope | Teaches with the agent's own wasted result; can never false-deny (NS-5) |
| read-guard deny | **Remove.** Optionally, a note on the first large Read of an indexed file naming `context` for the symbols in it | 584 redirects; reading a known file is the case grep and Read are best at |
| bash-guard symbol deny | **Remove**, same lesson as grep | the compound-command block discarded whole lines |
| edit-guard (impact first) | **Nudge before the first edit of a file that defines exported symbols**, carrying the `impact` summary itself where it can be computed within the hook's time bound (NS-7) | the one gate tied to a real moment; keep the moment, drop the deny |
| commit gate | **Nudge** to run `detect_changes`; skip on commits whose target repo isn't the indexed one | misfires on cross-repo `git -C` commits (PR #26) |
| mcp-guard drift deny | **Annotate** graph results with how far behind they are; never block a read-only query | fail closed on the GRAPH means "say it's stale", not "refuse to answer" (NS-8) |
| impact-audit | **Keep**, and widen it to the shapes in §3 | it is already teaching, at the right moment |
| stale loop, fallback window | **Retire the window**; keep `bearing:fallback` as a no-op alias (NS-15) and keep the log as "report a graph failure" | the window exists only because of the denies |
| 457-line contract | **Rewrite** as: when the graph wins, when it loses (by code shape and by scope), and how to check scope (which checkout is indexed, how stale) | the parts worth keeping are the honesty, not the commandments |

**Scope check first, every time.** Before any nudge points at the graph, it must know whether the
path is in the indexed tree. A worktree, another repo, `node_modules`, `.e2e/` or `.bearing/` gets
no nudge at all. That one check removes the largest failure class (51%) outright.

**Runtime reach (NS-14).** Moment-triggered nudges still need hooks, so Claude Code is still the only
runtime that gets *timing*. What changes is that the teaching content (the when-it-wins table and
the code-shape caveats) is static and lives in the contract and skills, which Zed, Codex and Oz
already read. Today those runtimes get a contract that commands a gate they don't have.

## 7. North-star audit

### Per north-star

| NS | Verdict | Note |
| --- | --- | --- |
| NS-1 Runs in other people's repos | keep | governs the migration: unregistering guards must leave the user's own hooks alone |
| NS-2 Core never depends on a feature | keep, **act on** | 1,254+ lines of GitNexus-shaped code sit in core via the closure; the rewrite is the chance to move them out |
| NS-3 Idempotent | keep | the update that removes guards must converge on a second run |
| NS-4 Migration before copy | keep | applies directly to the guard-removal migration |
| NS-5 False deny worse than missed gate | keep, **amend** | the data shows it was violated at scale (§3). Amend to the general form: *never block work to force a tool; when unsure, say nothing* |
| NS-6 Every block has an exit | **amend** | names `bearing:fallback` and `mode: guide`, which retire. Keep the principle for any block that remains |
| NS-7 Hooks on every call | keep | binds the new PostToolUse lessons: bounded, no full-file reads, an `impact` computed in-hook needs a time cap |
| NS-8 Fail open / fail closed on graph | keep, **flag** | the "closed on the graph" half is not holding: 18 fallbacks were staleness reporters contradicting each other |
| NS-9, 10, 11 | keep | |
| NS-12 Test the negative case | **amend** | written for gates ("assert something IS denied"). For teaching, the negative is: assert the nudge does NOT fire where the graph can't help (out-of-scope path, string literal) |
| NS-13 GitNexus is one module | keep, **reword** | "enforcement leak" becomes "graph wiring leak" |
| NS-14 Only Claude Code can enforce | **rewrite** | true but the framing changes: hooks give *timing*, the contract gives *content*, and content reaches every runtime |
| NS-15 Legacy names stay as aliases | keep | `bearing:fallback`, `mode: guide`, `hooks.json` keys, `gitnexus:*` scripts |
| NS-16, 17, 19, 20, 21, 22, 24 | keep | unaffected |
| NS-23 Judgment, not capability | keep, **extend** | becomes the governing NS for this module too; consider naming GitNexus explicitly as the case that taught it |
| NS-18 Concurrent hook counters (open) | keep open | more PostToolUse hooks raise the race rate slightly; still cosmetic |

### Structural issues with the file itself

- **There is no GRAVEYARD section,** though CLAUDE.md and the `bearing-northstars` skill both describe
  one. The rejected ideas currently live inside Settled entries (NS-19's retired settings).
- **Numbering is out of order** (NS-22–24 among the invariants, NS-19 among Settled). Don't renumber:
  NS ids are cited in commits and other docs, so the same alias obligation as NS-15 applies.
  Retire with a tombstone line instead.
- **The contract's "North star: GitNexus is the default reasoning layer for every task"** is not an
  NS but reads like one, and is the claim this change retires.

### Proposed new entries (drafts)

- **NS-25 — GitNexus is taught at the moment it wins, never forced.** The graph is consulted where it
  answers better than text: blast radius of a plain call, pre-commit change mapping, structural
  questions, graph-resolved renames. Elsewhere it is not mentioned. Evidence: 36 sessions, 1,212
  redirects against 1,246 graph calls; of 169 logged fallbacks, 51% were questions outside the index
  and 8% were not about symbols.
- **NS-26 — The index sees one tree.** It covers one checkout at one commit. Linked worktrees, PR refs,
  other branches, other repos, uncommitted files, `node_modules` and the kit's own `.bearing/` are
  invisible to it. Anything that points an agent at the graph checks scope first. (55 fallbacks from
  one repo's worktree workflow.)
- **NS-27 — An interception is not a result.** Count what changed after a nudge or redirect (the
  graph answered and the agent used it, or it fell back), never the fact that one fired. "86
  redirects" was printed as value.
- **NS-28 — Ground truth for a graph eval cannot come from the graph.** A benchmark that derives its
  answer key from the index cannot detect the index being confidently wrong, which is 24% of the
  fallbacks.
- **GRAVEYARD — "Force graph-first by blocking Grep/Read/Bash."** Tried August–November 2026. Rejected
  for: the §2/§3 numbers, a 1,004-line classifier of carve-outs, and zero reach outside Claude Code.
  Do not re-propose without evidence that addresses scope and the confident-wrong shapes.

## 8. Decisions for the maintainer

1. Accept, amend or reject the NS changes in §7 (nothing is written to `northstars.md` until then).
2. Eval budget: how many tasks × trials × conditions to spend on the baseline (§5).
3. Whether the read-guard is removed outright or kept as a one-time note.
4. Whether the edit-time nudge computes `impact` itself (better teaching, costs hook time) or only
   names it.

## Reproducing the numbers

```bash
# fleet telemetry (one row per repo)
ls ~/Projects/*/.bearing/.gitnexus-telemetry.jsonl ~/Projects/*/*/.bearing/.gitnexus-telemetry.jsonl
# per-repo summaries
node scripts/bearing-agent.mjs stats
# fallback reasons, per repo
node scripts/bearing-agent.mjs fallback-log
```
