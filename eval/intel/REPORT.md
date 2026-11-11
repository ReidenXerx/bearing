# Judgment-layer eval — results

90 runs · models: sonnet · conditions: off (no bearing) vs on (default modules, no GitNexus).
Scored by checks the harness owns (`eval/intel/tasks.mjs`), never by bearing's telemetry (NS-27).

## Per task

| Task | Module | off pass | on pass | off $ | on $ | off subagents | on subagents | flags (off → on) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N1 A stale doc contradicts a north-star | northstars | 0/5 | 5/5 | 0.01 | 0.05 | 0.0 | 0.0 | flagged 0→5 |
| N2 A request for an idea the graveyard rejected | northstars | 0/5 | 5/5 | 0.02 | 0.04 | 0.0 | 0.0 | flagged 4→5 |
| K1 Constraints agreed in conversation survive a compaction | taskcore | 5/5 | 5/5 | 0.13 | 0.30 | 0.0 | 0.0 | — |
| C1 A business rule only the user can decide | consult | 0/5 | 0/5 | 0.04 | 0.08 | 0.0 | 0.0 | invented 5→5 |
| C2 A convention the repo already answers | consult | 0/5 | 5/5 | 0.03 | 0.07 | 0.0 | 0.0 | — |
| M1 A finished feature with a semantic bug across files | microscope | 5/5 | 5/5 | 0.04 | 0.09 | 0.0 | 0.0 | — |
| M2 A one-line change gets no review panel | microscope | 5/5 | 5/5 | 0.01 | 0.04 | 0.0 | 0.0 | — |
| F1 A 28-caller trace with decoys | minions | 5/5 | 5/5 | 0.03 | 0.06 | 0.0 | 0.0 | — |
| I1 A decided change at 24 sites, with shapes to leave alone | minions | 5/5 | 5/5 | 0.03 | 0.08 | 0.0 | 0.0 | — |

## Per module — the verdict

| Module | off pass | on pass | cost ratio on/off | verdict |
| --- | --- | --- | --- | --- |
| northstars | 0/10 | 10/10 | 2.59× | KEEP |
| taskcore | 5/5 | 5/5 | 2.27× | REWORK (same outcome, more cost) |
| consult | 0/10 | 5/10 | 2.36× | KEEP |
| microscope | 10/10 | 10/10 | 2.87× | REWORK (same outcome, more cost) |
| minions | 10/10 | 10/10 | 2.28× | REWORK (same outcome, more cost) |

## Overall

- pass: off 25/45 (56%) · on 40/45 (89%)
- mean cost per run: off $0.038 · on $0.090 (2.40×)
- mean seconds per run: off 14 · on 22
- errored runs: off 0 · on 0

With 5 trial(s) per cell, one run moves a verdict. Read a CUT? as "look closer", never as "delete".

## Failures, verbatim

- N1 off #1: fee(100.00 − 20.00 discount) = 290 (net 232, gross 290) — followed the stale doc
- N2 off #1: gateway.capture called 2× on a transient error (1 = no blind retry)
- C1 off #1: did not ask; wrote an allocation anyway
- C1 on #1: did not ask; wrote an allocation anyway
- C2 off #1: got ["€1,234.56","¥500","-$0.05"] (want ["EUR 1234.56","JPY 500","-USD 0.05"])
- N1 off #2: fee(100.00 − 20.00 discount) = 290 (net 232, gross 290) — followed the stale doc
- N2 off #2: gateway.capture called 2× on a transient error (1 = no blind retry)
- C1 on #2: did not ask; wrote an allocation anyway
- C1 off #2: did not ask; wrote an allocation anyway
- C2 off #2: got ["€1,234.56","¥500","-$0.05"] (want ["EUR 1234.56","JPY 500","-USD 0.05"])
- N1 off #3: fee(100.00 − 20.00 discount) = 290 (net 232, gross 290) — followed the stale doc
- N2 off #3: gateway.capture called 2× on a transient error (1 = no blind retry)
- C1 off #3: did not ask; wrote an allocation anyway
- C1 on #3: did not ask; wrote an allocation anyway
- C2 off #3: got ["€1,234.56","¥500","-$0.05"] (want ["EUR 1234.56","JPY 500","-USD 0.05"])
- N1 off #4: fee(100.00 − 20.00 discount) = 290 (net 232, gross 290) — followed the stale doc
- N2 off #4: gateway.capture called 2× on a transient error (1 = no blind retry)
- C1 on #4: did not ask; wrote an allocation anyway
- C1 off #4: did not ask; wrote an allocation anyway
- C2 off #4: got ["€1,234.56","¥500","-$0.05"] (want ["EUR 1234.56","JPY 500","-USD 0.05"])
- N1 off #5: fee(100.00 − 20.00 discount) = 290 (net 232, gross 290) — followed the stale doc
- N2 off #5: gateway.capture called 2× on a transient error (1 = no blind retry)
- C1 off #5: did not ask; wrote an allocation anyway
- C1 on #5: did not ask; wrote an allocation anyway
- C2 off #5: got ["€1,234.56","¥500","-$0.05"] (want ["EUR 1234.56","JPY 500","-USD 0.05"])

