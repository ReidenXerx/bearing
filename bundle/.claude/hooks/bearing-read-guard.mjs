#!/usr/bin/env node
// Claude Code PreToolUse (Read) → block large source reads; route to query/context.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Count lines only until the threshold is exceeded. The guard just needs "is this bigger than N",
 * but it read the ENTIRE file to find out — measured at 398ms and ~230MB RSS on a 54MB source file,
 * on a hook that runs before every Read. Streams a bounded window instead and stops early.
 * @param {string} file @param {number} threshold
 */
function countLinesBounded(file, threshold) {
  const CHUNK = 64 * 1024;
  const buf = Buffer.allocUnsafe(CHUNK);
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return 0; // unreadable → fail open, same as before
  }
  let lines = 1;
  let pos = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      if (lines > threshold) break; // already over — no need to read the rest
    }
  } catch {
    return 0;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  return lines;
}

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* empty */
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) =>
  import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

const { classifyRead } = await lib("classify.mjs");
const { gnContext, emitVerdict } = await lib("claude-emit.mjs");
const { readPromptHint } = await lib("session-primer.mjs");

const ti = input.tool_input ?? {};
const filePath = ti.file_path ?? ti.path ?? "";
const ctx = gnContext(root);
const verdict = classifyRead(
  { toolInput: ti },
  {
    ...ctx,
    promptHint: readPromptHint(root),
    readLines: () => {
      try {
        const abs = path.resolve(root, filePath);
        // ctx.config, NOT a bare `config` — no such binding exists in this file. The ReferenceError
        // it threw was swallowed by this very catch and reported as "0 lines", so no file was ever
        // large enough to gate and the read guard never fired once. Same shape as the shell guard's
        // swallowed ReferenceError: a throw inside a fail-open path is indistinguishable from a
        // clean allow, so the gate dies silently while every allow-case test keeps passing.
        return fs.existsSync(abs)
          ? countLinesBounded(abs, ctx.config.readLineThreshold)
          : 0;
      } catch {
        return 0;
      }
    },
  },
);
emitVerdict(verdict, { root, mode: ctx.config.mode });
