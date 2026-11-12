# Real-repo round: ast-grep — results (2026-11-12)

18 runs · models: sonnet · conditions: off (bearing with the repo's own modules) vs on (the same, plus `astgrep`).
Scored by checks the harness owns (`eval/intel/tasks.mjs`), never by bearing's telemetry (NS-27).

## Per task

| Task | Module | off pass | on pass | found, mean (off → on) | off $ | on $ | off subagents | on subagents | flags (off → on) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 Real repo: every SQL query built by template interpolation | astgrep | 3/3 | 3/3 | 22.0 → 22.0 | 0.08 | 0.09 | 0.0 | 0.0 | — |
| S2 Real repo: a decided rewrite — radix 10 for every parseInt that has none | astgrep | 3/3 | 3/3 | 74.0 → 74.0 | 0.13 | 0.13 | 0.0 | 0.0 | — |
| S3 Real repo: every error log in a catch that drops the caught error | astgrep | 3/3 | 0/3 | 28.0 → 25.3 | 0.08 | 0.14 | 0.0 | 0.0 | — |

## Per module — the verdict

| Module | off pass | on pass | cost ratio on/off | verdict |
| --- | --- | --- | --- | --- |
| astgrep | 9/9 | 6/9 | 1.19× | CUT? |

## Overall

- pass: off 9/9 (100%) · on 6/9 (67%)
- mean cost per run: off $0.099 · on $0.117 (1.19×)
- mean seconds per run: off 22 · on 36
- errored runs: off 0 · on 0

With 3 trial(s) per cell, one run moves a verdict. Read a CUT? as "look closer", never as "delete".

## Failures, verbatim

- S3 on #1: 25/28 found, 0 false positive(s); missed 3
- S3 on #2: 26/28 found, 0 false positive(s); missed 2
- S3 on #3: 25/28 found, 0 false positive(s); missed 3

---

## Reading — written after the run, separate from the generated tables above

Run on 2026-11-12: sonnet, 3 trials, 18 runs, $1.94, plus a one-trial smoke ($0.85) that calibrated
the instrument. The repository is a private NestJS + TypeORM backend, 650 JS/TS files in scope; its
name, paths and code are deliberately absent here, and the raw rows stay on the machine that ran them.
Both conditions carry the same bearing install with the repo's own recorded modules. `on` adds only
`astgrep`. The answer key comes from the TypeScript compiler's parser, not from ast-grep (NS-27).

**The tasks** (prompts in `tasks-real.mjs`, identical in both conditions, never naming ast-grep):
- **S1:** every `.query(…)` whose first argument is a template literal with `${…}`. 22 of 890
  calls; 15 span several lines.
- **S2:** a decided rewrite: radix 10 for every `parseInt` that has none. 74 sites in 24 files,
  checked token by token, so formatting is free but any other change fails.
- **S3:** every logger or `console` `.error(…)` inside a `catch` whose arguments never mention the
  caught variable. 28 of 205.

**Adoption worked.** Every `on` run (9/9) loaded the `bearing-astgrep` skill and ran ast-grep. That
is the opposite of NS-29, where teaching the graph produced almost no use. A contract section plus a
skill is enough to make an agent reach for a tool whose fit it can see.

**It did not make the agent more right.** The `off` agent passed 9 of 9: it wrote its own scripts
and got every site in every task. `on` matched it on S1 and S2 and **failed S3 in all three
trials**, missing 2–3 sites each time. Under the rule written before the run, that is **CUT?**:
`on` passes fewer than `off`.

**Why S3 failed — the useful part.** S3 is not a question about shape. "Does this call mention the
caught variable" is about **bindings**, and ast-grep has no clean way to say "the same identifier as
the catch parameter". A bare `catch ($E) { … }` is not valid code, so it matches nothing, silently.
The agents fell back to matching text inside the node. That miscounted two calls whose message
interpolates a different variable whose name starts with `error`, and (in two of three trials) one
call where the word appears only in a string. The `off` agent parsed the code and compared
identifiers, and never made that mistake.

**Cost:** 1.19× per run and 1.6× the wall time, for no gain where it was right.

**What this says (NS-23).** On this repository, with this model, the module changes what the agent
does but not how often it is right, and where the question is about bindings rather than shape it
makes the agent worse. Two things this round cannot tell: whether a weaker model, which does not
write its own parser scripts, would gain; and whether a repo too large for ad-hoc scripts would.
The skill's own advice was missing one rule this run makes plain: **a question about bindings,
references or types is not a shape question — use the language's compiler API, not ast-grep.**
