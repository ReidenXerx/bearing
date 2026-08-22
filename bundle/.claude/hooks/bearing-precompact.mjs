#!/usr/bin/env node
// Claude Code PreCompact → SIDE-EFFECT ONLY: checkpoint durable state to memory + log the compaction.
//
// PreCompact CANNOT inject context: Claude Code allows hookSpecificOutput.additionalContext only on
// UserPromptSubmit / PostToolUse / Stop / SubagentStop — NOT PreCompact (emitting it errors the hook).
// There's also no agent turn between this hook and the compaction. So the "preserve everything /
// lose nothing" steering lands elsewhere: the always-on contract keeps the memory current, and the
// SessionStart(source:compact) recovery brief reconciles it afterward. This hook writes no stdout.
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
let gnContext;
try {
  ({ gnContext } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0);
}
const { appendMemoryCheckpoint, isImpactUsed, isDetectUsed, bumpScore } =
  await lib("session-primer.mjs");

const ctx = gnContext(root);
bumpScore(root, "compactions"); // surfaced in gitnexus:stats
appendMemoryCheckpoint(
  root,
  `- trigger: ${input.trigger || "auto"} | index: ${ctx.phase} | gates: impact ${isImpactUsed(root) ? "done" : "pending"}, detect_changes ${isDetectUsed(root) ? "done" : "pending"}\n` +
    `- (transcript about to be summarized — task/decisions/open-items/file:line above must already be current)`,
);
// No stdout: PreCompact has no valid context-injection channel; steering is handled by the
// contract + SessionStart(compact) recovery.