---

## Reading — written after the run, separate from the generated tables above

Run on 2026-11-11: sonnet, 5 trials, 90 runs, $5.75 in total. Raw rows are in `results-sonnet.jsonl`; this
file regenerates with `node eval/intel/report.mjs eval/intel/results-sonnet.jsonl`. The results were almost
perfectly deterministic: every cell is 0/5 or 5/5.

**What bearing changed, and why.**
- **North-stars decided both of their tasks: 0/10 → 10/10.**
  - N1: without bearing, the agent followed `docs/FEES.md` and charged the fee on the gross every time.
    With bearing, it charged on the net and said the doc was stale.
  - N2: without bearing, the agent added the retry the graveyard rejected, every time. In four of
    five runs it warned in the same answer that a retry could double-charge, and added the retry anyway.
    With bearing, it declined and cited the rejection.

  The repo held the right answer in both conditions (the `off` slot has the same
  `.bearing/northstars.md` and `docs/decisions/`). What bearing added is the precedence: the contract
  says which source wins. That is the module's whole claim, and it held.
- **C2 (a convention the repo answers): 0/5 → 5/5.** Without bearing, the agent produced a locale
  format (`€1,234.56`), using `src/money/currencies.ts` but never mentioning `docs/STYLE.md` (the rows do
  not record which files it opened, so "never read" is not claimed); with bearing, it followed the documented
  format every time.
  **The cause is not isolated.** The task is credited to consult, but GP-15 ("never ask a person what
  the source can answer") and the contract's read-first framing all push the same way, and this run
  had every default module on at once.

**Where bearing changed nothing that this instrument can see.**
- **C1 (a rule only the user can decide): 0/5 in both.** Consult's own trigger is "ask when you are
  about to INVENT a requirement". Here the requirement was a refund allocation policy, and every run,
  in both conditions, invented one: pro rata, largest remainder.
  - With bearing, the agent listed "Questions for you" or "assumptions you may want to change"
    *after* writing the code.
  - Without bearing, it stated its assumptions the same way.

  The module's distinctive behaviour, stopping to ask, did not happen once. This is the clearest
  rework signal in the run. One caveat: these are headless `claude -p` sessions, and an agent may
  infer that nobody is there to answer. The task tells it nothing either way.
- **K1, M1, M2, F1, I1: 5/5 in both conditions. These tasks were too easy to discriminate.**
  - **K1:** after a real `/compact` (one `compact_boundary` per run), all five constraints held in both
    conditions; the summary alone carries them at this session length.
  - **M1:** both found the VAT bug in one read.
  - **F1, I1:** 28 callers and 29 files fit in one agent's head, so neither condition ever spawned a
    subagent. I1 was done with a single script in both conditions.

  Under the pre-registered rule, task-core, microscope and minions come out as REWORK (same outcome,
  more cost). That is the rule applied as written, but read it as *not measured*, not as *measured and
  found wanting*: the instrument did not reach the scale these modules are for.

**Cost.** `on` cost 2.4× per run here ($0.090 vs $0.038, 22 s vs 14 s). On tasks this small, the
fixed price of the always-on contract and the hooks dominates the ratio. The extra is ~5 cents per
task in absolute terms, and the ratio would shrink on real work. The per-module cost ratios above are
the whole kit's overhead charged to each module in turn, because this run had every module on at
once. They do not say what any single module costs.

**What this says to do next.**
1. **Rework consult's trigger.** Right now it produces after-the-fact questions, not asking first.
2. **A second round with harder variants of the ceiling tasks,** so task-core, microscope and minions
   can be measured at all:
   - a K1 whose constraints are spread across a longer session;
   - a subtler M1;
   - F1 and I1 at hundreds of sites.
3. **Per-module ablation** (`on` with one module at a time). That is the only way to say what each
   module costs, and which one moved C2.
