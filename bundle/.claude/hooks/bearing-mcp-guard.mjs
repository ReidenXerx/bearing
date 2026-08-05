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

const { gnContext, emitVerdict } = await lib("claude-emit.mjs");
const { setMcpToolUsed, bumpScore } = await lib("session-primer.mjs");
const { classifyMcpDrift } = await lib("classify.mjs");

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
  // Drift gate (classifyMcpDrift enforces phase === "fresh" itself): on a commit-fresh index a
  // graph QUERY tool would return stale results that ignore the agent's uncommitted edits →
  // require a fast incremental refresh.
  const drift = classifyMcpDrift(tool, ctx.stale, ctx.config, ctx.phase);
  if (drift.decision === "deny") {
    emitVerdict(drift, { root, mode: ctx.config.mode });
  } else {
    // Record the graph call so the impact/detect gates clear; then allow silently.
    setMcpToolUsed(root, tool);
    bumpScore(root, "graphCalls");
  }
}
