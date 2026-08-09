#!/usr/bin/env node
/**
 * Check that cited `file:line` references exist and say what is actually there.
 *
 * A minion's report is testimony until something confirms it, and the one failure the FOUND /
 * CHECKED / MISSED shape cannot catch on its own is a citation that was never real — a plausible
 * path, a plausible line number, nothing there. "Spot-check one per minion" was advice, and advice
 * is a claim nothing verifies (NS-20). This makes it mechanical.
 *
 * Deliberately NOT an npm script: every npm script is owned by the gitnexus module, so a
 * minions-only install would be told to run something it does not have — the same defect
 * `npm run bearing:northstars` shipped with.
 *
 *   node .bearing/lib/verify-citations.mjs src/a.ts:88 src/b.ts:12
 *   ... | node .bearing/lib/verify-citations.mjs        # reads FOUND lines from stdin
 *
 * Exit 0 = every citation resolved. Exit 1 = at least one did not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `path/to/file.ts:88`, optionally wrapped in a FOUND line or backticks. */
const CITATION = /([\w./@-]+\.[\w]+):(\d+)/g;

/** @param {string} text @returns {{file: string, line: number}[]} deduped, in order */
export function parseCitations(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(CITATION)) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: m[1], line: Number(m[2]) });
  }
  return out;
}

/**
 * @param {{file: string, line: number}} c @param {string} root
 * @returns {{ok: boolean, file: string, line: number, text?: string, reason?: string}}
 */
export function checkCitation(c, root = process.cwd()) {
  const abs = path.resolve(root, c.file);
  let src;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    return { ...c, ok: false, reason: "no such file" };
  }
  const lines = src.split("\n");
  // A line number past the end is the shape a fabricated citation usually takes: right file,
  // invented position.
  if (c.line < 1 || c.line > lines.length) {
    return { ...c, ok: false, reason: `file has ${lines.length} lines` };
  }
  return { ...c, ok: true, text: lines[c.line - 1].trim() };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const text = args.length ? args.join("\n") : await readStdin();
  const citations = parseCitations(text);
  if (!citations.length) {
    console.error("No file:line citations found. Pass them as arguments or on stdin.");
    process.exitCode = 1;
  } else {
    let bad = 0;
    for (const c of citations) {
      const r = checkCitation(c);
      if (r.ok) {
        console.log(`  ✓ ${r.file}:${r.line}  ${r.text.slice(0, 96)}`);
      } else {
        bad++;
        console.log(`  ✗ ${r.file}:${r.line}  — ${r.reason}`);
      }
    }
    // The count is the point: "3 of 12 citations do not resolve" is a verdict about the REPORT,
    // not about the code.
    console.log(
      bad
        ? `\n  ${bad}/${citations.length} citations did not resolve — treat that report as unverified.`
        : `\n  all ${citations.length} citations resolved.`,
    );
    if (bad) process.exitCode = 1;
  }
}
