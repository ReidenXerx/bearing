#!/usr/bin/env node
// Claude Code PostToolUse → nudge the agent to refresh its TASK-CORE once enough UNSAVED work has
// accumulated.
//
// WHY NOT CONTEXT PERCENTAGE. This hook used to fire at ~90% of the context window, and the window
// is not knowable at runtime. The transcript does not record it, the model id does not settle it
// (`claude-opus-5` is the same string on a 200k session and a 1M one), and the one real
// measurement — `compactMetadata.preTokens` — only arrives AFTER a compaction has already happened.
// Two shipped attempts at inferring it were wrong in opposite directions: a hardcoded 200k made
// every 1M session read as 300% full and cry compaction from the first hour, and the correction for
// that could not reach the band it was written for. A gate on a number we cannot measure produces
// confident false alarms, which is worse than no gate (NS-5).
//
// WHAT REPLACES IT. The task-core exists so a long task survives compaction with its decisions
// intact. What makes losing it expensive is not how full the window is — it is HOW MUCH HAS
// HAPPENED THAT IS NOT WRITTEN DOWN. Five edits at 95% lose almost nothing; two hundred at 30% lose
// a great deal. Fullness was always a proxy for unsaved work, and a proxy we could not even
// measure. So count the work directly: edits since the task-core was last written.
//
// The reset signal is the core file's own mtime, so there is no second counter to fall out of sync
// with it — write the core and the count restarts by construction.
//
// LIMITATION, stated rather than hidden: a long research phase produces conclusions worth saving
// and makes no edits, so it will not trigger this. That case is the cheaper one — the code is still
// there to re-read — and the contract still asks for a core at a milestone regardless.
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

const tool = input.tool_name || "";
// Only tools that CHANGE the repo. A Read or a Grep produces nothing that a compaction could lose.
const EDITS = new Set(["Write", "Edit", "NotebookEdit"]);
if (!EDITS.has(tool)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

let config;
let sp;
try {
  const { loadHookConfig } = await lib("hook-helpers.mjs");
  config = loadHookConfig(root);
  sp = await lib("session-primer.mjs");
} catch {
  process.exit(0); // no kit lib → nothing to do
}

const every = Number(config.taskCoreEveryEdits);
if (!(every > 0)) process.exit(0); // 0 disables

const STATE = path.join(root, ".bearing/.bearing-taskcore-edits.json");

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
    return { edits: Number(s.edits) || 0, coreAt: Number(s.coreAt) || 0 };
  } catch {
    return { edits: 0, coreAt: 0 };
  }
}
function write(s) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch {
    /* unwritable → the nudge is best-effort, never a failure (NS-8) */
  }
}

const key = sp.sessionKey(input.transcript_path);
const corePath = sp.taskCorePath(root, key);
let coreAt = 0;
try {
  coreAt = fs.statSync(corePath).mtimeMs;
} catch {
  /* no core yet */
}

const state = read();
// The core was (re)written since we last looked — the count restarts from the file itself, so
// there is no separate "reset" to forget.
if (coreAt > state.coreAt) {
  write({ edits: 0, coreAt });
  process.exit(0);
}

state.edits += 1;
if (state.edits < every) {
  write(state);
  process.exit(0);
}
write({ edits: 0, coreAt });

// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let emitContext;
try {
  ({ emitContext } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0);
}
try {
  sp.bumpScore(root, "taskCoreNudges");
} catch {
  /* no scorecard → nothing to count */
}

emitContext(
  `· ${every} edits since your TASK-CORE was last written${coreAt ? "" : " (there isn't one yet)"}. ` +
    `Refresh \`${corePath}\` — GOAL · CONSTRAINTS · DECISIONS(+why) · STATE(done/now/NEXT) · ` +
    "ANCHORS(file:line) · GOTCHAS(what you already tried that failed) · OPEN-Qs. Terse, for you, " +
    "not for a human. A compaction can land at any time and the transcript does not survive it; " +
    "this file is what does. REWRITE it rather than appending — drop finished steps whose outcome " +
    "is now in the code, and resolved questions; git already keeps the log. Skip it if the task " +
    "has not moved.",
  "PostToolUse",
);
