# GitNexus teaching mode — design (step 2)

> **Superseded 2026-11-06.** The teaching mode this describes was built, measured and rejected
> (NS-29): its moments almost never fired. GitNexus is now opt-in and user-invoked instead (NS-25).
> Kept as the record of how that decision was reached; see `eval/teaching/REPORT.md` for the numbers.

**Status:** design, for review. Nothing built yet. Evidence and the gate inventory are in
[`gitnexus-teaching-audit.md`](gitnexus-teaching-audit.md); this note decides what replaces them.

**Anchors:** NS-25 (taught at the moment it wins, never forced) · NS-26 (the index is one tree) ·
NS-5 (never block to force a tool) · NS-7 (hooks are bounded) · NS-12 (prove the nudge is silent
where it cannot help) · NS-14 (hooks give timing, the contract gives content) · NS-27 (count what
changed, against an independent answer key) · NS-1/3/4/15 (the migration).

**Decided by the maintainer (2026-11-06):** the read guard is removed outright; spend what an
adequate eval needs; the before-edit nudge names the tool rather than computing `impact` (§3, M1).

---

## 1. Shape

Teaching comes in two parts, and the split is NS-14:

- **Content, for every runtime.** The contract (CLAUDE.md / AGENTS.md) and skills carry *when the graph
  wins, where it is wrong, and how to check scope*. Zed, Codex and Oz read this and nothing else, so
  it has to be complete without hooks.
- **Timing, for Claude Code.** A few hooks say the relevant part of that content at the moment it
  applies. Never a deny. Each is silent unless every precondition holds, capped per session, and
  measured by whether the agent did what it suggested.

## 2. The scope check (NS-26): every moment's first precondition

A path is **in scope** only if all of these hold:

1. it is under the indexed repo's root, and that root is the session's git toplevel
   (`git rev-parse --show-toplevel`): a **linked worktree is a different toplevel**, so it is out;
2. it is not excluded (`.gitnexusignore`, `node_modules`, `.e2e/`, `.bearing/`, outside the repo);
3. it is tracked, or is a new file under an indexed source root;
4. the indexed commit is an ancestor of HEAD on the current branch. An index built on another branch
   is out of scope for this checkout, not merely stale.

It is computed once per session and cached (NS-7). Anything it cannot establish counts as **out
of scope**: an unknown is silence (NS-5), never a nudge pointing at a graph that may not hold the code.

The session brief states it in one line, because it is the fact agents most often lacked:
`Index: <root> @ <sha> (branch <b>, N behind). This session: <toplevel> — in scope | OUT OF SCOPE (linked worktree)`.

## 3. The moments

| # | Moment | Preconditions (all must hold) | What is said | Cap | "Taken" means |
| --- | --- | --- | --- | --- | --- |
| **M1** | Before the first edit of a file | in scope · source file · the edit's enclosing symbol has cross-file references (cheap cached lookup; unknown → silent) | `impact({target:"<sym>", file_path:"<f>"})`, pre-filled. Plus one line when `<sym>` is a shape where the count is a floor (JSX component, object-literal property, injected/context method): "grep `<Sym` / `.sym` too" | once per symbol per session | next graph call is that `impact` |
| **M2** | After a Grep / shell grep for an identifier | in scope · pattern is a plain identifier, not a literal or regex · hits span ≥ 5 files · identifier resolves to a graph symbol | PostToolUse: "this was a who-uses question: `context({name:"<id>"})` returns resolved callers, and costs less than reading these hits" | once per identifier; ≤ 3 per session | next graph call is that `context` |
| **M3** | Before `git commit` | the commit targets the indexed repo (resolve `-C` / cwd) · in scope · staged source changes · no `detect_changes` yet this session | "`detect_changes({scope:"staged"})` maps this diff to the flows it touches" | once per session | `detect_changes` before the commit lands |
| **M4** | A rename done by hand | the same identifier replaced in a 2nd file by Edit · in scope | "`rename({..., dry_run:true})`: review its `text_search` edits individually" | once per identifier | `rename` called |
| **M5** | After `impact` / `context` returns | the result is LOW/0/1 **and** the target is a floor shape, or `epistemic: lower-bound`, or `receiverTyping > 0` | widen today's `impact-audit` to name the confirming grep for the shape | per result | a scoped grep follows |
| **M6** | Any graph result on a drifted index | index behind HEAD or the working tree edited since | annotate the result: "N commits / M edited files behind — confirm anything load-bearing". Never refuse (NS-8) | per call | n/a |

