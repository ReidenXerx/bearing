/**
 * The code-intelligence round's tasks. Every target — the class, the method, the function, the
 * interface — comes from a hand-verified key OUTSIDE this repository (it names a private repo's code),
 * so the prompts are assembled at run time and nothing from that repo is committed here (NS-27: the key
 * was written by reading every mention by hand, never by a tool under test).
 *
 * The four questions are chosen to separate the tools, not to flatter any of them:
 *   T1  every call site of a method reached through constructor DI — the shape a graph built from
 *       syntax alone does not resolve, and a language server does;
 *   T2  which public methods of that class are never called — the honest answer is "none", so a tool
 *       blind to DI reports live methods as dead, the false negative that turns into a deletion;
 *   T3  which classes implement an interface — a control every tool should get right;
 *   T4  which call sites must change if a function gains a required parameter — plain imports, where
 *       graphs are strong, and a comment that mentions the call so a text search over-reports.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scoreSites } from "../intel/fixture-real.mjs";

export function codeintelKey() {
  const p = process.env.BEARING_EVAL_KEYS ?? path.join(process.env.HOME ?? "", ".cache/bearing-eval/intel/real-keys.json");
  if (!fs.existsSync(p)) throw new Error(`the code-intel round needs its hand-verified key at ${p}`);
  const k = JSON.parse(fs.readFileSync(p, "utf8")).codeintel;
  if (!k) throw new Error(`${p} has no codeintel section`);
  const repo = process.env.BEARING_EVAL_REPO;
  const head = repo ? execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : null;
  if (head && head !== k.head) throw new Error(`the key was verified at ${k.head.slice(0, 7)}, the repo is at ${head.slice(0, 7)} — re-verify it`);
  return k;
}

const ANSWER = (shape) =>
  "\n\nDo not modify any files. I want the complete answer, not a sample. When you are done, finish with " +
  `ONE line in exactly this form:\nANSWER: ${shape}\n— nothing after it.`;

export function answerArray(text) {
  const t = String(text ?? "");
  const m = t.match(/ANSWER:\s*(\[[\s\S]*?\])\s*$/m) ?? t.match(/ANSWER:\s*(\[[\s\S]*?\])/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

const sitesOf = (list) => list.map((s) => ({ file: s.slice(0, s.lastIndexOf(":")), lines: [Number(s.slice(s.lastIndexOf(":") + 1))] }));
const SITES = 'ANSWER: ["path/to/file.ts:123", "path/to/other.ts:45"] — repo-relative `path:line`, one per call, the line where the called name appears';

export const CODEINTEL_TASKS = [
  {
    id: "C1",
    title: "Every call site of a method reached through constructor injection",
    prompt: (k) =>
      `List every call site of \`${k.t1.cls}.${k.t1.method}\` in ${k.t1.scope} — every place that calls this method ` +
      "on an instance of that class, however the instance was obtained." + ANSWER(SITES.replace(/^ANSWER: /, "")),
    verify(k, text) {
      const got = answerArray(text);
      if (!got) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      const s = scoreSites(got, sitesOf(k.t1.sites));
      return { pass: s.fn === 0 && s.fp === 0, found: s.tp, falsePositives: s.fp, detail: `${s.tp}/${k.t1.sites.length} found, ${s.fp} false positive(s)` };
    },
  },
  {
    id: "C2",
    title: "Which public methods of an injected class are never called",
    prompt: (k) =>
      `In \`${k.t2.file}\`, which PUBLIC methods of \`${k.t2.cls}\` are never called anywhere in production code ` +
      "(src/, not *.spec.ts) — candidates for deletion? An empty list is a valid answer." +
      ANSWER('["methodName", "otherMethod"] — method names only, or [] if every public method is called'),
    verify(k, text) {
      const got = answerArray(text);
      if (!got) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      const wrong = got.filter((m) => !k.t2.dead.includes(m));
      return { pass: wrong.length === 0 && k.t2.dead.every((m) => got.includes(m)), falseDead: wrong.length, detail: wrong.length ? `${wrong.length} live method(s) reported dead` : "no live method reported dead" };
    },
  },
  {
    id: "C3",
    title: "Which classes implement an interface (control)",
    prompt: (k) => `Which classes implement the interface \`${k.t3.iface}\`?` + ANSWER('["ClassName", "OtherClass"] — class names only'),
    verify(k, text) {
      const got = answerArray(text);
      if (!got) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      const want = new Set(k.t3.implementers);
      const right = got.filter((c) => want.has(c)).length;
      return { pass: right === want.size && got.length === want.size, found: right, detail: `${right}/${want.size} implementers, ${got.length - right} extra` };
    },
  },
  {
    id: "C4",
    title: "The blast radius of a signature change to an imported function",
    prompt: (k) =>
      `If \`${k.t4.fn}\` in \`${k.t4.file}\` gets a new REQUIRED second parameter, which call sites must change? ` +
      `Scope: ${k.t4.scope}.` + ANSWER(SITES.replace(/^ANSWER: /, "")),
    verify(k, text) {
      const got = answerArray(text);
      if (!got) return { pass: false, found: 0, detail: "no parseable ANSWER line" };
      const s = scoreSites(got, sitesOf(k.t4.sites));
      return { pass: s.fn === 0 && s.fp === 0, found: s.tp, falsePositives: s.fp, detail: `${s.tp}/${k.t4.sites.length} found, ${s.fp} false positive(s)` };
    },
  },
];
