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
 * and the kit's stable `gitnexus-agent-kit` contract block. Run after every analyze
 * (sync-teaching + pre-commit) so the block never persists in a committed file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const START = "<!-- gitnexus:start -->";
const END = "<!-- gitnexus:end -->";
const BLOCK_RE = /\n*<!-- gitnexus:start -->[\s\S]*?<!-- gitnexus:end -->\n?/g;

/** @param {string} root @returns {string[]} files changed */
export function stabilizeAgentDocs(root) {
  const changed = [];
  for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const orig = fs.readFileSync(p, "utf8");
    if (!orig.includes(START) || !orig.includes(END)) continue;
    const next = orig
      .replace(BLOCK_RE, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "");
    if (next !== orig) {
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
  const changed = stabilizeAgentDocs(process.argv[2] || process.cwd());
  if (changed.length) {
    console.log(
      `    ✓ stabilized agent docs (dropped volatile GitNexus stats block): ${changed.join(", ")}`,
    );
  }
}