Explicitly **not** moments: reading a file (any size), a literal/config/CSS search, anything out of
scope, a grep with few hits, a symbol the graph does not know.

**Why M1 names the tool instead of computing `impact`** (maintainer's question): an unrequested
number is trusted more than one the agent asked for, and `impact` is confidently wrong in exactly the
fleet's common shapes (24% of fallbacks). Called by the agent, it arrives with `epistemic` /
`boundaries` and passes through M5. Injected by a hook, it would skip both. In-hook computation also
puts an MCP round trip on the edit path (NS-7). If the eval shows named-tool nudges being ignored,
computing it becomes a condition to test (§7), not a default.

## 4. What is removed

| Today | Fate |
| --- | --- |
| `bearing-read-guard.mjs` (60-line threshold: the source of 584 redirects) | **removed** |
| grep-guard deny, bash-guard symbol deny | removed; M2 replaces them |
| edit-guard deny (impact first), stale-edit block | removed; M1 replaces them |
| commit gate | removed; M3 replaces it |
| mcp-guard drift deny / refresh-first | removed; M6 replaces it |
| `bearing-impact-audit.mjs` | kept, widened → M5 |
| fallback window (15-min classical unlock) | retired: nothing to unlock. `bearing:fallback` stays as an alias (NS-15) that only **logs a graph failure report**. The report stays valuable upstream |
| `classify.mjs` (1,004 lines) | shrinks to the scope check + identifier/literal detection, which M2 needs. The carve-out branches go with the denies |
| the stale loop in the contract | replaced by the scope line and M6 |

The graph libs that sit in core via the closure (`check-staleness`, `stale-policy`, `cypher-helpers`,
`graph-capabilities`, …) move behind the feature axis where the rewrite allows (NS-2).

## 5. The contract rewrite

From 457 lines of rules and warnings to roughly:

1. **Check scope first:** the scope line, and what "out of scope" means (NS-26).
2. **When the graph wins:** blast radius of a plain call, `detect_changes` before commit/review,
   `rename` dry-run, structural questions (overrides, N-hop paths, process steps, type contents).
3. **Where it is a floor, not a count:** the shape table (JSX, object-literal properties,
   DI/context, barrels, callbacks as props, ORM columns) with the confirming grep for each.
4. **Reading its envelope:** `epistemic`, `boundaries`, `causes`, edge confidence, 0- vs 1-based
   lines. This is the honest half of today's contract, kept.
5. **Use grep/Read freely for** known files, literals, config, CSS, prose, anything out of scope.

The line "GitNexus is the default reasoning layer for every task" goes (superseded by NS-25).

## 6. Migration (NS-1, NS-3, NS-4, NS-15, NS-22)

- **`hooks.json` is committed in users' repos, so don't rewrite it.** Interpret it instead:
  `mode: "enforce"` and `mode: "guide"` both run teaching mode after the switch, with a one-time
  notice that blocking is retired (NS-28). New value: `"teach"`. `"off"` disables the moments.
  `readLineThreshold` and other dead keys are ignored silently, and listed by `bearing:verify` as
  retired keys (there is a `checkRetiredHookKeys` precedent).
- **Unregistering guards from `.claude/settings.json`** touches only entries bearing owns
  (`isOurHookGroup`), and converges on a second update (NS-3). Like every migration, it runs before
  the bundle copy and inspects the bundle, not the target (NS-4).
- **Stealth installs** (`settings.local.json`) get the same treatment, and `git status` stays empty.
- **Aliases stay:** `bearing:fallback`, `gitnexus:*`, `mode: guide|enforce` (NS-15).

## 7. Eval: the decision gate before flipping the default

Budget: whatever an adequate decision needs (maintainer, 2026-11-06). Sized below.

**Runner.** `eval/runners/claude-code.mjs`: `claude -p --output-format json` in a throwaway copy of
the target repo with the kit installed in the condition's mode. It reports pass/fail against the
task's answer key, plus tokens, turns, wall time, graph calls, and nudges shown/taken from telemetry.

**Conditions.** `off` (no kit) · `gates` (today's enforce) · `teach` (this design). Optional
fourth, only if `teach` shows nudges ignored: `teach+impact` (M1 computes the summary in-hook).

**Tasks: built from the failure shapes, with hand-verified answer keys (NS-27).** On a purpose-built
TS/React fixture monorepo (~60 files, each shape planted deliberately, answer key written by hand and
checked by grep), plus one real public repo for realism:

| # | Task | Tests |
| --- | --- | --- |
| T1 | Blast radius of a plain function used across modules | where the graph should win |
| T2 | All consumers of a JSX component (through barrels) | the "1 caller, exact" failure |
| T3 | Callers of an object-literal helper property | `ACCESSES` blind spot |
| T4 | Callers of an injected-store / context method | DI / context dispatch |
| T5 | Fix a bug in a linked worktree on a new branch | scope (NS-26), the 51% class |
| T6 | Find where a config string / CSS value is set | not a symbol question |
| T7 | Rename a symbol that has a namesake | `rename` text-search edits |
| T8 | Which flows does this staged diff touch | `detect_changes` |
| T9 | Who writes field X | `ACCESSES write` |
| T10 | Read a known 300-line file and fix an off-by-one | the cost of the read guard |

**Size.** 10 tasks × 3 conditions × 3 trials = **90 runs per model**. Run on two tiers (Opus and
Sonnet): the kit's own claim is that the graph lifts cheaper models most, and that has never been
measured on a runtime that still exists. At roughly 50–150k tokens a run, that is ~5–14M tokens per
model. If T5 or T2 is noisy at n=3, raise those cells to 5 trials rather than the whole grid.

**Decision rule, set before running.** Flip the default to `teach` if, against `gates`:
correctness is not lower on any shape-task (T2–T4, T9) **and** higher or equal overall, **and**
tokens per passed task do not rise. Separately, `teach` must beat `off` on T1/T7/T8, or the moments
aren't teaching anything. Any other result goes back to design, not to "ship and see".

## 8. Telemetry (NS-27)

New counters: `nudge.<M>.shown`, `nudge.<M>.taken`, `nudge.<M>.silencedOutOfScope`,
`graph.answerThenFallback` (a graph call followed by a fallback report on the same symbol).
`bearing:stats` stops printing redirects as "value" and prints taken/shown per moment instead.

## 9. Build order

1. Scope check + session scope line (also the fix for the largest fallback class, useful alone).
2. Telemetry counters (so every later step is measurable).
3. Eval runner + fixture monorepo + answer keys. Run the `off` and `gates` baselines.
4. Moments M1–M6 behind `mode: "teach"`; contract rewrite behind the same flag.
5. Run `teach`; apply the decision rule in §7.
6. If it passes: flip the default, remove the guards, run the migration, update docs and release.

Each step is NS-12-tested: every moment has a test asserting it stays **silent** out of scope, on a
literal, and on an unknown symbol, alongside the test that it fires.

## 10. Open

- M2's threshold (≥ 5 files) and M1's "has cross-file references" lookup are guesses until the
  fixture eval measures them.
- Whether the real public repo for T-tasks should be TS/React (closest to the fleet) or mixed.
- How the scope check reads the index's branch when the GitNexus server is HTTP and shared across
  repos (the fallback log shows one server serving several repos).
