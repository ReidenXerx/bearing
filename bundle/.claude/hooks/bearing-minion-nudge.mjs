#!/usr/bin/env node
// Claude Code PostToolUse → notice SERIAL GRINDING and nudge toward a fan-out.
//
// The fan-out trigger lives in the always-on contract, which means it fires when the agent happens
// to recall it. Everything this kit does well is enforced at the tool call instead: the moment the
// agent is on its ninth Read in a row is the moment "you should have fanned out" is actionable,
// and a doc read an hour ago is not.
//
// Nudges, never blocks (NS-5) — reading files serially is legitimate, just often wasteful, and a
// deny here would be a false one. Bounded work per call (NS-7): one small JSON read/write, a capped
// list, no transcript scan.
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
const tool = input.tool_name || "";

// The gathering tools. A fan-out replaces a RUN of these, so they are what we count.
const GATHER = new Set(["Read", "Grep", "Glob"]);
// The WRITING tools. A run of these across distinct files is the invasive shape: the same edit,
// applied by hand, one file at a time. Counted separately because the two runs mean different
// things and point at different skills — and because a long read run followed by a long edit run is
// the single most common way this work actually arrives.
const WRITE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Any of these means work is already being delegated — stop counting, the agent is doing the
// right thing and a nudge now would be noise.
const DELEGATE = new Set(["Task", "Agent"]);
if (!GATHER.has(tool) && !WRITE.has(tool) && !DELEGATE.has(tool)) process.exit(0);

const STATE = path.join(root, ".bearing/.bearing-minion-scan.json");
const MAX_TRACKED = 40; // cap the distinct-target list; NS-7

const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);
let config;
try {
  ({ loadHookConfig: config } = await lib("hook-helpers.mjs"));
  config = config(root);
} catch {
  process.exit(0); // no kit lib → nothing to do
}
const threshold = Number(config.minionFanoutThreshold);
if (!(threshold > 0)) process.exit(0); // 0 disables

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
    return {
      seen: Array.isArray(s.seen) ? s.seen : [],
      nudged: s.nudged === true,
      // Absent in state written by an older version — default rather than throw (NS-8).
      wrote: Array.isArray(s.wrote) ? s.wrote : [],
      nudgedWrite: s.nudgedWrite === true,
    };
  } catch {
    return { seen: [], nudged: false, wrote: [], nudgedWrite: false };
  }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch {
    /* unwritable → the nudge is best-effort, never a failure */
  }
}

/** Best-effort tally; a counter must never be the thing that breaks a tool call (NS-8). */
async function bump(key) {
  try {
    const { bumpScore } = await lib("session-primer.mjs");
    bumpScore(root, key);
  } catch {
    /* no scorecard → nothing to count */
  }
}

const state = readState();

if (DELEGATE.has(tool)) {
  // Already delegating. Clear the run, but KEEP `nudged` — one nudge per session is the budget,
  // and re-arming it here would nag every time a fan-out ends.
  writeState({ seen: [], nudged: state.nudged, wrote: [], nudgedWrite: state.nudgedWrite });
  // Counted so the module can be MEASURED rather than assumed. Fan-outs against grind-nudges is
  // the honest question — is this changing behaviour, or just talking? Same reason the gates keep
  // a scorecard instead of asserting they help.
  await bump("minionFanouts");
  process.exit(0);
}

// Count DISTINCT targets. Re-reading one file while editing it is not grinding; touching nine
// different ones is. `undefined` for a Grep without a path still counts as one distinct unit.
const inp = input.tool_input || {};
const target = String(inp.file_path ?? inp.path ?? inp.pattern ?? tool);
const writing = WRITE.has(tool);
// EDITS COUNT ONLY WHEN THEY NAME A FILE. Without a path there is no way to tell one edit from the
// next, and a run of `undefined` would nudge on a single file edited repeatedly — which is ordinary
// iteration, not the shape this points at.
const run = writing ? state.wrote : state.seen;
if (writing && !inp.file_path) {
  writeState(state);
  process.exit(0);
}
if (!run.includes(target)) run.push(target);
if (run.length > MAX_TRACKED) run.splice(0, run.length - MAX_TRACKED);

const already = writing ? state.nudgedWrite : state.nudged;
if (run.length < threshold || already) {
  writeState(state);
  process.exit(0);
}

if (writing) state.nudgedWrite = true;
else state.nudged = true;
writeState(state);
await bump(writing ? "minionInvasiveNudges" : "minionGrindNudges");

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
emitContext(
  writing
    ? `· You have edited ${state.wrote.length} different files in a row by hand. If the remaining ` +
        "work is the SAME decided change applied at more independent sites — logging coverage, an " +
        "error envelope, the rest of a settled migration — fan it out instead of grinding: load " +
        "the `bearing-invasive-minions` skill. One subagent per DISJOINT slice (two writing the " +
        "same file silently lose a write), each applying the transformation exactly as specified " +
        "and returning WROTE / VERIFIED / SKIPPED / FAILED. They apply; YOU decided, and you " +
        "review the whole diff. Ignore this if each site needs its own judgment, if the sites " +
        "interact, or if the tree has unrelated uncommitted work in it."
    : `· You have gathered from ${state.seen.length} different targets in a row without delegating. ` +
        "If the remaining work is a LIST of similar, independent lookups — every call site, every " +
        "file still on the old API, every route to check against one rule — fan it out instead of " +
        "grinding: load the `bearing-minions` skill. One anchored subagent per unit, on a middle " +
        "tier, each returning FOUND file:line / CHECKED / MISSED. They gather; YOU conclude. " +
        "Ignore this if the work is sequential, needs your judgment per step, or is nearly done.",
  "PostToolUse",
);
