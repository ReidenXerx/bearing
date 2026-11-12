#!/usr/bin/env node
// Claude Code PostToolUse → re-anchor the agent on the project's NORTH-STARS.
//
// Semantic drift is not a memory problem, it's a CONTROL problem: the north-stars doc is loaded at
// session start, then 100k+ tokens of exploration dilute it until the agent is quietly reasoning
// from a subtly wrong model of the domain — and every conclusion after that is fluent and invalid.
// So the anchor has to RECUR. This hook re-injects the numbered NS-# propositions:
//   • ALL of them, once the context has grown by `northStarAnchorEveryTokens` since they were last
//     in front of the agent (or every `northStarAnchorEvery` calls when the size cannot be read), and
//   • the FEW that a doc/markdown file just written is about — the moment conclusions crystallize,
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
const {
  northStarsExists,
  northStarsDigest,
  bumpNorthStarCounter,
  bumpScore,
  transcriptContextTokens,
  northStarBaseline,
  setNorthStarBaseline,
  relevantNorthStars,
} = await lib("session-primer.mjs");

if (!northStarsExists(root)) process.exit(0); // feature is opt-in per repo

const config = loadHookConfig(root);
const every = Number(config.northStarAnchorEvery);
if (!(every > 0)) process.exit(0); // disabled

// A "conclusion moment": the agent is writing prose — a research note, a plan, an audit, a
// task-core. This is where a drifted premise gets baked into the record, so it gets an anchor of
// its own — the north-stars that prose is about (below).
const tool = String(input.tool_name || "");
const filePath = String(input.tool_input?.file_path || "");
const wroteDoc = /^(Write|Edit|NotebookEdit)$/.test(tool) && /\.(md|mdx|txt)$/i.test(filePath);

const key = input.transcript_path;
const n = bumpNorthStarCounter(root, false, key);

// WHEN TO RE-SEND THEM ALL: when enough has been added to the context to bury them. That is a
// size, and the transcript records the size on every turn; it does not record the window, and this
// never looks at one (NS-19). Counting tool calls was the stand-in, and a poor one — 25 greps add
// little, 25 file reads can add 100k tokens. Measured on this repo, 25 calls added 25k–65k tokens
// (p10–p90) and up to 155k, so the default below keeps the median rhythm while following the growth.
const everyTokens = Number(config.northStarAnchorEveryTokens);
const ctx = everyTokens > 0 ? transcriptContextTokens(key) : null;
let due;
if (ctx === null) {
  due = n >= every; // no readable size — this runtime, an older transcript format, no transcript
} else {
  const base = northStarBaseline(root, key);
  if (base === null || ctx < base) {
    // First sight of this chat, or the context SHRANK — a compaction. Either way the session brief
    // has just put the north-stars in front of the agent, so this is a baseline, not a fire.
    setNorthStarBaseline(root, key, ctx);
    due = false;
  } else {
    due = ctx - base >= everyTokens;
  }
}

// A doc write fires regardless of the clock, because writing a doc is when a conclusion gets
// recorded in durable form — that is the moment worth interrupting. Debounced: a burst of doc writes
// used to pay an anchor once per file while the previous copy was still in the window, so a low
// call count since the last anchor of either kind means the claims are still present.
const DOC_DEBOUNCE = 5;
if (!due && !(wroteDoc && n >= DOC_DEBOUNCE)) process.exit(0);

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

// AFTER A DOC WRITE, ONLY THE ONES IT IS ABOUT. Re-sending all of them after every doc write was the
// noisiest thing bearing did: in one session here it fired mostly on the agent's own bookkeeping
// (task-core, memory), each time with every claim. What the moment needs is the few the new text
// touches — so the agent sees "NS-3 is about this" rather than a list it has learned to skip.
// Nothing relevant means nothing to say (NS-12). Matching is lexical and can miss a north-star
// that applies in other words; the full anchor above is the backstop.
// CLIP AT THE SENTENCE, not at a character count. A 200-char slice cut 18 of this repo's 24 claims
// mid-thought and left 10 of them ending on a connective — "Before any of them, ask: what if …",
// "The invariant is COMPUTED …", "a milestone is when to review with …" — so the anchor spent 200
// characters per claim to deliver a cliffhanger, and the RULE is the half that got cut. The
// north-stars are already written claim-first, every one leading with a complete headline sentence,
// so the digest was fighting a format that had already solved this. Measured on this repo: 4,703
// chars → 1,520, a 68% cut, carrying strictly more meaning.
const clip = (l) => {
  const stop = l.match(/^(.*?[.!?])(?:\s|$)/);
  if (stop && stop[1].length <= MAX_LINE_CHARS) return stop[1];
  if (l.length <= MAX_LINE_CHARS) return l;
  return l.slice(0, MAX_LINE_CHARS).replace(/\s+\S*$/, "") + " …";
};
if (!due) {
  const ti = input.tool_input || {};
  const written = [ti.content, ti.new_string, ti.new_source, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])]
    .filter((x) => typeof x === "string")
    .join("\n");
  const hits = relevantNorthStars(all, written);
  if (!hits.length) process.exit(0);
  emitContext(
    `⚑ NORTH-STARS this doc touches (${hits.length} of ${all.length} — the rest are in ` +
      "`.bearing/northstars.md`). You just recorded a conclusion; check it against these — if it " +
      "conflicts with one, the conclusion is wrong, not the north-star.\n\n" +
      hits.map(clip).join("\n"),
    "PostToolUse",
  );
  // Debounces the next doc write. With a readable context size the full anchor runs on its own
  // clock and is untouched; on the call-count fallback this restarts that count too, which only
  // delays the full list by the few calls since the relevant part of it was shown.
  bumpNorthStarCounter(root, true, key);
  bumpScore(root, "northStarAnchors");
  process.exit(0);
}

const shown = all.slice(0, MAX_LINES).map(clip);
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
  "⚑ NORTH-STARS re-anchor. " +
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

bumpNorthStarCounter(root, true, key); // reset THIS chat's window
if (ctx !== null) setNorthStarBaseline(root, key, ctx);
bumpScore(root, "northStarAnchors");
