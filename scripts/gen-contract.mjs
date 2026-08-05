#!/usr/bin/env node
/**
 * Generate the IDE contract files from ONE canonical source.
 *
 * Single source of truth: scripts/contract/enforcement-contract.md (the neutral,
 * vendor-agnostic enforcement contract). This script wraps it per IDE adapter:
 *   - Cursor  → bundle/.cursor/rules/00-bearing-enforcement.mdc (always-on rule)
 *   - Zed     → bundle/templates/AGENTS.gitnexus.md (always-on AGENTS.md block)
 *
 * Edit the contract, run `npm run gen:contract`, commit. A test
 * (`contract files are generated from the single canonical source`) fails if the
 * on-disk files drift from the rendered output, so they can never silently diverge.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export const CONTRACT_SRC = path.join(HERE, "contract/enforcement-contract.md");
export const ZED_FOOTER_SRC = path.join(HERE, "contract/agents-zed-footer.md");
export const CLAUDE_FOOTER_SRC = path.join(HERE, "contract/claude-footer.md");
export const CURSOR_RULE_OUT = path.join(
  ROOT,
  "bundle/.cursor/rules/00-bearing-enforcement.mdc",
);
export const AGENTS_OUT = path.join(ROOT, "bundle/templates/AGENTS.gitnexus.md");
export const CLAUDE_OUT = path.join(ROOT, "bundle/templates/CLAUDE.gitnexus.md");

const CURSOR_FRONTMATTER = `---
description: North-star contract — graph + embeddings + cypher on every task when fresh, autonomous refresh when stale, classical fallback when GN fails.
alwaysApply: true
---
`;

const GENERATED_NOTE =
  "<!-- GENERATED from scripts/contract/enforcement-contract.md by scripts/gen-contract.mjs — edit there, run `npm run gen:contract`. -->";

/** @param {string} body canonical contract markdown */
export function renderCursorRule(body) {
  return `${CURSOR_FRONTMATTER}\n${GENERATED_NOTE}\n\n# GitNexus enforcement\n\n${body.trim()}\n`;
}

/** @param {string} body @param {string} footer @param {string} title */
function renderWithFooter(body, footer, title) {
  return `${GENERATED_NOTE}\n\n# ${title}\n\n${body.trim()}\n\n${footer.trim()}\n`;
}

/** @param {string} body @param {string} zedFooter */
export function renderAgents(body, zedFooter) {
  return renderWithFooter(body, zedFooter, "GitNexus agent kit — always-on instructions");
}

/** @param {string} body @param {string} claudeFooter */
export function renderClaude(body, claudeFooter) {
  return renderWithFooter(body, claudeFooter, "GitNexus agent kit — always-on instructions");
}

export function renderAll() {
  const body = fs.readFileSync(CONTRACT_SRC, "utf8");
  const zedFooter = fs.readFileSync(ZED_FOOTER_SRC, "utf8");
  const claudeFooter = fs.readFileSync(CLAUDE_FOOTER_SRC, "utf8");
  return {
    [CURSOR_RULE_OUT]: renderCursorRule(body),
    [AGENTS_OUT]: renderAgents(body, zedFooter),
    [CLAUDE_OUT]: renderClaude(body, claudeFooter),
  };
}

function main() {
  const outputs = renderAll();
  for (const [file, content] of Object.entries(outputs)) {
    fs.writeFileSync(file, content);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
