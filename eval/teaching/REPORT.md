# Teaching-mode eval — decision run

Generated 2026-11-06T17:06Z from 180 runs. Fixture: `eval/teaching/fixture.mjs`;
answer keys hand-built and re-derived by text (`verify-keys.mjs`), never from the graph (NS-27).
All measures come from Claude Code's own stream-json events, identically for every condition.

## sonnet

| | **off** | **gates** | **teach** |
| --- | --- | --- | --- |
| passed | 27/30 | 30/30 | 27/30 |
| mean cost / run (USD) | 0.029 | 0.164 | 0.095 |
| cost per PASSED run (USD) | 0.033 | 0.164 | 0.105 |
| mean tokens / run | 70995 | 368176 | 155918 |
| mean tool calls / run | 2.8 | 8.1 | 3.5 |
| mean graph calls / run | 0.0 | 3.1 | 0.1 |
| mean hook denials / run | 0.0 | 0.9 | 0.0 |
| mean wall time (s) | 17 | 44 | 14 |
| harness errors | 0 | 0 | 0 |

| task | shape | off: pass · F1 · $ · graph · denials | gates: pass · F1 · $ · graph · denials | teach: pass · F1 · $ · graph · denials |
| --- | --- | --- | --- | --- |
| T1 Blast radius of a plain function across modules | graph should win | 3/3 · 1.00 · 0.025 · 0.0 · 0.0 | 3/3 · 1.00 · 0.133 · 4.7 · 1.0 | 3/3 · 1.00 · 0.085 · 0.0 · 0.0 |
| T2 Every consumer of a JSX component, through barrels and an alias | JSX — graph count is a floor | 3/3 · 1.00 · 0.024 · 0.0 · 0.0 | 3/3 · 1.00 · 0.129 · 2.3 · 1.0 | 3/3 · 1.00 · 0.092 · 0.0 · 0.0 |
| T3 Users of an object-literal helper property | object-literal property — ACCESSES blind spot | 3/3 · 1.00 · 0.025 · 0.0 · 0.0 | 3/3 · 1.00 · 0.136 · 3.3 · 1.0 | 3/3 · 1.00 · 0.083 · 0.0 · 0.0 |
| T4 Callers of a method reached through context / props | DI / context dispatch | 3/3 · 1.00 · 0.035 · 0.0 · 0.0 | 3/3 · 1.00 · 0.142 · 1.0 · 1.0 | 3/3 · 1.00 · 0.090 · 0.0 · 0.0 |
| T5 Fix a bug in a linked worktree on a new branch | out of index scope (NS-26) | 3/3 · — · 0.035 · 0.0 · 0.0 | 3/3 · — · 0.273 · 3.7 · 1.0 | 3/3 · — · 0.114 · 0.0 · 0.0 |
| T6 Find where a config/CSS value is set | not a symbol question | 3/3 · 1.00 · 0.018 · 0.0 · 0.0 | 3/3 · 1.00 · 0.082 · 0.0 · 0.3 | 3/3 · 1.00 · 0.078 · 0.0 · 0.0 |
| T7 Rename a symbol that has namesakes | rename with collisions | 3/3 · — · 0.035 · 0.0 · 0.0 | 3/3 · — · 0.274 · 6.0 · 1.3 | 3/3 · — · 0.123 · 1.0 · 0.0 |
| T8 What a staged diff affects | detect_changes | 0/3 · 0.80 · 0.043 · 0.0 · 0.0 | 3/3 · 0.97 · 0.170 · 2.3 · 1.0 | 0/3 · 0.80 · 0.104 · 0.0 · 0.0 |
| T9 Who changes a field | field writes (ACCESSES write) | 3/3 · 1.00 · 0.026 · 0.0 · 0.0 | 3/3 · 1.00 · 0.156 · 4.7 · 1.3 | 3/3 · 1.00 · 0.081 · 0.0 · 0.0 |
| T10 Read a known long file and fix an off-by-one | cost of the read guard | 3/3 · — · 0.029 · 0.0 · 0.0 | 3/3 · — · 0.150 · 2.7 · 0.3 | 3/3 · — · 0.096 · 0.0 · 0.0 |

<details><summary>Failed runs, with what was missed</summary>

- T8 · off · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —

</details>

### Decision rule (design §7, fixed before running)

- no shape-task (T2–T4, T9) regresses vs gates: **yes**
- overall pass rate ≥ gates: **NO**
- cost per passed task ≤ gates: **yes**
- beats off on T1/T7/T8: **NO**
- **verdict: back to design**

## opus

| | **off** | **gates** | **teach** |
| --- | --- | --- | --- |
| passed | 27/30 | 27/30 | 27/30 |
| mean cost / run (USD) | 0.089 | 0.373 | 0.212 |
| cost per PASSED run (USD) | 0.099 | 0.415 | 0.235 |
| mean tokens / run | 85720 | 390808 | 164782 |
| mean tool calls / run | 3.3 | 8.2 | 3.5 |
| mean graph calls / run | 0.0 | 2.2 | 0.0 |
| mean hook denials / run | 0.0 | 1.1 | 0.0 |
| mean wall time (s) | 22 | 48 | 26 |
| harness errors | 0 | 0 | 0 |

