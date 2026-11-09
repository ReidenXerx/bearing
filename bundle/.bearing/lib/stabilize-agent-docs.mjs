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
 * (refresh-cli, the bearing:refresh family of npm scripts, sync-teaching) so the block is gone
 * before anything can stage it. A pre-commit hook used to strip the STAGED copies too; it was retired
 * with the rest of the automatic refresh (NS-25), so the strip now happens where the block is made.
 */
import fs from "node:fs";
import path from "node:path";
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
}
