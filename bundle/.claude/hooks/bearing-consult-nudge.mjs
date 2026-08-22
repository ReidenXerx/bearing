#!/usr/bin/env node
// Claude Code PostToolUse → at the moment implementation STARTS, pose the consult test.
//
// Consult shipped as contract text and nothing else. The minion hook already names why that fails:
// "the fan-out trigger lives in the always-on contract, which means it fires when the agent happens
// to recall it." Consult had the same problem and no equivalent fix — northstars, taskcore and
// minions all got a runtime trigger; consult and microscope did not. Reported from use: the agent
// does not remember consult during its usual routines. It cannot; nothing reminds it.
//
// WHICH MOMENT. Consult's rule is "ask when you are about to INVENT a requirement rather than
// implement one", and no tool call means "I am inventing". The closest honest proxy is the
// transition from investigating to implementing — the FIRST edit of a session. That is when
// unstated requirements get decided, usually silently, and after it the decision is already in the
// code and costs a rewrite to revisit.
//
// This is a PROXY and is stated as one. It fires on every session with an edit, including ones
// where the task was fully specified and there is nothing to ask. That is why it nudges once and
// never blocks (NS-5): the cost of a wasted line is a line, and the cost of a silently invented
// requirement is the feature.
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
// The transition we care about: the agent has stopped reading and started changing the repo.
const IMPLEMENTS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
if (!IMPLEMENTS.has(tool)) process.exit(0);

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

if (config.consultNudge === false || config.consultNudge === 0) process.exit(0);

// Once per CHAT, keyed the same way the task-core is, so two sessions in one repo do not silence
// each other and a resumed session does not re-ask.
const key = sp.sessionKey(input.transcript_path);
const STATE = path.join(root, ".bearing", `.bearing-consult-${key}.flag`);
if (fs.existsSync(STATE)) process.exit(0);
try {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, "");
} catch {
  process.exit(0); // unwritable → stay silent rather than nudge on every edit (NS-8)
}

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
  sp.bumpScore(root, "consultNudges");
} catch {
  /* no scorecard → nothing to count */
}

emitContext(
  "· First edit this session — you are implementing now. Before any requirement gets decided by " +
    "default: **is the answer discoverable HERE?** Code, tests, config, git history, north-stars, " +
    "an existing convention — then go and find it, because asking for what the repo already answers " +
    "is offloading. If it exists only in the USER's head — which of two readings they meant, which " +
    "tradeoff they prefer, what a user should see — no amount of reading produces it, and that is " +
    "the question worth asking. Ask it NOW, before the guess is in the code: closed options, the " +
    "tradeoff, a recommendation, and what you will do without an answer. Not for anything cheaply " +
    "reversible, and never as insurance.",
  "PostToolUse",
);