| task | shape | off: pass · F1 · $ · graph · denials | gates: pass · F1 · $ · graph · denials | teach: pass · F1 · $ · graph · denials |
| --- | --- | --- | --- | --- |
| T1 Blast radius of a plain function across modules | graph should win | 3/3 · 1.00 · 0.101 · 0.0 · 0.0 | 3/3 · 1.00 · 0.373 · 2.3 · 1.0 | 3/3 · 1.00 · 0.204 · 0.0 · 0.0 |
| T2 Every consumer of a JSX component, through barrels and an alias | JSX — graph count is a floor | 3/3 · 1.00 · 0.091 · 0.0 · 0.0 | 3/3 · 1.00 · 0.345 · 1.7 · 2.0 | 3/3 · 1.00 · 0.193 · 0.0 · 0.0 |
| T3 Users of an object-literal helper property | object-literal property — ACCESSES blind spot | 3/3 · 1.00 · 0.085 · 0.0 · 0.0 | 3/3 · 1.00 · 0.272 · 1.3 · 1.0 | 3/3 · 1.00 · 0.174 · 0.0 · 0.0 |
| T4 Callers of a method reached through context / props | DI / context dispatch | 3/3 · 1.00 · 0.110 · 0.0 · 0.0 | 3/3 · 1.00 · 0.326 · 1.0 · 1.0 | 3/3 · 0.98 · 0.216 · 0.0 · 0.0 |
| T5 Fix a bug in a linked worktree on a new branch | out of index scope (NS-26) | 3/3 · — · 0.082 · 0.0 · 0.0 | 3/3 · — · 0.495 · 3.0 · 0.0 | 3/3 · — · 0.284 · 0.0 · 0.0 |
| T6 Find where a config/CSS value is set | not a symbol question | 3/3 · 1.00 · 0.062 · 0.0 · 0.0 | 3/3 · 1.00 · 0.201 · 0.0 · 0.3 | 3/3 · 1.00 · 0.192 · 0.0 · 0.0 |
| T7 Rename a symbol that has namesakes | rename with collisions | 3/3 · — · 0.079 · 0.0 · 0.0 | 3/3 · — · 0.513 · 4.7 · 1.3 | 3/3 · — · 0.214 · 0.0 · 0.0 |
| T8 What a staged diff affects | detect_changes | 0/3 · 0.80 · 0.123 · 0.0 · 0.0 | 0/3 · 0.80 · 0.438 · 2.3 · 1.7 | 0/3 · 0.80 · 0.239 · 0.0 · 0.0 |
| T9 Who changes a field | field writes (ACCESSES write) | 3/3 · 1.00 · 0.081 · 0.0 · 0.0 | 3/3 · 1.00 · 0.359 · 1.7 · 1.3 | 3/3 · 1.00 · 0.192 · 0.0 · 0.0 |
| T10 Read a known long file and fix an off-by-one | cost of the read guard | 3/3 · — · 0.077 · 0.0 · 0.0 | 3/3 · — · 0.410 · 4.0 · 1.0 | 3/3 · — · 0.208 · 0.0 · 0.0 |

<details><summary>Failed runs, with what was missed</summary>

- T8 · off · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · teach · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —

</details>

### Decision rule (design §7, fixed before running)

- no shape-task (T2–T4, T9) regresses vs gates: **yes**
- overall pass rate ≥ gates: **yes**
- cost per passed task ≤ gates: **yes**
- beats off on T1/T7/T8: **NO**
- **verdict: back to design**


## Diagnosis — why teach made almost no graph calls (read before the verdict)

The verdict "back to design" is right, but the reason is not "agents ignore teaching": **in most runs
no moment fired at all.** A replayed T1 teach session produced no scorecard file — nothing shown,
nothing even silenced. Three causes, each verified:

1. **M2 never matched real searches.** Agents search through `Bash` (181 of the 60 runs' tool calls;
   in this Claude Code build `Grep` is not even available under `-p`), and their first search is an
   ALTERNATION — `git grep -nE "rateFor|quoteShipping"`. M2 only recognised a single plain identifier.
2. **The moments are tied to actions; the graph wins on questions.** M1 fires before an edit, M3
   before a commit. T1 ("I'm about to change rateFor…") and T8 ("what could this staged change
   affect?") are analysis tasks that never edit or commit, so no moment could fire. T8 is the one task
   where the graph changed correctness (gates/Sonnet 3/3 vs 0/3 everywhere else).
3. **The contract alone moved behaviour once:** Sonnet used `rename` on T7 in 3/3 teach runs — the
   most concrete "when X, use Y" line it carries. The rest of the guidance never reached a moment.

Cost, for the record: teach cut cost per passed run vs gates by 36% (Sonnet) and 43% (Opus), with
no correctness loss on any task except T8 — but it is still ~3× / ~2.4× the no-kit cost, and most of
that is the ~36 KB contract every session loads.

Fixture caveat: 60 files. Grep is nearly free at this size, so correctness differences are
understated everywhere except T8; a scale check is needed before any final call.
