#!/usr/bin/env node
// Claude Code PreCompact → SIDE-EFFECT ONLY: count the compaction. Writes nothing anywhere else.
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
const { bumpScore } = await lib("session-primer.mjs");

// COUNT ONLY. This used to append a breadcrumb to `~/.claude/projects/<slug>/memory/MEMORY.md`,
// which is Claude Code's memory INDEX — loaded into every session, one pointer line per memory.
// Nothing read those stanzas back, so every compaction quietly bought a permanent tax on the
// window it was trying to protect. The task-core is the save-state that actually survives a
// compaction, and the agent owns it; the nudge already prompts a refresh before one lands.
bumpScore(root, "compactions"); // surfaced in bearing:stats
// No stdout: PreCompact has no valid context-injection channel; steering is handled by the
// contract + SessionStart(compact) recovery.
