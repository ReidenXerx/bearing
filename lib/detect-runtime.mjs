/**
 * Which agent environment is this, actually?
 *
 * A user installed bearing for `zed` and works in Claude Code. Their agent then reported
 * `microscope` and `consult` as "not available in Claude Code" — correctly, because a zed-only
 * install writes `.agents/skills/` and `AGENTS.md` and no `.claude/` anything. Two modules looked
 * broken; one runtime was wrong. Nobody had been asked, and the silent default is `both`, which
 * means cursor+zed and covers Claude Code not at all.
 *
 * The evidence was there the whole time and nothing looked at it. `CLAUDECODE=1` is exported into
 * every Claude Code shell — that is not inference, it is the editor announcing itself — and a
 * repo's own directories record which editors have opened it.
 *
 * Deliberately returns [] when there is nothing to go on, so a caller can ASK rather than assume.
 * A confident wrong guess here is the failure this module exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Signals that identify a runtime without guessing. Env vars are the editor speaking for itself;
 * directories are the repo's history of being opened by one.
 */
const SIGNALS = [
  // Strongest: the process we are running inside.
  { id: "claude", env: "CLAUDECODE" },
  { id: "cursor", env: "CURSOR_TRACE_ID" },
  // Then: what this repo already carries. `.claude/` alone is not enough — Claude Code creates it
  // for its own settings in repos that have never heard of bearing — so require something an agent
  // configuration actually needs.
  { id: "cursor", dirs: [".cursor"] },
  { id: "zed", dirs: [".zed"] },
  { id: "claude", files: ["CLAUDE.md", ".mcp.json"] },
];

/**
 * @param {string} root repo to inspect
 * @param {Record<string,string|undefined>} [env] defaults to process.env; injectable for tests
 * @returns {string[]} runtime ids, sorted, deduped; empty when nothing is detectable
 */
export function detectRuntimes(root, env = process.env) {
  const found = new Set();
  for (const s of SIGNALS) {
    if (s.env && env[s.env]) found.add(s.id);
    if (s.dirs?.some((d) => safeIsDir(path.join(root, d)))) found.add(s.id);
    if (s.files?.some((f) => safeExists(path.join(root, f)))) found.add(s.id);
  }
  return [...found].sort();
}

/**
 * A one-line account of WHY a runtime was chosen, for the install to print. An unexplained choice
 * is the same defect as an unannounced one — the reader cannot tell a detection from a default.
 * @param {string[]} detected @param {Record<string,string|undefined>} [env]
 */
export function detectionReason(detected, env = process.env) {
  if (!detected.length) return null;
  if (env.CLAUDECODE && detected.includes("claude")) {
    return detected.length === 1
      ? "detected: running inside Claude Code"
      : `detected: running inside Claude Code, plus this repo's own ${detected.filter((d) => d !== "claude").join(" + ")} config`;
  }
  return `detected from this repo: ${detected.join(" + ")}`;
}

function safeIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
