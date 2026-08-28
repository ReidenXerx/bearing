/**
 * STEALTH INSTALL — bearing for you, invisible to the repository and to your teammates.
 *
 * The normal install is a team decision: it commits hooks, skills, a contract and npm scripts, and
 * everyone who pulls gets them. That is right for a repo you own and wrong for one you contribute
 * to, or where the team has not agreed to it. Without this mode the only options were "commit
 * bearing into someone else's repo" or "don't use it".
 *
 * The promise is narrow and testable: after a stealth install, `git status` is exactly as clean as
 * it was before, and nothing bearing wrote can be committed by accident. That means two rules.
 *
 * 1. NO TRACKED FILE IS MODIFIED. Not `.gitignore`, not `package.json`, not `CLAUDE.md`. Each has a
 *    per-user substitute: `.git/info/exclude` for ignores, no npm scripts at all, and the contract
 *    delivered by the SessionStart hook instead of a file. Where a runtime has no substitute we say
 *    so rather than write the file anyway.
 *
 * 2. EVERY NEW PATH IS EXCLUDED. `.git/info/exclude` is per-clone and is itself untracked, so the
 *    rules never travel. This is the one ignore mechanism that cannot leak — which is exactly why
 *    it is the right one and `.gitignore` is not.
 *
 * Not a conversion tool. If bearing is already committed here, `--stealth` refuses: un-tracking ~80
 * paths and removing them from teammates' checkouts is a deliberate, visible act and must not hide
 * behind an install flag (NS-1).
 */
import fs from "node:fs";
import { detectPrettier } from "./prettier.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Marker for the block we manage inside .git/info/exclude. */
export const EXCLUDE_MARKER = "# bearing — stealth install (per-clone, never pushed)";
export const EXCLUDE_END = "# bearing — end";
/** Where the contract lives when it cannot live in CLAUDE.md. */
export const STEALTH_CONTRACT_PATH = ".bearing/contract.md";

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

/** @param {string} root @param {string} rel @returns {boolean} */
export function isTracked(root, rel) {
  return git(root, ["ls-files", "--error-unmatch", rel]).ok;
}

/**
 * Tracked files a normal install would MODIFY. Each one is a leak in stealth mode: the change shows
 * up in `git status` and can be committed by accident.
 *
 * Only files that already exist AND are tracked count. A file bearing creates fresh is untracked,
 * and an excluded untracked file is invisible — perfectly safe to write.
 * @param {string} root
 * @returns {string[]}
 */
export function trackedFilesAtRisk(root) {
  return [
    ".gitignore",
    "package.json",
    "CLAUDE.md",
    "AGENTS.md",
    ".mcp.json",
    ".cursor/mcp.json",
    ".claude/settings.json",
    ".zed/settings.json",
  ].filter((rel) => isTracked(root, rel));
}

/**
 * Is bearing already SHARED here — i.e. committed for the whole team?
 *
 * Checked against git's index rather than the manifest, because the manifest is gitignored: a fresh
 * clone of a repo with bearing committed has no manifest at all, and that is precisely the case
 * that must be detected.
 * @param {string} root
 */
export function hasSharedInstall(root) {
  const { ok, out } = git(root, [
    "ls-files",
    "--",
    ".bearing/lib",
    ".bearing/skills",
    ".claude/hooks",
    ".cursor/rules",
    "scripts/bearing-*",
  ]);
  if (!ok || !out) return { shared: false, paths: [] };
  const paths = out.split("\n").filter(Boolean);
  return { shared: paths.length > 0, paths };
}

/**
 * Write our managed block into .git/info/exclude, replacing any previous one.
 *
 * Rewritten wholesale on every run for the same reason the .gitignore block is (NS-3): an upgrade
 * that adds a path must not leave the old list beside the new one. The end sentinel is here for the
 * same reason too — so a rule someone appends later lands OUTSIDE our block and survives.
 * @param {string} root @param {string[]} lines
 */
export function writeExclude(root, lines) {
  const dir = path.join(root, ".git", "info");
  const file = path.join(dir, "exclude");
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    /* first stealth install in this clone */
  }
  const base = stripExcludeBlock(existing).replace(/\n+$/, "");
  const block = [EXCLUDE_MARKER, ...lines, EXCLUDE_END].join("\n");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, base ? `${base}\n\n${block}\n` : `${block}\n`);
  return lines;
}

