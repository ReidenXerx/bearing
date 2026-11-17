#!/usr/bin/env node
// Claude Code PostToolUse (Bash) → at a MILESTONE, ask whether project memory still says what is true.
//
// Memory is the one layer nothing else keeps current. North-stars change when the user approves a
// change; a task-core is rewritten when its edits pile up; but the memory files — what the next
// SESSION starts from, across days — are only as fresh as the last time the agent thought of them.
// Asked by the user (2026-11-15): "just need to be sure that agent will constantly keep up to date
// memory files" — a nudge at milestones, plus a weekly one (that half lives in the session brief).
//
// WHICH MOMENT. A milestone is when state changes for the next session: a PR merged, a tag cut, a
// release or a package published. Those are shell commands, so this hook listens to Bash only. It
// stays silent when memory was written in the last 30 minutes (the agent already did it), and once
// it has spoken it waits 30 minutes before speaking again — a merge-then-tag sequence is one
// milestone, not two. Knob: `memoryNudge: false` (NS-31). Never blocks (NS-5).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* malformed stdin must never break the tool call (NS-8) */
}

if ((input.tool_name || "") !== "Bash") process.exit(0);
const cmd = String(input.tool_input?.command ?? "");
// Cheap before anything is imported: this runs after every shell command (NS-7).
const MILESTONES = [
  [/\bgh\s+pr\s+merge\b/, "a PR merged"],
  [/\bgh\s+release\s+create\b/, "a release created"],
  [/\b(?:npm|pnpm)\s+publish\b|\byarn\s+(?:npm\s+)?publish\b/, "a package published"],
];
/**
 * `git tag` CREATES a tag when it is given a name and no list/delete/verify flag. A regex on the
 * first argument got this wrong: `git tag -a v1.4.0 -m "…"` — the annotated form most releases use —
 * starts with a flag and was missed. So look at every word of each `git tag` segment.
 */
function cutsTag(c) {
  for (const seg of c.split(/&&|\|\||[;|\n]/)) {
    const m = seg.match(/\bgit\s+tag\b(.*)$/);
    if (!m) continue;
    const words = m[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (words.some((w) => /^(?:-l|--list|-d|--delete|-v|--verify|-n\d*|--contains|--merged|--no-merged|--points-at)$/.test(w))) continue;
    // A tag name is any word that is not a flag (a quoted -m message also counts, which only
    // matters for `git tag -m x` with no name — a command git itself rejects).
    if (words.some((w) => !w.startsWith("-"))) return true;
  }
  return false;
}
const hit = MILESTONES.find(([re]) => re.test(cmd)) ?? (cutsTag(cmd) ? [null, "a tag cut"] : null);
if (!hit) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

let config, sp, emitContext;
try {
  ({ loadHookConfig: config } = await lib("hook-helpers.mjs"));
  config = config(root);
  sp = await lib("session-primer.mjs");
  ({ emitContext } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0); // no kit lib → nothing to say (NS-8)
}
if (config.memoryNudge === false) process.exit(0);

const HALF_HOUR = 30 * 60 * 1000;
const now = Date.now();
const mem = sp.memoryFreshness(root);
if (mem.newestMs && now - mem.newestMs < HALF_HOUR) process.exit(0); // already written

const STATE = path.join(root, ".bearing/.bearing-memory-nudge.json");
try {
  const last = Number(JSON.parse(fs.readFileSync(STATE, "utf8")).at) || 0;
  if (now - last < HALF_HOUR) process.exit(0);
} catch {
  /* never nudged */
}
try {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ at: now }));
} catch {
  process.exit(0); // unwritable → stay quiet rather than repeat on every command (NS-8)
}
try {
  sp.bumpScore(root, "memoryNudges");
} catch {
  /* no scorecard → nothing to count */
}

const age = mem.newestMs ? `was last written ${sp.humanAge(now - mem.newestMs)} ago` : "is not written yet";
emitContext(
  `· Milestone — ${hit[1]}. Your project memory (${mem.dir}) ${age}. The next session starts ` +
    "from that memory, not from this transcript: if this changed the project's state, a decision, what " +
    "is next or what you learned about how the user works, update it now — one fact per file, the " +
    "index line in MEMORY.md, stale entries corrected or deleted. Nothing changed? Then nothing to write.",
  "PostToolUse",
);
