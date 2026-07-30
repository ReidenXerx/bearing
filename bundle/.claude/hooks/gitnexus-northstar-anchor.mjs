#!/usr/bin/env node
// Claude Code PostToolUse → re-anchor the agent on the project's NORTH-STARS.
//
// Semantic drift is not a memory problem, it's a CONTROL problem: the north-stars doc is loaded at
// session start, then 100k+ tokens of exploration dilute it until the agent is quietly reasoning
// from a subtly wrong model of the domain — and every conclusion after that is fluent and invalid.
// So the anchor has to RECUR. This hook re-injects the numbered NS-# propositions VERBATIM:
//   • every `northStarAnchorEvery` tool calls, and
//   • immediately after the agent writes a doc/markdown file — the moment conclusions crystallize,
//     which is exactly when a drifted premise gets written down and becomes "settled".
// Inert when the repo has no .gnkit/gitnexus-northstars.md.
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

const lib = (rel) => import(pathToFileURL(path.join(root, ".gnkit/lib", rel)).href);
const { loadHookConfig } = await lib("hook-helpers.mjs");
const { emitContext } = await lib("claude-emit.mjs");
const { northStarsExists, northStarsDigest, bumpNorthStarCounter, bumpScore } =
  await lib("session-primer.mjs");

if (!northStarsExists(root)) process.exit(0); // feature is opt-in per repo

const config = loadHookConfig(root);
const every = Number(config.northStarAnchorEvery);
if (!(every > 0)) process.exit(0); // disabled

// A "conclusion moment": the agent is writing prose — a research note, a plan, an audit, a
// task-core. This is where a drifted premise gets baked into the record, so always re-anchor.
const tool = String(input.tool_name || "");
const filePath = String(input.tool_input?.file_path || "");
const wroteDoc = /^(Write|Edit|NotebookEdit)$/.test(tool) && /\.(md|mdx|txt)$/i.test(filePath);

const n = bumpNorthStarCounter(root);
if (!wroteDoc && n < every) process.exit(0);

const MAX_LINES = 40; // safety valve — the doc is meant to be ~1 page of propositions
const all = northStarsDigest(root);
if (!all.length) process.exit(0); // file exists but has no NS-# lines yet

const shown = all.slice(0, MAX_LINES);
const more =
  all.length > shown.length
    ? `\n…+${all.length - shown.length} more — read \`.gnkit/gitnexus-northstars.md\`.`
    : "";

emitContext(
  `⚑ NORTH-STARS re-anchor${wroteDoc ? " (you just wrote a doc — conclusions are being recorded)" : ""}. ` +
    "These are the project's FIXED POINTS. They **outrank every other doc, file, and your own " +
    "inference** — if anything you've concluded conflicts with one, the conclusion is wrong, not " +
    "the north-star.\n\n" +
    shown.join("\n") +
    more +
    "\n\nDiscipline: (1) cite the relevant **NS-#** when you make a consequential claim, propose a " +
    "direction, or reject an idea — if you cannot cite one, you may be drifting; (2) if you believe " +
    "a north-star is wrong or missing, say so EXPLICITLY and propose the edit to the user — never " +
    "silently work around it, and never edit the file yourself; (3) an idea in the GRAVEYARD is " +
    "settled — do not re-propose it without new evidence that addresses why it was rejected.",
  "PostToolUse",
);

bumpNorthStarCounter(root, true); // reset the window
bumpScore(root, "northStarAnchors");
