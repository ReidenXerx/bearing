# The rule modules — do they change the code an agent writes?

**Question.** `tsjs`, `frontend` and `react` add numbered rules to the contract. Does an agent with them
write *better* code than one without — and is it the rule that does it, not just more instruction text?

**Answer, in one line.** `tsjs` and `frontend` do, in the case each rule is written for, and the
ablation credits the rule itself; `react` changed the code's structure but no defect was ever
measured in its absence, so it claims nothing.

## Design

- **Fixtures.** Synthetic repos in `fixture-rules.mjs`: round 1 (`rulesFiles`) and the harder
  `rulesHardFiles`, built after round 1 tied to plant each trap where it is not obvious.
- **Conditions.** Every arm carries bearing's default install. `on` adds all three rule modules;
  round 3 adds `only` (the task's module alone) and `placebo` (the OTHER two, without it). Each slot is
  refused unless it carries exactly its own modules' contract sections.
- **Prompts** name no rule and no trap.
- **Graders** grade the defect: TS tasks **run** the agent's loader against a payload the server could
  really send; TSX tasks read the wiring (no node_modules). `graders.selftest.mjs` runs every grader
  against solutions of known verdict — 29 of 29 right, and it fails (exit 1) when an old grader bug is
  put back (NS-9). Every row keeps the code it graded.
- **Rows.** `results-sonnet-rules.jsonl`, `results-{sonnet,haiku}-rules-hard.jsonl`,
  `results-{sonnet,haiku}-ablation.jsonl`.

## Round 1 — the trap in plain sight (Sonnet, 3 trials, $1.19)

| Task | off | on |
| --- | --- | --- |
| TS1 a typed loader over a helper returning `unknown` | 3/3 | 3/3 |
| FE1 a table page, with the shared `<DataGrid>` used by the page next door | 3/3 | 3/3 |
| RX1 one controlled field in a react-hook-form form | 3/3 | 3/3 |

**No difference**, at +44% cost per run. `unknown` forces a guard, the grid was imported next door,
one field leaves nothing to copy: a strong model needs no rule for an obvious case.

## Round 2 — the case each rule is written for (Sonnet and Haiku, 3 trials, $1.39)

| Task | Sonnet off | Sonnet on | Haiku off | Haiku on |
| --- | --- | --- | --- | --- |
| **TS2** a typed loader over a legacy client typed `Promise<any>`; run on a payload missing `totalCents` | 0/3 | **3/3** | 0/3 | **3/3** |
| **FE2** a table page; the shared table is `ListView` in `src/components/layout/`, used only from `src/screens/` | 0/3 | **3/3** | 2/3 | **3/3** |
| RX2 three controlled phone fields in one form | 3/3 | 3/3 | 3/3 | 3/3 |

- **TS2.** Without the module every run returned the legacy client's `any` straight through as an
  `Invoice`. With it every run held the response as `unknown`, guarded the shape, and threw.
- **FE2.** Without it Sonnet wrote its own `<table>` all three times; with it every run found
  `ListView` by shape and reused it.
- **RX2 — a tie, corrected.** Round 2 first graded "exactly one `Controller`" and reported Haiku
  0/3 → 3/3. That key was REACT-1's own wording — the tool under test wrote it (NS-27). Regraded on
  the defect (fields connected, `ref` kept, all three present and required), every run of both arms
  passes: Haiku-off wrote the `Controller` three times, and the code worked. The module did change
  the structure — Haiku wrote one field component only with it (Sonnet did either way), and `name`
  was typed `FieldPath<…>` in 6/6 `on` runs vs 0/6 `off` — but no defect was measured without it.

## Round 3 — is it the rule, or more text? (Sonnet and Haiku, 3 trials, $1.93)

Four arms per task. `placebo` carries the other two rule modules — the same kind and roughly the same
amount of added contract text, minus the rule the task needs. The slots no longer name their arm (round
2's starter north-stars heading did: "on-rules-hard"); that leak is gone here.

| Task | Model | off | placebo | only | on |
| --- | --- | --- | --- | --- | --- |
| TS2 | Sonnet | 0/3 | 0/3 | **3/3** | **3/3** |
| TS2 | Haiku | 0/3 | 0/3 | **3/3** | 2/3 |
| FE2 | Sonnet | 0/3 | 0/3 | **3/3** | **3/3** |
| FE2 | Haiku | 2/3 | 2/3 | **3/3** | **3/3** |

**The placebo changes nothing; the rule alone does all of it.** The one miss (Haiku TS2 `on` #3)
returned the legacy client's result unchecked, the same code the `off` arm writes.

## Verdict

- **`tsjs`** — when the client at the boundary is typed `any`: off and placebo **0/18** across rounds
  2–3, the rule present **17/18**. When the boundary is honestly `unknown` (round 1), no difference.
- **`frontend`** — when the shared component sits far away under a name that does not say what it
  is: Sonnet **0/9 → 9/9**; Haiku mostly finds it anyway (6/9 → 9/9).
- **`react`** — no measured benefit. It changes how the wiring is structured; the bug it targets
  (a dropped `ref`) did not happen in any of 24 runs without it.
- **Cost** — `on` costs +27–83% per run on these tasks, paid on every task in a stack the rules don't
  cover; that is why they stay opt-in.

## Limits

- The round 2–3 fixtures were built after round 1 tied, to plant the case each rule describes. They
  show the rule works on that case; they say nothing about how often it comes up in a real repo, and
  no real repo has replicated these yet.
- One task per module, 3 trials per cell.
- No task tests a rule's "not when" case, so the cost of over-applying a rule is unmeasured.
