#!/usr/bin/env node
// Claude Code PreToolUse (mcp__gitnexus__*) → record graph usage; refresh-first when stale.
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
let gnContext, emitVerdict, setMcpToolUsed, bumpScore, classifyMcpDrift, classifyGraphBehind;
try {
  ({ gnContext, emitVerdict } = await lib("claude-emit.mjs"));
  ({ setMcpToolUsed, bumpScore } = await lib("session-primer.mjs"));
  ({ classifyMcpDrift, classifyGraphBehind } = await lib("classify.mjs"));
} catch {
  process.exit(0);
}

const ctx = gnContext(root);
const tool = input.tool_name ?? "";

if (ctx.phase === "must_refresh") {
  emitVerdict(
    {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "stale.must_refresh",
    },
    { root, mode: ctx.config.mode },
  );
} else {
  // Two gates, one shape. `graph_behind` is HEAD moved by fewer source files than the threshold;
  // drift is the working tree moved by fewer. Both mean the graph would answer from code that is no
  // longer there, and neither is a reason to take away Read/Grep. (classifyMcpDrift enforces
  // phase === "fresh" itself, so it stays inert on the other phases.)
  const drift =
    ctx.phase === "graph_behind"
      ? classifyGraphBehind(tool, ctx.stale)
      : classifyMcpDrift(tool, ctx.stale, ctx.config, ctx.phase);
  if (drift.decision === "deny") {
    emitVerdict(drift, { root, mode: ctx.config.mode });
  } else {
    // Record the graph call so the impact/detect gates clear; then allow silently.
    setMcpToolUsed(root, tool);
    bumpScore(root, "graphCalls");
  }
}
