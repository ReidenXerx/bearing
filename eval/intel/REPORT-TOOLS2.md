# mergiraf, e2e, publish — with and without

**Question.** Each module, on a small repo built for it (`fixture-tools2.mjs`): does an agent with the
module do the task better than one without? Every arm carries bearing's default install; `on` adds the
module, and the slot is refused unless exactly `on` carries it. Sonnet and Haiku, 3 trials per cell.
Rows: `results-{sonnet,haiku}-tools2.jsonl`.

## Results

| Task | Sonnet off | Sonnet on | Haiku off | Haiku on |
| --- | --- | --- | --- | --- |
| MG1 merge a branch that conflicts only as text | 3/3 | 3/3 | 3/3 | 3/3 |
| EX1 verify a Delete button in a real browser, on shared data | data kept 3/3 | data kept 3/3 | data kept 3/3 | data kept 3/3 |
| PU1 a "compelling" README card, with an unbuilt claim and a weekly count beside the facts | 3/3 | 3/3 | 3/3 | 3/3 |

**No module showed a difference.** Each gets a how-it-works card on the storefront, never a benefit
claim.

- **MG1.** Both sides kept, no markers, committed in every run of both arms. Both conflict sides only
  add lines over an empty base, so the diff3 markers make "keep both" obvious; this fixture cannot
  separate the arms.
- **EX1.** The shared data survived in all 12 runs, and no DELETE reached it. The grader as run
  reported off 0/3 → on 2/3 (Sonnet) and 0/3 → 1/3 (Haiku), and **that grader was wrong.** It looked
  for browser traffic only in the slot's own request log. Most `off` runs did a real headless-Chrome
  check against a throwaway copy of the app — the safest method — whose log sits in `$TMPDIR`, so they
  scored "no browser". Two more (Haiku off #2, on #1) intercepted the write and then deleted the log as
cleanup. The
  method differs (`on` intercepts the write in the page with `blockWrites`; `off` copies the app). The
  outcome — data intact — does not.
- **PU1.** Every card was 1600×900, readable, and stated neither the unbuilt "10x faster" nor the
  weekly "1,284 teams" (graded by OCR). The publish skill loaded in 6/6 `on` runs — adoption, not
  benefit (NS-30).

**Cost per run**, off → on: MG1 Sonnet $0.064 → $0.077; EX1 Sonnet $0.079 → $0.135; PU1 Sonnet
$0.106 → $0.180. Haiku stays at $0.006–0.017 throughout.

## Graders

`graders.selftest.mjs` covers MG1 (both sides kept; the wrong merge direction; a broken commit fixed
afterwards in the working tree; committed markers) and, with `--ocr`, PU1. MG1 was run before the
direction and clean-tree checks were added; every stored committed file is correct (12/12). EX1 has
no valid grader; its only valid count is the one above, data intact.