/** @param {string} text */
export function stripExcludeBlock(text) {
  const start = text.indexOf(EXCLUDE_MARKER);
  if (start === -1) return text;
  const endIdx = text.indexOf(EXCLUDE_END, start);
  const end = endIdx === -1 ? text.length : endIdx + EXCLUDE_END.length;
  const before = text.slice(0, start).replace(/\n+$/, "");
  const after = text.slice(end).replace(/^\n+/, "");
  return [before, after].filter(Boolean).join("\n\n");
}

/** Remove our block on uninstall, leaving anything the user put there. */
export function removeExclude(root) {
  const file = path.join(root, ".git", "info", "exclude");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const next = stripExcludeBlock(text);
  // Deleting a file the user may have had before us is not ours to do; empty it instead.
  fs.writeFileSync(file, next.trim() ? `${next.replace(/\n+$/, "")}\n` : "");
}

/**
 * Everything a stealth install must hide. Broad on purpose: an unexcluded path is a leak, and an
 * over-excluded one costs nothing because these are all bearing's own.
 * @param {Set<string>|null} features
 */
export function excludeLines(features) {
  const lines = [
    ".bearing/",
    // Created when the repo has none. A tracked .mcp.json is skipped instead (see mergeMcpJson),
    // but a NEW one is ours and was visible in `git status` on a real install until it was listed
    // here — the test fixture happened to have a tracked one, so this path was never exercised.
    ".mcp.json",
    ".claude/hooks/",
    ".claude/skills/",
    ".claude/settings.local.json",
    ".cursor/",
    ".agents/",
    ".zed/",
    ".githooks/",
    ".vscode/",
    "scripts/bearing-*",
    "scripts/bearing-teaching/",
    "scripts/lib/setup-ui.mjs",
    "scripts/lib/project-tmp.mjs",
    "scripts/lib/require-kit.mjs",
    "scripts/run-with-project-tmp.sh",
    "scripts/clean-project-tmp.sh",
    "scripts/install-git-hooks.sh",
    "scripts/sync-cursor-bearing-teaching.sh",
    "scripts/pack-bearing-teaching.sh",
    "docs/GITNEXUS-*",
    "docs/TEAM-BUNDLE.md",
    "docs/ARCHITECTURE.gitnexus.md",
    ".tmp-agent/",
  ];
  if (!features || features.has("gitnexus")) {
    lines.push(".gitnexus/", ".gitnexusignore", ".github/workflows/gitnexus-ci.yml", ".github/workflows/bearing-index-cache.yml");
  }
  // The WHOLE directory, not just the shipped files: a stealth install promises that nothing shows
  // in `git status`, and the verifiers the agent writes into `.e2e/verify/` are as visible as the
  // substrate they sit on. Screenshots and the Playwright download live here too.
  if (!features || features.has("e2e")) lines.push(".e2e/");
  return lines;
}

/**
 * Runtimes whose only channel is a tracked file, so stealth cannot cover them.
 *
 * Codex reads AGENTS.md and nothing else — no hooks, no per-user override — so if AGENTS.md is
 * tracked there is nowhere to put the contract. Say that instead of writing the file and calling
 * the install stealthy.
 * @param {string} root @param {string} runtime
 * @returns {{ id: string, why: string }[]}
 */
export function stealthLimits(root, runtime) {
  const out = [];
  // .prettierignore is the repo's own config and is normally tracked; creating one where none
  // exists is just as visible, since an untracked file shows in git status too. Either way it
  // breaks the one promise stealth makes, so the offer is withdrawn rather than quietly taken.
  if (detectPrettier(root).found) {
    out.push({
      id: "prettierignore",
      why: "This repo runs Prettier, which will reformat the files bearing owns — but .prettierignore is the repo's own config and writing it would show in git status. Exempt them by hand, or install without --stealth.",
    });
  }
  const ids = String(runtime).split(",").map((s) => s.trim());
  const all = ids.includes("all");
  if ((all || ids.includes("codex")) && isTracked(root, "AGENTS.md")) {
    out.push({
      id: "codex",
      why: "Codex reads AGENTS.md and has no per-user override or hook. AGENTS.md is tracked here, so its contract cannot be hidden — skipped entirely.",
    });
  }
  if ((all || ids.includes("zed")) && isTracked(root, ".zed/settings.json")) {
    out.push({
      id: "zed",
      why: "Zed's MCP entry and agent profile live in the tracked .zed/settings.json. Skills still work; configure the gitnexus context server in your Zed USER settings instead.",
    });
  }
  return out;
}
