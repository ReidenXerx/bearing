#!/usr/bin/env node
// Claude Code PreToolUse (Read) → block large source reads; route to query/context.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
        return fs.existsSync(abs)
          ? fs.readFileSync(abs, "utf8").split("\n").length
          : 0;
      } catch {
        return 0;
      }
    },
  },
);
emitVerdict(verdict, { root, mode: ctx.config.mode });
