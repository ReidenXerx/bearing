# Hard round — results (2026-11-12)

24 runs · models: sonnet · conditions: off (no bearing) vs on (default modules, no GitNexus).
Scored by checks the harness owns (`eval/intel/tasks-hard.mjs`), never by bearing's telemetry (NS-27).

## Per task

| Task | Module | off pass | on pass | found, mean (off → on) | off $ | on $ | off subagents | on subagents | flags (off → on) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K2 A ten-rule spec survives two compactions and two unrelated jobs | taskcore | 3/3 | 3/3 | 10.0 → 10.0 | 0.91 | 1.34 | 0.0 | 0.0 | — |
| M3 A finished billing feature with four semantic bugs | microscope | 3/3 | 3/3 | 4.0 → 4.0 | 0.08 | 0.16 | 0.0 | 0.0 | — |
| F2 200 jobs audited against a rule grep cannot apply | minions | 3/3 | 3/3 | 75.0 → 75.0 | 0.11 | 0.15 | 0.0 | 0.0 | — |
| I2 A decided change at 106 sites in seven shapes, 14 to leave alone | minions | 3/3 | 3/3 | 106.0 → 106.0 | 0.06 | 0.12 | 0.0 | 0.0 | — |

## Per module — the verdict

| Module | off pass | on pass | cost ratio on/off | verdict |
| --- | --- | --- | --- | --- |
| taskcore | 3/3 | 3/3 | 1.48× | REWORK (same outcome, more cost) |
| microscope | 3/3 | 3/3 | 2.04× | REWORK (same outcome, more cost) |
| minions | 6/6 | 6/6 | 1.58× | REWORK (same outcome, more cost) |

## Overall

- pass: off 12/12 (100%) · on 12/12 (100%)
- mean cost per run: off $0.289 · on $0.442 (1.53×)
- mean seconds per run: off 73 · on 74
- errored runs: off 0 · on 0

With 3 trial(s) per cell, one run moves a verdict. Read a CUT? as "look closer", never as "delete".

## Failures, verbatim


---

## Reading — written after the run, separate from the generated tables above

Run on 2026-11-12: sonnet, 3 trials, 24 runs, $8.77. Raw rows are in `results-sonnet-hard.jsonl`; this
file regenerates with `node eval/intel/report.mjs eval/intel/results-sonnet-hard.jsonl`. The one-trial
smoke run before it ($3.47) is in `results-sonnet-hard-smoke.jsonl`. It is kept apart: it ran before
the `measure()` fix below, so three of its rows undercount duration and turns, though not cost.

**These tasks were built to get past the first round's ceiling, and they did not.** Every run passed in
both conditions, and the partial-credit counts are identical. Under the rule written before the run,
task-core, microscope and minions come out REWORK: the same outcome at 1.5–2× the cost. Unlike the
first round, this is not "the instrument was too small". Each task was designed so that an agent
working serially should slip, and the base agent did not.

**What the agents did instead of slipping:**
- **F2 and I2 (200 files, 106 edits):** they wrote a script. Three to eight shell calls, never 200 reads
  one at a time. The moment minions are built for, a long serial grind, never happened. No run
  spawned a subagent, at any scale, in either condition.
- **K2 (ten rules, two compactions, a conflicting money format in between):** all ten rules held in all
  six runs. The compaction summary carried them.
- **M3 (four semantic bugs):** both conditions found and fixed all four, in about 30 seconds.

**The only errors were in F2: one per condition, across the smoke and the full run.** Both were
grep-shaped, and neither had anything to do with fan-out:
- The smoke's run without bearing missed the 12 jobs that pass no key at all; it looked only at
  calls that pass one.
- The full run's first trial with bearing flagged the 10 compliant jobs whose comment mentions
  `Date.now()`.

The smoke had shown 63/75 against 75/75. That did not reproduce: three more trials gave 75/75 in both
conditions.

**What this says (NS-23).** A module ships the moment it changes what the agent does. At this scale,
with this model, the moments task-core, microscope and minions claim did not arise, and their always-on
text cost about half as much again per task. This eval cannot tell whether those moments arise at a
scale it cannot cheaply build, such as multi-hour sessions, thousands of files, or units that need
judgment rather than a script. It does establish that the modules are not free, and that the evidence
for them still has to come from somewhere other than tasks like these.

**One instrument bug, found by the smoke and fixed before this run.** When an agent starts a
background command, Claude Code wakes it again when the command finishes, and that extra turn emits a
second `result` event. `measure()` read only the last one. A probe showed `total_cost_usd` is
cumulative, while turns, duration and usage are per segment. Every result is now counted, and the
answer keeps every result's text (`lib/kit.test.mjs`). The first round's 106 rows show no sign of the
bug.

**Caveats.** Sonnet only, a synthetic repo, 3 trials, headless sessions.

**What this suggests next:**
1. **Per-module ablation:** turn on one module at a time, to see which module's text costs what.
2. **Trim the always-on text** for these three modules down to their trigger sentence, keeping the
   skills, and re-measure the cost. If nothing here needed them, their price should at least be small.
3. **Look for the moment in real sessions** rather than synthetic ones: real transcripts where a
   compaction lost something, or a serial pass missed sites. Not telemetry counts (NS-27).
