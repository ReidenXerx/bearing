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
// Bash counts too — its targets are extracted below, once `lib` exists.
if (!EDITS.has(tool) && tool !== "Bash") process.exit(0);

// The file(s) this call changed. Without one there is nothing to count as distinct.
//
// A Bash write counts too — measured on a real session, ~90 of ~96 edits went through the shell, so
// watching only the edit tools left this counter reading 6. The paths come from the command where
// they are knowable (redirection, `sed -i`, cp/mv, a quoted path in a heredoc); a target computed
// at runtime is not guessed, because inflating a DISTINCT-file count with paths that were never
// touched would make the threshold mean less than it says.
let targets = [input.tool_input?.file_path || input.tool_input?.notebook_path].filter(Boolean);

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
    return {
      files: Array.isArray(s.files) ? s.files : [],
      nudged: Boolean(s.nudged),
      // undefined until the first git fallback runs — `null` would be indistinguishable from
      // "recorded, and the tree was clean".
      baseline: Array.isArray(s.baseline) ? s.baseline : undefined,
    };
  } catch {
    return { files: [], nudged: false, baseline: undefined };
  }
}

const state = read();
let baselineJustSet = false;
if (!targets.length && tool === "Bash") {
  try {
    const { bashWriteTargets } = await lib("hook-helpers.mjs");
    targets = bashWriteTargets(input.tool_input?.command);
  } catch {
    /* no lib → nothing countable */
  }

  // Reading the path off the command line fails whenever a heredoc computes it — which is how most
  // of a real session's edits are made. Guessing would inflate a DISTINCT-file count with files
  // nobody touched, so ask git instead: it knows exactly what changed, whatever wrote it.
  //
  // Only as a fallback, and only for Bash. `git status` costs ~12ms on a large repo; paying it on
  // every tool call would be unbounded work on a hot path (NS-7), and paying it when the command
  // line already named the file would be paying twice for the same answer.
  if (!targets.length) {
    try {
      const { execSync } = await import("node:child_process");
      const porcelain = execSync("git -c core.quotePath=false status --porcelain -uall", {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const dirty = porcelain.split("\n").filter(Boolean).map((l) => l.slice(3).trim()).filter(Boolean);
      // Files already dirty when this chat started are not this session's work. Recorded once, on
      // the first fallback, so a repo with existing changes does not jump straight to the threshold.
      if (!Array.isArray(state.baseline)) {
        // Everything already dirty is pre-session work — EXCEPT what this session has already been
        // credited with. Without that subtraction, a session that edited five files through the
        // Write tool and then ran one shell command would fold all five into the baseline and
        // forget them.
        state.baseline = dirty.filter((f) => !state.files.some((k) => f.endsWith(k) || k.endsWith(f)));
        baselineJustSet = true;
      }
      targets = dirty.filter((f) => !state.baseline.includes(f));
    } catch {
      /* not a git repo, or git unavailable → nothing countable */
    }
  }
}
if (!targets.length && !baselineJustSet) process.exit(0);
if (state.nudged) process.exit(0);
for (const t of targets) if (!state.files.includes(t)) state.files.push(t);
if (state.files.length > MAX_TRACKED) state.files = state.files.slice(-MAX_TRACKED);

const enough = state.files.length >= threshold;
try {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ files: state.files, nudged: enough, baseline: state.baseline }));
} catch {
  process.exit(0); // unwritable → silent rather than nudging on every edit (NS-8)
}
if (!enough) process.exit(0);

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
