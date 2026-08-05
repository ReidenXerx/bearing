#!/usr/bin/env node
// Claude Code PreToolUse (Bash) → staleness gate, plus detect_changes-before-commit gate.
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

const { classifyShell, classifyCommit } = await lib("classify.mjs");
const { gnContext, emitVerdict } = await lib("claude-emit.mjs");
const { isDetectUsed } = await lib("session-primer.mjs");

const ctx = gnContext(root);
const command = input.tool_input?.command ?? "";

let verdict = classifyShell({ command }, ctx);
if (verdict.decision === "allow") {
  const commit = classifyCommit(
    { command },
    { ...ctx, detectUsed: isDetectUsed(root) },
  );
  if (commit.decision === "deny") verdict = commit;
}
emitVerdict(verdict, { root, mode: ctx.config.mode });
