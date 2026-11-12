/**
 * The INVOKED round: the user asks for the panel or the fan-out, in plain words, in BOTH conditions.
 *
 * Microscope and minions are user-invoked since #40, and NS-23 now judges a user-invoked module by its
 * method: once asked, does bearing's skill do the job better than the agent's own way of doing the
 * same thing? So the ask is identical across conditions and names no bearing skill — "run a panel of
 * reviewer subagents", "fan this out across subagents" — and the only difference is whether the skill
 * is installed. Scored by the harness, never shown to the agent, by RUNNING the code where there is
 * code to run.
 */
import { runTs } from "./tasks.mjs";
import { i2Wrong } from "./tasks-hard.mjs";
import { hardKeys } from "./fixture-hard.mjs";
import { R1_BUGS, R1_DECOYS, R1_PROBES } from "./fixture-invoked.mjs";
import { scoreList } from "../lib/score-list.mjs";

const H = hardKeys();
const ANSWER =
  "\n\nDo not modify any files. When you are done, finish with ONE line in exactly this form:\n" +
  'ANSWER: ["path/one.ts", "path/two.ts"]\n' +
  "— a JSON array of repo-relative file paths, nothing after it.";

/** Which planted bugs are fixed, and which decoys still behave as documented. */
export function r1Score(cwd) {
  const ok = (name) => {
    const r = runTs(cwd, R1_PROBES[name]);
    return r.ok && r.value === true;
  };
  const fixed = R1_BUGS.filter(ok);
  const broken = R1_DECOYS.filter((d) => !ok(d));
  return { fixed, broken };
}

export const INVOKED_TASKS = [
  {
    id: "R1",
    module: "microscope",
    fixture: "invoked",
    title: "A requested review panel: six bugs to fix, four decoys to leave alone",
    steps: [
      "Do a deep review of src/settlement/ before I ship it — run a panel of reviewer subagents over it — " +
        "and fix whatever is actually wrong. Keep the exported function signatures and types as they are.",
    ],
    verify(cwd, m) {
      const { fixed, broken } = r1Score(cwd);
      return {
        pass: fixed.length === R1_BUGS.length && broken.length === 0,
        found: fixed.length,
        broken: broken.length,
        brokeDecoy: broken.length > 0,
        fannedOut: m.subagents > 0,
        detail: `fixed ${fixed.length}/${R1_BUGS.length}` +
          (fixed.length < R1_BUGS.length ? ` (missed ${R1_BUGS.filter((b) => !fixed.includes(b)).join(", ")})` : "") +
          (broken.length ? `; BROKE ${broken.join(", ")}` : "; no decoy broken"),
      };
    },
  },
  {
    id: "G1",
    module: "minions",
    fixture: "invoked",
    title: "A requested fan-out: 200 jobs audited against one rule",
    steps: [
      "Audit every job in src/jobs/ against the rule in docs/IDEMPOTENCY.md and list every job file whose " +
        "`postIdempotent` call breaks it. Fan this out: split src/jobs/ across subagents, a batch of files " +
        "each, and combine what they find." + ANSWER,
    ],
    verify(cwd, m) {
      const s = scoreList(m.resultText, H.jobViolators, cwd);
      return { ...s, found: Math.round((s.recall ?? 0) * H.jobViolators.length), fannedOut: m.subagents > 0 };
    },
  },
  {
    id: "I3",
    module: "minions",
    fixture: "invoked",
    title: "A requested fan-out of a decided change: 106 sites, 14 to leave alone",
    steps: [
      "Every route handler in src/routes/ must be audited. The change is decided — apply it exactly:\n" +
        "- in each route file, import `withAudit` from \"../audit.ts\"\n" +
        "- wrap the whole body of the exported `handle` so every call runs through " +
        "`withAudit(\"<name>\", async () => <the original body's result>)`, where <name> is the file name " +
        "without `.ts`. Behaviour must not change.\n" +
        "- leave alone: routes already wrapped in withAudit, the routes listed in ROUTE_EXCLUDED in " +
        "src/routes/policy.ts, and any `handleBatch` export (it is audited through `handle`)\n" +
        "Don't change anything else. Fan it out: split the route files across subagents, each applying " +
        "the change to its own batch.",
    ],
    verify(cwd, m) {
      const { loaded, wrong } = i2Wrong(cwd);
      const badRoutes = new Set(wrong.map((w) => w.split(":")[0]));
      return {
        pass: wrong.length === 0,
        found: loaded ? H.routesToWrap.filter((n) => !badRoutes.has(n)).length : 0,
        fannedOut: m.subagents > 0,
        detail: wrong.length ? wrong.slice(0, 6).join("; ") + (wrong.length > 6 ? ` … +${wrong.length - 6}` : "") : "all 120 routes right",
      };
    },
  },
];
