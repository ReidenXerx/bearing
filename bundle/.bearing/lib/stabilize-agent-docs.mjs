#!/usr/bin/env node
/**
 * Keep committed agent docs stable across machines.
 *
 * The GitNexus `analyze` tool injects a `<!-- gitnexus:start -->…<!-- gitnexus:end -->`
 * block into AGENTS.md / CLAUDE.md containing LIVE graph stats (symbol/relationship
 * counts, per-area skill counts). Those numbers differ per checkout + re-index, so the
 * files churn on every refresh — perpetual "modified" noise for every teammate who pulls.
 *
 * This strips that volatile block wherever it lands, preserving the user's own content
 * and the kit's stable `bearing` contract block. Run after every analyze
 * (sync-teaching + refresh) so the block never lingers on disk, and with `--staged` from
 * pre-commit so it never reaches a commit — see stabilizeStagedAgentDocs for why the
 * on-disk strip alone did not do that.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const START = "<!-- gitnexus:start -->";
const END = "<!-- gitnexus:end -->";
const BLOCK_RE = /\n*<!-- gitnexus:start -->[\s\S]*?<!-- gitnexus:end -->\n?/g;
const DOCS = ["AGENTS.md", "CLAUDE.md"];

/** @param {string} text @returns {string} the text without the stats block; unchanged if it has none */
export function stripStatsBlock(text) {
  if (!text.includes(START) || !text.includes(END)) return text;
  return text
    .replace(BLOCK_RE, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

/** @param {string} root @returns {string[]} files changed */
export function stabilizeAgentDocs(root) {
  const changed = [];
  for (const rel of DOCS) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const orig = fs.readFileSync(p, "utf8");
    const next = stripStatsBlock(orig);
    if (next !== orig) {
      // A file whose ONLY content was the volatile block is analyzer litter, not a user doc.
      // `analyze` creates AGENTS.md from nothing in repos that never had one, so stripping the
      // block left a 0-byte file behind — invisible in a normal install because it is ignored,
      // but in a STEALTH install a stray untracked AGENTS.md is exactly the leak the mode
      // promises not to create. Nothing of the user's is lost: the strip preserves their content,
      // so empty means there was none.
      if (!next.trim()) {
        try {
          fs.unlinkSync(p);
          changed.push(`${rel} (removed — held only the stats block)`);
          continue;
        } catch {
          /* fall through to writing the empty file rather than failing */
        }
      }
      fs.writeFileSync(p, next);
      changed.push(rel);
    }
  }
  return changed;
}

/**
 * Strip the block from the STAGED copies — the content a commit is actually built from.
 *
 * The pre-commit hook used to run only the on-disk strip, on the belief that this kept commits
 * clean. It did not: git commits the index, not the working tree, so a block staged before the hook
 * ran — an `analyze` bearing did not launch, then `git add -A` — was committed anyway. Worse, the
 * stripped files on disk then showed as fresh changes (` D AGENTS.md`, ` M CLAUDE.md`) that the next
 * `git add -A` swept into an unrelated commit, and the next stray analyze put the block back. A real
 * repository's history alternated add/remove/add across four unrelated feature commits.
 *
 * Plumbing, not `git add`: a partially staged CLAUDE.md must not pick up the unstaged rest of the
 * file. Every call inherits GIT_INDEX_FILE from the hook, so this edits whichever index the commit is
 * built from — the real one, the one `commit -a` prepares, or the temporary one `commit -- <paths>`
 * uses — and git re-reads it after pre-commit returns. In that last mode git also writes the
 * pre-hook content into the real index, so `git status` shows `MM CLAUDE.md` afterwards; the commit
 * itself is clean, and the next commit through this hook strips the leftover.
 *
 * Scope: only docs this commit already changes. A block that is already in HEAD is left alone here
 * rather than written into an unrelated commit by the hook itself.
 *
 * @param {string} root @returns {string[]} files changed in the index
 */
export function stabilizeStagedAgentDocs(root) {
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: root,
      input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
  let touched;
  try {
    touched = new Set(
      git(["diff", "--cached", "--relative", "--name-only", "--", ...DOCS]).split("\n").filter(Boolean),
    );
  } catch {
    return []; // not a repository, or no git: nothing is staged, so nothing can be committed
  }
  const changed = [];
  for (const rel of DOCS) {
    if (!touched.has(rel)) continue;
    const entries = git(["ls-files", "--stage", "--", rel]).split("\n").filter(Boolean);
    if (entries.length !== 1) continue; // deleted by this commit, or mid-conflict (stages 1-3)
    const [mode, sha, stage] = entries[0].split("\t")[0].split(" ");
    if (stage !== "0" || (mode !== "100644" && mode !== "100755")) continue; // symlink, gitlink
    const staged = git(["cat-file", "blob", sha]);
    const next = stripStatsBlock(staged);
    if (next === staged) continue;
    // Same rule as on disk: a doc that held only the block is analyzer litter, so it stays out.
    if (!next.trim()) {
      git(["update-index", "--force-remove", "--", rel]);
      changed.push(`${rel} (left out — held only the stats block)`);
    } else {
      // No --path: the blob is already in its cleaned, index form, and must not be filtered twice.
      const blob = git(["hash-object", "-w", "--stdin"], next).trim();
      git(["update-index", "--cacheinfo", `${mode},${blob},${rel}`]);
      changed.push(rel);
    }
  }
  return changed;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.cwd();
  const changed = stabilizeAgentDocs(root);
  if (changed.length) {
    console.log(
      `    ✓ stabilized agent docs (dropped volatile GitNexus stats block): ${changed.join(", ")}`,
    );
  }
  if (process.argv.includes("--staged")) {
    const staged = stabilizeStagedAgentDocs(root);
    if (staged.length) {
      console.log(`    ✓ kept the GitNexus stats block out of this commit: ${staged.join(", ")}`);
    }
  }
}
