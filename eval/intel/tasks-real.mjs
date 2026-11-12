/**
 * The REAL round's tasks: three structural questions about a real repository (fixture-real.mjs).
 *
 * The prompt is identical in both conditions and never names ast-grep — the question is whether the
 * module makes the agent reach for the syntax tree, and whether that makes it right more often. Both
 * conditions carry the same bearing install; `on` adds only the `astgrep` module.
 *
 * Each task is a shape a regex gets wrong in a specific way: S1's SQL templates span lines, S2's
 * arguments nest parentheses, S3 needs "inside a catch" AND "does not mention a variable".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { realKeys, scoreSites, checkRadixRewrite, REAL_SCOPE, historyKey, privateKeys } from "./fixture-real.mjs";

const SCOPE = REAL_SCOPE.map((d) => `${d}/`).join(", ");
const LIST =
  "\n\nDo not modify any files. I want the complete list, not a sample. When you are done, finish with " +
  "ONE line in exactly this form:\n" +
  'ANSWER: ["path/to/file.ts:123", "path/to/other.ts:45"]\n' +
  "— a JSON array of repo-relative `path:line` entries, one per call, nothing after it.";

const pristineOf = (cwd) => `${cwd}.pristine`;

function answerList(text) {
  const m = String(text ?? "").match(/ANSWER:\s*(\[[\s\S]*?\])\s*$/m) ?? String(text ?? "").match(/ANSWER:\s*(\[[\s\S]*?\])/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Files the agent changed or added outside the scoped sources: scratch scripts left in the repo. */
function stray(cwd) {
  const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3))
    .filter((f) => !REAL_SCOPE.some((d) => f.startsWith(`${d}/`)));
}

function listTask(id, title, prompt, keyOf) {
  return {
    id,
    module: "astgrep",
    fixture: "real",
    title,
    steps: [prompt + LIST],
    verify(cwd, m) {
      const sites = keyOf(realKeys(pristineOf(cwd)));
      const reported = answerList(m.resultText);
      if (!reported) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      const s = scoreSites(reported, sites);
      return {
        pass: s.fn === 0 && s.fp === 0,
        found: s.tp,
        falsePositives: s.fp,
        precision: reported.length ? s.tp / (s.tp + s.fp) : 0,
        recall: sites.length ? s.tp / sites.length : 1,
        usedAstGrep: usedAstGrep(m),
        stray: stray(cwd).length,
        detail: `${s.tp}/${sites.length} found, ${s.fp} false positive(s)` +
          (s.missed.length ? `; missed ${s.missed.length}` : ""),
      };
    },
  };
}

/** Did the agent run ast-grep at all? From the event stream's Bash commands, never from bearing. */
export function usedAstGrep(m) {
  return (m.astGrepCalls ?? 0) > 0;
}

export const REAL_TASKS = [
  listTask(
    "S1",
    "Real repo: every SQL query built by template interpolation",
    `In ${SCOPE} find every call to a \`.query(...)\` method whose FIRST argument is a template literal ` +
      "that interpolates a value with `${…}` — SQL built by string interpolation instead of bound " +
      "parameters. A template literal with no `${…}` in it does not count, and neither does a plain string.",
    (k) => k.sqlInterp,
  ),
  {
    id: "S2",
    module: "astgrep",
    fixture: "real",
    title: "Real repo: a decided rewrite — radix 10 for every parseInt that has none",
    steps: [
      `In ${SCOPE}, every \`parseInt(x)\` or \`Number.parseInt(x)\` call that passes no radix must pass ` +
        "radix 10: `parseInt(x)` becomes `parseInt(x, 10)`. This is decided — apply it to every such call, " +
        "leave calls that already pass a radix alone, and change nothing else in any file. Do not commit.",
    ],
    verify(cwd, m) {
      const r = checkRadixRewrite(pristineOf(cwd), cwd);
      return {
        pass: r.converted === r.sites && r.wrongFiles.length === 0,
        found: r.converted,
        wrongFiles: r.wrongFiles.length,
        usedAstGrep: usedAstGrep(m),
        stray: stray(cwd).length,
        detail: `${r.converted}/${r.sites} converted` +
          (r.wrongFiles.length ? `; ${r.wrongFiles.length} file(s) differ from the decided change` : "; nothing else changed"),
      };
    },
  },
  listTask(
    "S3",
    "Real repo: every error log in a catch that drops the caught error",
    `In ${SCOPE} find every \`.error(...)\` call on a logger (any receiver whose name ends in \`logger\`, ` +
      "in any case — `this.logger`, `appLogger` and `Logger` all count) or on `console`, that sits inside a `catch` block and whose arguments never " +
      "mention the caught error variable — the places that log a failure but lose its message and stack. " +
      "A catch that binds no variable counts, since there is nothing to mention. Calls inside a function " +
      "or callback defined within the catch block do not count, and a nested catch is judged on its own.",
    (k) => k.catchDrops,
  ),
];


