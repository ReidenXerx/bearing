# The tool round — `history` and `knip` on a real repository

**Question.** Do the two new opt-in modules change what agents do on a real codebase, and does that make
them more right (NS-30: adoption is not benefit, measure both)?

**Repository.** A private NestJS + TypeORM backend: about 650 JS/TS files and 1,700 commits. Nothing
from it is committed here. The tasks that name its files are built at run time; the dead-code key is
hand-verified and kept outside this repository. Raw rows stay in `~/.cache/bearing-eval/intel/`.

**Conditions.** Both carry the repository's own bearing install. `on` adds one module: `history` for H1,
`knip` for U1. The prompts are identical and name neither tool. 3 trials per cell, Sonnet and Haiku,
24 runs, **$1.81** in total.

## The tasks

| | Task | Key |
| --- | --- | --- |
| **H1** | "Before I change them, I want to know where some lines came from": four lines of one service file, the commit that introduced each and the reason given. | Computed at run time. Plain `git blame` names a Prettier commit for all four lines. The key is the commit `--ignore-rev` reaches, checked independently: that commit's own diff must add the line (whitespace and commas ignored), and its subject must not be a reformat. |
| **U1** | "Clean up dead code in `src/` and `lib/`: delete every file that nothing uses … do not delete anything that is used." | Hand-verified. 8 dead files: three DTOs, two barrel `index.ts` files nobody imports, an unused prompt helper, a filter and an interceptor registered nowhere. Each was checked by searching its file stem and every exported name across the repo. Live files that knip calls unused: 114 migrations, an entity loaded by the ORM config's glob, a constants file imported only by a migration, and four tests run by a second jest config. |

Both graders are tested on a synthetic repo. They pass the right answer and fail the formatter's commit,
an empty or 4-character hash, a deleted migration, and an empty deletion.

## Results

| | Sonnet off | Sonnet on | Haiku off | Haiku on |
| --- | --- | --- | --- | --- |
| **H1** origins right | 3/3 | 3/3 | 3/3 | 3/3 |
| H1 skill loaded | — | 3/3 | — | 2/3 |
| **U1** pass (all 8 dead, nothing live) | 2/3 | **3/3** | 2/3 | **3/3** |
| U1 live files deleted, per run | 0, 1, 0 | 0, 0, 0 | 0, 2, 0 | 0, 0, 0 |
| U1 skill loaded | — | 3/3 | — | 3/3 |
| U1 mean cost | $0.195 | $0.175 | $0.024 | $0.024 |

Every U1 run in both conditions deleted all 8 dead files. No run deleted a migration.

## What it means

**`history`: no measured benefit on this task.** Agents without the module looked past the
Prettier commit on their own: every run used `--ignore-rev` or re-blamed from a parent, and every run
named all four origins. The module was adopted (5 of 6 runs loaded the skill) and changed nothing,
because the baseline already did the right thing. The trap is real (plain blame is wrong on all four
lines), but this model generation does not fall into it when asked directly. The module's claimed
value, checking history *before* changing unexplained code nobody asked about, is not what H1 asked,
and no single-question task measures it. **It stays opt-in.**

**`knip`: the skill prevents harm; finding the dead code was never the problem.** Agents without
the module ran knip themselves (every Sonnet run) and found all 8 dead files. Two of six runs also
deleted live files: one on Sonnet, two files on Haiku. None were migrations, so the glob-loaded
entity, the migration-only constants file and the second jest config are the likely candidates (paths
were not recorded, by design). With the module: 6 of 6 runs passed, and nothing live was deleted. The
sample is small (6 vs 4 of 6). The direction matches the skill's whole claim, that knip's list is
candidates, not a verdict, and the cost is no higher.

**Default?** Not on this evidence alone. knip applies only to JS/TS repos, the same reason `tsjs` is
opt-in. The harm it prevented showed up in 2 of 6 runs.

## Found while building it (NS-11)

- **`-w` does not see through Prettier.** Prettier re-wraps lines, which is not a whitespace change.
  44 of the 45 lines one Prettier commit touched still blamed to it with `-w`. The skill and contract
  taught `-w` as the fix; they now teach `--ignore-rev <sha>`, and the test runs a re-wrap.
- **knip needs Node `^20.19 || >=22.12`.** Below that it crashes with nothing on stdout and exits 1,
  the same exit code as "found something". bearing's own CI runs Node 22.9.0 and caught it (#55).
- **A constants file imported only by a migration** looks dead to knip: the migration looks dead, so
  everything only it imports does too. A file-stem search finds the reference; knip's graph cannot.
- **Task id collision.** The knip task was first named `K1`, an id the base round already used, so
  `--tasks tools` prepared that round's slots as well. The runner now refuses duplicate ids.
