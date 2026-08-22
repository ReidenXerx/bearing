#!/usr/bin/env node
// Claude Code PostToolUse → once the change has grown SUBSTANTIAL, offer the deep review.
//
// Microscope shipped as contract text and nothing else, the same gap consult had: it fired only
// when the agent happened to recall it. northstars, taskcore and minions each got a runtime
// trigger; the two judgement modules did not.
//
// WHICH MOMENT. The contract's own condition is "at a milestone ... and only when the work is
// SUBSTANTIAL (multi-file or high `impact` blast-radius)". Half of that is directly countable:
// multi-file means DISTINCT FILES EDITED, which is a fact about the session rather than a guess at
// intent. Counting distinct files and not edits matters — twenty passes over one file is iteration,
// five files touched once each is a change with a shape worth reviewing.
//
// It cannot see the other half (a milestone is a human judgement) so it does not pretend to: it
// says the work has reached the size where the review pays, and leaves the timing to the agent.
// Nudges once per chat, never blocks (NS-5).
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
const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
if (!EDITS.has(tool)) process.exit(0);

// The file this call changed. Without one there is nothing to count as distinct.
const target = input.tool_input?.file_path || input.tool_input?.notebook_path || "";
if (!target) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

let config;
let sp;
try {
  const { loadHookConfig } = await lib("hook-helpers.mjs");
  config = loadHookConfig(root);
  sp = await lib("session-primer.mjs");
} catch {
  process.exit(0);
}

const threshold = Number(config.microscopeFileThreshold);
if (!(threshold > 0)) process.exit(0); // 0 disables

const key = sp.sessionKey(input.transcript_path);
const STATE = path.join(root, ".bearing", `.bearing-microscope-${key}.json`);
const MAX_TRACKED = 200; // bounded work per call (NS-7)

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
    return { files: Array.isArray(s.files) ? s.files : [], nudged: Boolean(s.nudged) };
  } catch {
    return { files: [], nudged: false };
  }
}

const state = read();
if (state.nudged) process.exit(0);
if (!state.files.includes(target)) state.files.push(target);
if (state.files.length > MAX_TRACKED) state.files = state.files.slice(-MAX_TRACKED);

const enough = state.files.length >= threshold;
try {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ files: state.files, nudged: enough }));
} catch {
  process.exit(0); // unwritable → silent rather than nudging on every edit (NS-8)
}
if (!enough) process.exit(0);

const { emitContext } = await lib("claude-emit.mjs");
try {
  sp.bumpScore(root, "microscopeNudges");
} catch {
  /* no scorecard → nothing to count */
}

emitContext(
  `· ${state.files.length} distinct files changed this session — this is now a multi-file change. ` +
    "At the next milestone (feature done, checkpoint, before you hand it over), run a " +
    "**microscope-waves** pass: load the `bearing-microscope` skill. Multi-lens, opinionated rather " +
    "than defect-only, adversarially verified, iterated in waves. Not now if you are mid-thought — " +
    "but do not ship a change this size on a single read-through.",
  "PostToolUse",
);
