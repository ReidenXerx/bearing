#!/usr/bin/env node
// Claude Code PreToolUse (Read) → block large source reads; route to query/context.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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

// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let classifyRead, gnContext, emitVerdict, readPromptHint;
try {
  ({ classifyRead } = await lib("classify.mjs"));
  ({ gnContext, emitVerdict } = await lib("claude-emit.mjs"));
  ({ readPromptHint } = await lib("session-primer.mjs"));
} catch {
  process.exit(0);
}

const ti = input.tool_input ?? {};
const filePath = ti.file_path ?? ti.path ?? "";
const ctx = gnContext(root);
const verdict = classifyRead(
  { toolInput: ti },
  {
    ...ctx,
    promptHint: readPromptHint(root),
    // Called ONLY when the guard is about to block, so this git call never touches the fast path.
    isUntracked: () => {
      try {
        const { spawnSync } = require("node:child_process");
        const rel = path.relative(root, path.resolve(root, filePath));
        // OUT OF REPO ⇒ UNTRACKED, for our purposes. This returned false, which KEEPS the deny — the
  // comment says "not our business" while the gate is actively blocking. An absolute path outside
  // the project root is the strongest possible evidence the index cannot contain the file, so it is
  // the one case that most needs the escape, not the one that least needs it (NS-5).
  if (!rel) return false;
  if (rel.startsWith("..")) return true;
        const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], {
          cwd: root,
          encoding: "utf8",
        });
        return r.status !== 0; // non-zero → git does not track it → the index cannot hold it
      } catch {
        return false; // unknown → keep the gate (fail closed on the graph, NS-8)
      }
    },
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
