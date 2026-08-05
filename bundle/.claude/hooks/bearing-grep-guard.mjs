#!/usr/bin/env node
// Claude Code PreToolUse (Grep|Glob) → route symbol/field/broad searches to GitNexus.
// Thin glue over the shared classify core; Claude protocol mapping in claude-emit.mjs.
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

const { classifyGrep } = await lib("classify.mjs");
const { gnContext, emitVerdict } = await lib("claude-emit.mjs");

const ctx = gnContext(root);
const verdict = classifyGrep(
  { tool: input.tool_name ?? "", toolInput: input.tool_input ?? {} },
  ctx,
);
emitVerdict(verdict, { root, mode: ctx.config.mode });