// ── history and knip (each its own `on` module) ─────────────────────────────

/** The history task's key is computed from the slot itself, so the prompt and the key agree. */
const H_KEYS = new Map();
function hKey(cwd) {
  const p = pristineOf(cwd);
  // Four lines when the history has them; two is still a question with a right and a wrong answer.
  if (!H_KEYS.has(p)) H_KEYS.set(p, historyKey(p, 4) ?? historyKey(p, 2));
  const k = H_KEYS.get(p);
  if (!k) throw new Error("no line in this repo's history is blamed to a reformat — the history task cannot run here");
  return k;
}

function answerObject(text) {
  const m = String(text ?? "").match(/ANSWER:\s*(\{[\s\S]*?\})/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Every file under the scope in the pristine copy that is gone from the working copy. */
function deletedUnder(cwd, scope) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(pristineOf(cwd), rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (!fs.existsSync(path.join(cwd, r))) out.push(r);
    }
  };
  for (const d of scope) if (fs.existsSync(path.join(pristineOf(cwd), d))) walk(d);
  return out.sort();
}

export const REAL_TASKS_TOOLS = [
  {
    id: "H1",
    module: "history",
    fixture: "real-history",
    title: "Real repo: where did these lines come from — behind a reformat",
    // The prompt never says a reformat is involved: noticing that is the thing measured.
    prompt(cwd) {
      const k = hKey(cwd);
      return `Before I change them, I want to know where some lines came from. In \`${k.file}\`, for each of ` +
        `lines ${k.lines.map((l) => l.line).join(", ")}: which commit introduced the code on that line, and what ` +
        "reason does the history give for it? Do not modify any files. When you are done, finish with ONE line " +
        "in exactly this form, using the full or a 7+ character commit hash:\n" +
        `ANSWER: {${k.lines.map((l) => `"${l.line}": "<commit>"`).join(", ")}}`;
    },
    verify(cwd, m) {
      const k = hKey(cwd);
      const a = answerObject(m.resultText);
      if (!a) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      let right = 0, formatter = 0;
      for (const l of k.lines) {
        const v = String(a[String(l.line)] ?? "").trim().toLowerCase();
        if (v.length >= 7 && l.origin.startsWith(v)) right++;
        else if (v.length >= 7 && l.formatter.startsWith(v)) formatter++;
      }
      return {
        pass: right === k.lines.length,
        found: right,
        namedTheReformat: formatter,
        blameCalls: m.blameCalls ?? 0,
        blamePastFormatCalls: m.blamePastFormatCalls ?? 0,
        detail: `${right}/${k.lines.length} origins right` + (formatter ? `; ${formatter} named the reformat commit` : ""),
      };
    },
  },
  {
    id: "U1",
    module: "knip",
    fixture: "real",
    title: "Real repo: delete the dead code — and nothing that is used",
    prompt() {
      const { knip } = privateKeys();
      const scope = knip.scope.map((d) => `${d}/`).join(" and ");
      return `Clean up dead code in ${scope}: delete every file there that nothing uses — not loaded at runtime, ` +
        "not by the build, not by any test or tool configured in this repo. Do not delete anything that is used. " +
        "Do not edit other files and do not commit. When you are done, list what you deleted.";
    },
    verify(cwd, m) {
      const { knip } = privateKeys();
      const gone = deletedUnder(cwd, knip.scope);
      const dead = new Set(knip.dead);
      const live = gone.filter((f) => !dead.has(f));
      const found = gone.filter((f) => dead.has(f)).length;
      return {
        pass: live.length === 0 && found === knip.dead.length,
        found,
        deletedLive: live.length,
        deletedMigrations: live.filter((f) => f.startsWith(knip.liveTraps.migrations)).length,
        knipCalls: m.knipCalls ?? 0,
        detail: `${found}/${knip.dead.length} dead deleted, ${live.length} LIVE deleted` +
          (live.length ? ` (${live.filter((f) => f.startsWith(knip.liveTraps.migrations)).length} migrations)` : ""),
      };
    },
  },
];
