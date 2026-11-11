/**
 * Score a final `ANSWER: ["path", …]` line against a key: precision, recall, F1. A pass is F1 ≥ 0.9.
 * Shared by the eval harnesses so a list task means the same thing in every report.
 */
import path from "node:path";

export function scoreList(text, key, cwd) {
  const line = String(text ?? "").split("\n").reverse().find((l) => /^\s*ANSWER:/.test(l));
  if (!line) return { pass: false, precision: 0, recall: 0, f1: 0, answer: null, detail: "no ANSWER line" };
  let arr;
  try {
    arr = JSON.parse(line.replace(/^\s*ANSWER:\s*/, ""));
  } catch {
    return { pass: false, precision: 0, recall: 0, f1: 0, answer: null, detail: "ANSWER is not JSON" };
  }
  if (!Array.isArray(arr)) return { pass: false, precision: 0, recall: 0, f1: 0, answer: null, detail: "ANSWER is not an array" };
  const norm = (p) => {
    let s = String(p).trim().replace(/\\/g, "/");
    if (path.isAbsolute(s)) s = path.relative(cwd, s).split(path.sep).join("/");
    return s.replace(/^\.\//, "");
  };
  const got = [...new Set(arr.map(norm))];
  const hit = got.filter((g) => key.includes(g)).length;
  const precision = got.length ? hit / got.length : 0;
  const recall = key.length ? hit / key.length : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    pass: f1 >= 0.9,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    answer: got,
    detail: `missed: ${key.filter((k) => !got.includes(k)).join(", ") || "—"} · wrong: ${got.filter((g) => !key.includes(g)).join(", ") || "—"}`,
  };
}
