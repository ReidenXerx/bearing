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
// Any of these means work is already being delegated — stop counting, the agent is doing the
// right thing and a nudge now would be noise.
const DELEGATE = new Set(["Task", "Agent"]);
if (!GATHER.has(tool) && !DELEGATE.has(tool)) process.exit(0);

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
    return { seen: Array.isArray(s.seen) ? s.seen : [], nudged: s.nudged === true };
  } catch {
    return { seen: [], nudged: false };
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
  writeState({ seen: [], nudged: state.nudged });
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
if (!state.seen.includes(target)) state.seen.push(target);
if (state.seen.length > MAX_TRACKED) state.seen = state.seen.slice(-MAX_TRACKED);

if (state.seen.length < threshold || state.nudged) {
  writeState(state);
  process.exit(0);
}

state.nudged = true;
writeState(state);
await bump("minionGrindNudges");

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
  `· You have gathered from ${state.seen.length} different targets in a row without delegating. ` +
    "If the remaining work is a LIST of similar, independent lookups — every call site, every file " +
    "still on the old API, every route to check against one rule — fan it out instead of grinding: " +
    "load the `bearing-minions` skill. One anchored subagent per unit, on a middle tier, each " +
    "returning FOUND file:line / CHECKED / MISSED. They gather; YOU conclude. " +
    "Ignore this if the work is sequential, needs your judgment per step, or is nearly done.",
  "PostToolUse",
);
