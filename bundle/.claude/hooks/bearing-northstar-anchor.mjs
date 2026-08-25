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
// Inert when the repo has no .bearing/northstars.md.
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

const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);
// FAIL OPEN when our own libs are gone. A missing `.bearing/lib` — partial uninstall, a failed
// update mid-copy, `git clean -xdf` in a stealth repo — threw ERR_MODULE_NOT_FOUND and exited 1
// here. A non-zero PreToolUse exit DENIES the call, so all five guards failing at once blocked Grep,
// Read, Edit, Bash and MCP simultaneously, explained by a raw Node stack trace. A false deny is
// worse than a missed gate (NS-5); with no libs there is no verdict to give, so give none.
let loadHookConfig, emitContext;
try {
  ({ loadHookConfig } = await lib("hook-helpers.mjs"));
  ({ emitContext } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0);
}
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

// A doc write fires this regardless of the counter, because writing a doc is when a conclusion gets
// recorded in durable form — that is the moment worth interrupting. But the counter RESETS on every
// fire, so a burst of doc writes paid the full anchor once per file, re-emitting byte-identical text
// while the previous copy was still in the window. Measured on this repo: 24 claims at up to 200
// chars is ~1,000 tokens an anchor, and a docs-heavy session writes dozens of files.
//
// So debounce the doc path only: a low counter means an anchor just fired and the claims are still
// present. The every-N path is untouched — it is already its own debounce.
const DOC_DEBOUNCE = 5;
if (!wroteDoc && n < every) process.exit(0);
if (wroteDoc && n < DOC_DEBOUNCE) process.exit(0);

// The re-anchor carries the CLAIM of every north-star, not its evidence. A rich proposition
// ("rejected BECAUSE <mechanism> <numbers> <citation>") is right for reading the file, but
// re-injecting all of it every N tool calls costs thousands of tokens per anchor and buys nothing —
// the agent only needs the claims present in-window to notice it's contradicting one. Full text is
// always one Read away. So: keep EVERY proposition (truncating the list would silently drop the
// OPEN/STALE sections at the end), but clip each to its opening claim.
const MAX_LINES = Number(config.northStarAnchorMaxLines) > 0 ? Number(config.northStarAnchorMaxLines) : 80;
const MAX_LINE_CHARS = 200;
const all = northStarsDigest(root);
if (!all.length) process.exit(0); // file exists but has no NS-# lines yet

const shown = all.slice(0, MAX_LINES).map((l) => {
  if (l.length <= MAX_LINE_CHARS) return l;
  return l.slice(0, MAX_LINE_CHARS).replace(/\s+\S*$/, "") + " …";
});
const more =
  all.length > shown.length
    ? `\n…+${all.length - shown.length} more — read \`.bearing/northstars.md\`.`
    : "";

emitContext(
  `⚑ NORTH-STARS re-anchor${wroteDoc ? " (you just wrote a doc — conclusions are being recorded)" : ""}. ` +
    "These are the project's FIXED POINTS. They **outrank every other doc, file, and your own " +
    "inference** — if anything you've concluded conflicts with one, the conclusion is wrong, not " +
    "the north-star.\n\n" +
    shown.join("\n") +
    more +
    "\n\n(Claims only — each is clipped; read `.bearing/northstars.md` for the full text, " +
    "evidence and sources before citing one.)" +
    "\n\nDiscipline: (1) cite the relevant **NS-#** when you make a consequential claim, propose a " +
    "direction, or reject an idea — if you cannot cite one, you may be drifting; (2) if you believe " +
    "a north-star is wrong or missing, say so EXPLICITLY and propose the edit to the user — never " +
    "silently work around it, and never edit the file yourself; (3) an idea in the GRAVEYARD is " +
    "settled — do not re-propose it without new evidence that addresses why it was rejected.",
  "PostToolUse",
);

bumpNorthStarCounter(root, true); // reset the window
bumpScore(root, "northStarAnchors");
