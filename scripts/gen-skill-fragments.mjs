#!/usr/bin/env node
/**
 * Render shared skill fragments into every skill that uses them.
 *
 * Microscope and minions both spawn anchored subagents, and the mechanics are identical: the same
 * pinned persona, the same north-star subset, the same parallel-if-supported rule, the same duty to
 * report what went unchecked. Two copies of that in two skills is two copies that drift.
 *
 * What is NOT shared is the return contract, and deliberately so — the two are OPPOSITE on the axis
 * that matters. A microscope lens must reason: opinions are the entire point of it. A minion must
 * NOT (NS-24) — it returns citations, because a subagent that concludes puts a lossy summary
 * between the evidence and the decision. Merging those would either silence the lenses or let the
 * minions editorialise, so only the mechanics are unified.
 *
 * Same shape as scripts/gen-contract.mjs: one authored source, generated copies, and a test that
 * fails if a copy is stale.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FRAGMENT_DIR = path.join(HERE, "skill-fragments");
const SKILLS_DIR = path.join(HERE, "../bundle/skills");

/** fragment id → the skills that embed it. */
export const FRAGMENT_TARGETS = {
  "anchored-spawn": ["bearing-microscope", "bearing-minions"],
};

// The marker is COPIED INTO USER REPOSITORIES with the skill, so it must not name a command only
// this repo has — that is the same defect the generated-contract note shipped with (NS-20). Kit
// devs know their own build; a user needs to know their edits here will not survive.
export const beginMarker = (id) =>
  `<!-- BEGIN GENERATED: ${id} — bearing regenerates this block; edits here are replaced on update -->`;
export const endMarker = (id) => `<!-- END GENERATED: ${id} -->`;

/** @param {string} id @returns {string} the block a skill should contain, markers included */
export function renderFragment(id) {
  const body = fs.readFileSync(path.join(FRAGMENT_DIR, `${id}.md`), "utf8").trim();
  return `${beginMarker(id)}\n${body}\n${endMarker(id)}`;
}

/**
 * Replace the marked block in `md`. Returns null when the skill has no such block — a skill that
 * never opted in must not silently acquire one, and a typo'd marker should be loud.
 * @param {string} md @param {string} id
 */
export function replaceFragment(md, id) {
  const start = md.indexOf(beginMarker(id));
  const endTag = endMarker(id);
  const end = md.indexOf(endTag);
  if (start < 0 || end < 0 || end < start) return null;
  return md.slice(0, start) + renderFragment(id) + md.slice(end + endTag.length);
}

export function skillPath(skill) {
  return path.join(SKILLS_DIR, skill, "SKILL.md");
}

/** @returns {{skill: string, id: string, changed: boolean}[]} */
export function generateAll() {
  const results = [];
  for (const [id, skills] of Object.entries(FRAGMENT_TARGETS)) {
    for (const skill of skills) {
      const p = skillPath(skill);
      const before = fs.readFileSync(p, "utf8");
      const after = replaceFragment(before, id);
      if (after === null) {
        throw new Error(`${skill}/SKILL.md has no "${id}" fragment markers — add them or drop it from FRAGMENT_TARGETS`);
      }
      if (after !== before) fs.writeFileSync(p, after);
      results.push({ skill, id, changed: after !== before });
    }
  }
  return results;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  for (const r of generateAll()) {
    console.log(`  ${r.changed ? "wrote" : "up to date"}  ${r.skill} ← ${r.id}`);
  }
}
