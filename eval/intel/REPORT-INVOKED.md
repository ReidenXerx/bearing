# Invoked round — results (2026-11-12)

6 runs · models: sonnet · conditions: off (no bearing) vs on (default modules, no GitNexus).
Scored by checks the harness owns (`eval/intel/tasks.mjs`), never by bearing's telemetry (NS-27).

## Per task

| Task | Module | off pass | on pass | found, mean (off → on) | off $ | on $ | off subagents | on subagents | flags (off → on) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 A requested review panel: six bugs to fix, four decoys to leave alone | microscope | 1/1 | 1/1 | 6.0 → 6.0 (decoys broken 0.0 → 0.0) | 0.26 | 0.67 | 3.0 | 2.0 | fannedOut 1→1 |
| G1 A requested fan-out: 200 jobs audited against one rule | minions | 1/1 | 1/1 | 75.0 → 75.0 | 0.10 | 1.09 | 0.0 | 10.0 | fannedOut 0→1 |
| I3 A requested fan-out of a decided change: 106 sites, 14 to leave alone | minions | 1/1 | 1/1 | 106.0 → 106.0 | 0.17 | 1.10 | 4.0 | 8.0 | fannedOut 1→1 |

## Per module — the verdict

| Module | off pass | on pass | cost ratio on/off | verdict |
| --- | --- | --- | --- | --- |
| microscope | 1/1 | 1/1 | 2.54× | REWORK (same outcome, more cost) |
| minions | 2/2 | 2/2 | 8.11× | REWORK (same outcome, more cost) |

## Overall

- pass: off 3/3 (100%) · on 3/3 (100%)
- mean cost per run: off $0.178 · on $0.952 (5.36×)
- mean seconds per run: off 33 · on 78
- errored runs: off 0 · on 0

With 1 trial(s) per cell, one run moves a verdict. Read a CUT? as "look closer", never as "delete".

## Failures, verbatim


---

## Reading — written after the run, separate from the generated tables above

Run on 2026-11-12: sonnet, **one trial per cell**, 6 runs, $3.39. Raw rows are in
`results-sonnet-invoked-smoke.jsonl`; this file regenerates with
`node eval/intel/report.mjs eval/intel/results-sonnet-invoked-smoke.jsonl`. It is a smoke run, kept as a
record. More trials were declined, so read every number here as one sample.

**What this round asks.** After #40, microscope and minions run only when the user asks for them, and
NS-23 judges a user-invoked module by whether, *once invoked*, it does the job better than the agent's
own way. So every prompt here asks for the review or the fan-out by name ("microscope this", "use
minions"), in both conditions. The fixture (`fixture-invoked.mjs`) adds `src/settlement/` to the hard
fixture: six bugs to fix and four decoys that look wrong but are specified behaviour.

**Correctness: identical.** Both conditions fixed all six bugs in R1 and broke none of the decoys,
found the 75 violating jobs in G1, and made all 106 edits in I3 while leaving the 14 exceptions alone.

**Cost: 2.5× for the review, about 8× for fan-out.** The `on` runs followed the skills: G1 spawned
10 subagents where the base agent wrote one script; I3 spawned 8, each in its own git worktree.

**Behaviour the scorer does not count, read from the transcripts:**
- **I3, off:** while splitting the file list, the agent deleted stale `/tmp/batch_*` files outside the
  repository. They were scratch files, but nothing asked it to touch them.
- **I3, on:** each slice was edited in an isolated worktree, and the agent compared every landed file
  against an independently written version of the transform before accepting it.
- **R1, both:** both made the same change the spec did not ask for — a zero-cent payout is no longer
  written to the ledger — and both said so in their summary. The `on` run listed it with a one-line
  revert; neither asked first. The decoy checks did not cover this case.

**What this says.** At this scale, once invoked, the skills did the job *as well as* the agent's own
way, more carefully in I3, and at several times the cost. With one trial that is a direction, not a
verdict.
