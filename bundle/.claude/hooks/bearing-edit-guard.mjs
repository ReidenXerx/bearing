#!/usr/bin/env node
// Claude Code PreToolUse (Edit|Write|MultiEdit) → staleness + impact-before-edit gate.
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

const { classifyEdit } = await lib("classify.mjs");
const { gnContext, emitVerdict } = await lib("claude-emit.mjs");
const { isImpactUsed } = await lib("session-primer.mjs");

const ctx = gnContext(root);
const verdict = classifyEdit(
  { toolInput: input.tool_input ?? {} },
  { ...ctx, impactUsed: isImpactUsed(root) },
);
emitVerdict(verdict, { root, mode: ctx.config.mode });
