# Teaching-mode eval — baseline

Generated 2026-11-06T16:44Z from 120 runs. Fixture: `eval/teaching/fixture.mjs`;
answer keys hand-built and re-derived by text (`verify-keys.mjs`), never from the graph (NS-27).
All measures come from Claude Code's own stream-json events, identically for every condition.

## sonnet

| | **off** | **gates** |
| --- | --- | --- |
| passed | 27/30 | 30/30 |
| mean cost / run (USD) | 0.029 | 0.164 |
| cost per PASSED run (USD) | 0.033 | 0.164 |
| mean tokens / run | 70995 | 368176 |
| mean tool calls / run | 2.8 | 8.1 |
| mean graph calls / run | 0.0 | 3.1 |
| mean hook denials / run | 0.0 | 0.9 |
| mean wall time (s) | 17 | 44 |
| harness errors | 0 | 0 |

| task | shape | off: pass · F1 · $ · graph · denials | gates: pass · F1 · $ · graph · denials |
| --- | --- | --- | --- |
| T1 Blast radius of a plain function across modules | graph should win | 3/3 · 1.00 · 0.025 · 0.0 · 0.0 | 3/3 · 1.00 · 0.133 · 4.7 · 1.0 |
| T2 Every consumer of a JSX component, through barrels and an alias | JSX — graph count is a floor | 3/3 · 1.00 · 0.024 · 0.0 · 0.0 | 3/3 · 1.00 · 0.129 · 2.3 · 1.0 |
| T3 Users of an object-literal helper property | object-literal property — ACCESSES blind spot | 3/3 · 1.00 · 0.025 · 0.0 · 0.0 | 3/3 · 1.00 · 0.136 · 3.3 · 1.0 |
| T4 Callers of a method reached through context / props | DI / context dispatch | 3/3 · 1.00 · 0.035 · 0.0 · 0.0 | 3/3 · 1.00 · 0.142 · 1.0 · 1.0 |
| T5 Fix a bug in a linked worktree on a new branch | out of index scope (NS-26) | 3/3 · — · 0.035 · 0.0 · 0.0 | 3/3 · — · 0.273 · 3.7 · 1.0 |
| T6 Find where a config/CSS value is set | not a symbol question | 3/3 · 1.00 · 0.018 · 0.0 · 0.0 | 3/3 · 1.00 · 0.082 · 0.0 · 0.3 |
| T7 Rename a symbol that has namesakes | rename with collisions | 3/3 · — · 0.035 · 0.0 · 0.0 | 3/3 · — · 0.274 · 6.0 · 1.3 |
| T8 What a staged diff affects | detect_changes | 0/3 · 0.80 · 0.043 · 0.0 · 0.0 | 3/3 · 0.97 · 0.170 · 2.3 · 1.0 |
| T9 Who changes a field | field writes (ACCESSES write) | 3/3 · 1.00 · 0.026 · 0.0 · 0.0 | 3/3 · 1.00 · 0.156 · 4.7 · 1.3 |
| T10 Read a known long file and fix an off-by-one | cost of the read guard | 3/3 · — · 0.029 · 0.0 · 0.0 | 3/3 · — · 0.150 · 2.7 · 0.3 |

<details><summary>Failed runs, with what was missed</summary>

- T8 · off · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —

</details>

## opus

| | **off** | **gates** |
| --- | --- | --- |
| passed | 27/30 | 27/30 |
| mean cost / run (USD) | 0.089 | 0.373 |
| cost per PASSED run (USD) | 0.099 | 0.415 |
| mean tokens / run | 85720 | 390808 |
| mean tool calls / run | 3.3 | 8.2 |
| mean graph calls / run | 0.0 | 2.2 |
| mean hook denials / run | 0.0 | 1.1 |
| mean wall time (s) | 22 | 48 |
| harness errors | 0 | 0 |

| task | shape | off: pass · F1 · $ · graph · denials | gates: pass · F1 · $ · graph · denials |
| --- | --- | --- | --- |
| T1 Blast radius of a plain function across modules | graph should win | 3/3 · 1.00 · 0.101 · 0.0 · 0.0 | 3/3 · 1.00 · 0.373 · 2.3 · 1.0 |
| T2 Every consumer of a JSX component, through barrels and an alias | JSX — graph count is a floor | 3/3 · 1.00 · 0.091 · 0.0 · 0.0 | 3/3 · 1.00 · 0.345 · 1.7 · 2.0 |
| T3 Users of an object-literal helper property | object-literal property — ACCESSES blind spot | 3/3 · 1.00 · 0.085 · 0.0 · 0.0 | 3/3 · 1.00 · 0.272 · 1.3 · 1.0 |
| T4 Callers of a method reached through context / props | DI / context dispatch | 3/3 · 1.00 · 0.110 · 0.0 · 0.0 | 3/3 · 1.00 · 0.326 · 1.0 · 1.0 |
| T5 Fix a bug in a linked worktree on a new branch | out of index scope (NS-26) | 3/3 · — · 0.082 · 0.0 · 0.0 | 3/3 · — · 0.495 · 3.0 · 0.0 |
| T6 Find where a config/CSS value is set | not a symbol question | 3/3 · 1.00 · 0.062 · 0.0 · 0.0 | 3/3 · 1.00 · 0.201 · 0.0 · 0.3 |
| T7 Rename a symbol that has namesakes | rename with collisions | 3/3 · — · 0.079 · 0.0 · 0.0 | 3/3 · — · 0.513 · 4.7 · 1.3 |
| T8 What a staged diff affects | detect_changes | 0/3 · 0.80 · 0.123 · 0.0 · 0.0 | 0/3 · 0.80 · 0.438 · 2.3 · 1.7 |
| T9 Who changes a field | field writes (ACCESSES write) | 3/3 · 1.00 · 0.081 · 0.0 · 0.0 | 3/3 · 1.00 · 0.359 · 1.7 · 1.3 |
| T10 Read a known long file and fix an off-by-one | cost of the read guard | 3/3 · — · 0.077 · 0.0 · 0.0 | 3/3 · — · 0.410 · 4.0 · 1.0 |

<details><summary>Failed runs, with what was missed</summary>

- T8 · off · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #1: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #2: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · off · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —
- T8 · gates · #3: missed: apps/admin/src/pages/Payouts.tsx, apps/admin/src/pages/Taxes.tsx · wrong: —

</details>

