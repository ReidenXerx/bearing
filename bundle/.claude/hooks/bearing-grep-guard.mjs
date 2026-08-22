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

// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let classifyGrep, gnContext, emitVerdict;
try {
  ({ classifyGrep } = await lib("classify.mjs"));
  ({ gnContext, emitVerdict } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0);
}

const ctx = gnContext(root);
const verdict = classifyGrep(
  { tool: input.tool_name ?? "", toolInput: input.tool_input ?? {} },
  ctx,
);
emitVerdict(verdict, { root, mode: ctx.config.mode });
