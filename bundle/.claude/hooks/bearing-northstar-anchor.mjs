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

const n = bumpNorthStarCounter(root, false, input.transcript_path);

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

// CLIP AT THE SENTENCE, not at a character count. A 200-char slice cut 18 of this repo's 24 claims
// mid-thought and left 10 of them ending on a connective — "Before any of them, ask: what if …",
// "The invariant is COMPUTED …", "a milestone is when to review with …" — so the anchor spent 200
// characters per claim to deliver a cliffhanger, and the RULE is the half that got cut. The
// north-stars are already written claim-first, every one leading with a complete headline sentence,
// so the digest was fighting a format that had already solved this. Measured on this repo: 4,703
// chars → 1,520, a 68% cut, carrying strictly more meaning.
const shown = all.slice(0, MAX_LINES).map((l) => {
  const stop = l.match(/^(.*?[.!?])(?:\s|$)/);
  if (stop && stop[1].length <= MAX_LINE_CHARS) return stop[1];
  if (l.length <= MAX_LINE_CHARS) return l;
  return l.slice(0, MAX_LINE_CHARS).replace(/\s+\S*$/, "") + " …";
});
// NAME WHAT IS MISSING. `slice(0, MAX_LINES)` keeps the head and drops the tail, and by this
// project's own convention the tail is where the GRAVEYARD, the OPEN questions and the "do not cite
// as current" entries live. On a repo with 97 north-stars that silently removed exactly the section
// the closing discipline line then tells the agent to respect. A count is not enough when the
// omitted part is the part the instruction depends on.
const dropped = all.length - shown.length;
const more = dropped
  ? `\n…+${dropped} MORE NOT SHOWN, and they are the END of the file — where the graveyard, the ` +
    `open questions and the superseded entries live. Rule (3) below depends on them: READ ` +
    `\`.bearing/northstars.md\` before proposing or rejecting anything.`
  : "";

emitContext(
  `⚑ NORTH-STARS re-anchor${wroteDoc ? " (you just wrote a doc — conclusions are being recorded)" : ""}. ` +
    "These are the project's FIXED POINTS. They **outrank every other doc, file, and your own " +
    "inference** — if anything you've concluded conflicts with one, the conclusion is wrong, not " +
    "the north-star.\n\n" +
    shown.join("\n") +
    more +
    // The 804-char discipline block that used to sit here is VERBATIM the always-on contract's own
    // north-stars section, which is already permanently in the window — re-sent on every fire, ~20
    // times a session, to an agent that has it. One pointer line carries the same instruction.
    "\n\n(Claims only — full text, evidence and the graveyard are in `.bearing/northstars.md`. " +
    "Cite the NS-# you rely on; propose a change rather than working around one.)",
  "PostToolUse",
);

bumpNorthStarCounter(root, true, input.transcript_path); // reset THIS chat's window
bumpScore(root, "northStarAnchors");
