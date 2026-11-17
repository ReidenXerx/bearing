#!/usr/bin/env node
// Claude Code PostToolUse (edits) → warn when ANOTHER live session edited the same file recently.
//
// Several sessions in one repository is the normal case: two editor windows, a second chat, minions
// in worktrees. None of them can see the others, and two agents rewriting one file find out at merge
// time — or never, when the second write silently replaces the first. The user asked for this
// (2026-11-15) after Beads and MCP Agent Mail were both ruled out: Beads commits its own contract and
// takes over git hooks; Agent Mail needs a server, costs ~17k tokens of tool schemas, blocks commits
// (NS-5) and treats each worktree as a separate project.
//
// HOW. Each chat keeps one small record — heartbeat, the files it edited and when — under the
// repository's SHARED git directory (`<common>/bearing-sessions/<chat>.json`). Every linked worktree
// resolves to the same common directory, so every session sees every other one, and nothing appears
// in any working tree. Resolving it reads the `.git` file and `commondir` — no `git` spawn on a hook
// that runs after every edit (NS-7). It WARNS, once per other session and file, and never blocks (NS-5).
// Opt-in: `sessionsWarn: true`, then `bearing update` (registered only while on — OPT_IN_HOOKS).
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

const EDITS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
if (!EDITS.has(input.tool_name || "")) process.exit(0);
const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = path.resolve(root, String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? ""));
const rel = path.relative(root, abs);
if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) process.exit(0); // outside this checkout

const lib = (p) => import(pathToFileURL(path.join(root, ".bearing/lib", p)).href);
let cfg, sp, emitContext;
try {
  cfg = (await lib("hook-helpers.mjs")).loadHookConfig(root);
  sp = await lib("session-primer.mjs");
  ({ emitContext } = await lib("claude-emit.mjs"));
} catch {
  process.exit(0);
}
if (cfg.sessionsWarn !== true) process.exit(0);

/** `.git` is a directory in the main checkout and a `gitdir:` file in a linked worktree. */
function gitDirs(dir) {
  const dotgit = path.join(dir, ".git");
  let st;
  try {
    st = fs.statSync(dotgit);
  } catch {
    return null;
  }
  if (st.isDirectory()) return { gitDir: dotgit, common: dotgit };
  const m = fs.readFileSync(dotgit, "utf8").match(/^gitdir:\s*(.+)$/m);
  if (!m) return null;
  const gitDir = path.resolve(dir, m[1].trim());
  let common = gitDir;
  try {
    common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
  } catch {
    /* not a linked worktree after all */
  }
  return { gitDir, common };
}

const dirs = gitDirs(root);
if (!dirs) process.exit(0);
const branch = (() => {
  try {
    const head = fs.readFileSync(path.join(dirs.gitDir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice(16) : head.slice(0, 7);
  } catch {
    return "";
  }
})();

const MIN = 60 * 1000;
const windowMs = (Number(cfg.sessionsWindowMinutes) > 0 ? Number(cfg.sessionsWindowMinutes) : 30) * MIN;
const now = Date.now();
const store = path.join(dirs.common, "bearing-sessions");
// A subagent's call carries its PARENT's transcript_path, so keyed on that alone, parallel subagents
// (and the parent) were one session: each overwrote the same record and skipped it as its own, so
// overlapping edits between them were never warned about. Its `agent_id` tells them apart — bounded
// and filesystem-safe; the main chat's key is unchanged.
const agent = String(input.agent_id ?? "").replace(/[^\w.-]/g, "").slice(0, 40);
const me = sp.sessionKey(input.transcript_path) + (agent ? `--${agent}` : "");
const mine = path.join(store, `${me}.json`);

const read = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const self = read(mine) ?? { files: {}, warned: {} };
self.chat = me;
self.worktree = root;
self.branch = branch;
self.updatedAt = now;
self.files = Object.fromEntries(Object.entries(self.files ?? {}).filter(([, t]) => now - t < windowMs));
self.files[rel] = now;
self.warned ??= {};

const hits = [];
let entries = [];
try {
  entries = fs.readdirSync(store);
} catch {
  /* first session to record */
}
for (const name of entries) {
  if (!name.endsWith(".json") || name === `${me}.json`) continue;
  const p = path.join(store, name);
  const other = read(p);
  if (!other || !(now - Number(other.updatedAt) < windowMs)) {
    // A record nobody has touched in a day is a closed chat; sweep it so the store stays small.
    try {
      if (!other || now - Number(other.updatedAt) > 24 * 60 * MIN) fs.rmSync(p, { force: true });
    } catch {
      /* best effort */
    }
    continue;
  }
  const at = Number(other.files?.[rel]);
  const key = `${other.chat}:${rel}`;
  if (at && now - at < windowMs && !self.warned[key]) {
    self.warned[key] = now;
    hits.push({ ...other, at });
  }
}

try {
  fs.mkdirSync(store, { recursive: true });
  const tmp = `${mine}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(self));
  fs.renameSync(tmp, mine);
} catch {
  /* unwritable → no record, no warning; never a failure (NS-8) */
}
if (!hits.length) process.exit(0);

try {
  sp.bumpScore(root, "sessionWarnings");
} catch {
  /* no scorecard */
}
const where = (h) =>
  `${path.resolve(h.worktree) === root ? "this checkout" : `worktree ${h.worktree}`}${h.branch ? ` (branch ${h.branch})` : ""}`;
emitContext(
  `⚠ Another session is editing this file too: \`${rel}\` was changed ${hits
    .map((h) => `${sp.humanAge(now - h.at)} ago by a session in ${where(h)}`)
    .join("; ")}. Two agents rewriting one file collide at merge time, or one silently replaces the ` +
    "other. Look at what the other session changed (its branch, or `git diff` in that worktree) before " +
    "going further, and tell the user if your work overlaps. Nothing is blocked.",
  "PostToolUse",
);
