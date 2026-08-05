/**
 * FEATURE MODULES.
 *
 * The kit has two orthogonal axes: RUNTIME (which IDE) and FEATURE (which capability). Runtime was
 * always modelled; features were not, so installing anything installed everything — including the
 * GitNexus enforcement gates. In a repo without GitNexus those gates DENY Grep and tell the user to
 * run a command that does not exist, which bricks a basic tool with unfollowable advice.
 *
 * Each feature must stand alone. They compose well, but none may require another to function.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {'northstars'|'taskcore'|'microscope'|'gitnexus'} FeatureId */

export const FEATURES = [
  {
    id: "northstars",
    title: "North-stars — semantic anchor",
    blurb:
      "A short, numbered, authoritative statement of what your project IS — invariants, exact term " +
      "meanings, evidence standards, settled decisions, and a GRAVEYARD of ideas already rejected " +
      "WITH the reason they failed. It outranks every other doc (a conflicting source is stale, not " +
      "a tie), agents must CITE it, and it is re-anchored both periodically and right after a doc " +
      "is written — the moment a drifted premise becomes 'settled'.",
    why: "Stops agents redefining your domain, re-proposing ideas you already killed, and discarding ones you already validated.",
    needsGitnexus: false,
    runtimes: ["claude"], // the re-anchor hook is a Claude PostToolUse hook
    recommended: true,
  },
  {
    id: "taskcore",
    title: "Task-core — survive compaction",
    blurb:
      "A dense, AI-facing save-state of the CURRENT task — goal, constraints, decisions and WHY, " +
      "state, file:line anchors, open questions, and GOTCHAS (approaches already tried that failed). " +
      "Written BEFORE compaction drops the detail — the trigger reads real token usage from the " +
      "transcript rather than guessing — and read back on recovery.",
    why: "Stops a long task losing its goal, and stops the agent cheerfully re-trying what already failed.",
    needsGitnexus: false,
    runtimes: ["claude"], // needs transcript usage + the compaction lifecycle
    recommended: true,
  },
  {
    id: "microscope",
    title: "Microscope — deep multi-lens review",
    blurb:
      "A milestone review routine that first adopts the EXPERT ROLE your project implies (a trading " +
      "repo is reviewed by a quant trader, a payments repo by a ledger engineer), then spawns lenses " +
      "per slice — correctness AND judgment — verifies them adversarially, and iterates in waves.",
    why: "Catches code that runs perfectly and is still the wrong thing — the semantic wrongness a linter cannot see.",
    needsGitnexus: false,
    runtimes: ["cursor", "zed", "claude"],
    recommended: true,
  },
  {
    id: "gitnexus",
    title: "GitNexus enforcement — graph-first reasoning",
    blurb:
      "Hard gates that redirect symbol greps and blind reads to a code knowledge graph. TWO gates: a " +
      "stale index blocks until refreshed, and so does working-tree DRIFT (edit files, queries hold " +
      "until re-indexed). Full tool surface — cypher for what greps cannot express, impact before " +
      "edits, detect_changes before commits, graph-coordinated rename, pdg/taint. Plus a bounded " +
      "escape hatch when the graph is WRONG, logged as a failure report you can send upstream.",
    why: "The deepest capability here: the only one that can BLOCK a wrong tool call rather than advise against it. Needs the GitNexus MCP server + an index.",
    needsGitnexus: true,
    runtimes: ["cursor", "zed", "claude"],
    recommended: true,
  },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);
export const DEFAULT_FEATURES = FEATURE_IDS;

/** @param {string} v comma list, "all", or "" */
export function parseFeatures(v) {
  if (!v || v === "all") return new Set(FEATURE_IDS);
  const toks = String(v)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const bad = toks.filter((t) => !FEATURE_IDS.includes(t));
  if (bad.length) {
    throw new Error(
      `Unknown feature(s): ${bad.join(", ")}. Available: ${FEATURE_IDS.join(", ")}`,
    );
  }
  return new Set(toks);
}

// ── File → feature ownership ────────────────────────────────────────────────
// Anything not claimed by a feature below is CORE and always ships.

const CLAUDE_HOOK_OWNER = {
  "bearing-northstar-anchor.mjs": "northstars",
  "bearing-context-pressure.mjs": "taskcore",
  "bearing-precompact.mjs": "taskcore",
  "bearing-grep-guard.mjs": "gitnexus",
  "bearing-read-guard.mjs": "gitnexus",
  "bearing-edit-guard.mjs": "gitnexus",
  "bearing-bash-guard.mjs": "gitnexus",
  "bearing-mcp-guard.mjs": "gitnexus",
  // bearing-session.mjs is CORE: it carries the north-stars pointer and session hygiene, and
  // degrades to a graph-free brief when the gitnexus feature is off.
};

const SKILL_OWNER = {
  "bearing-northstars": "northstars",
  "bearing-taskcore": "taskcore",
  "bearing-microscope": "microscope",
  // every other skill teaches the graph tool surface
};

// ── Core lib closure, COMPUTED ──────────────────────────────────────────────
// A core module may never depend on a feature module, or the feature's absence breaks core. Rather
// than hand-maintain that invariant (it silently broke twice: claude-emit -> stale-policy,
// hook-helpers -> cypher-helpers), walk the actual import graph from the core entry points and
// treat everything reachable as core.
const CORE_LIB_ENTRIES = [
  "hook-helpers.mjs",
  "session-primer.mjs",
  "claude-emit.mjs",
  "cursor-emit.mjs",
  "clear-session.mjs",
];
const LIB_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bundle/.bearing/lib",
);

let _coreClosure = null;
/** @returns {Set<string>} every .bearing/lib basename reachable from a core entry point */
export function coreLibClosure() {
  if (_coreClosure) return _coreClosure;
  const seen = new Set();
  const stack = [...CORE_LIB_ENTRIES];
  while (stack.length) {
    const base = stack.pop();
    if (seen.has(base)) continue;
    seen.add(base);
    let src = "";
    try {
      src = fs.readFileSync(path.join(LIB_DIR, base), "utf8");
    } catch {
      continue;
    }
    // Strip comments FIRST. JSDoc is full of type-only references —
    // `@param {import('./classify.mjs').Verdict}` — which create no runtime dependency; counting
    // them would wrongly promote a feature module into core and ship it to every install.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Static `from './x.mjs'` AND dynamic `import('./x.mjs')`. Missing the dynamic form would let a
    // core module depend on a feature module invisibly — the closure would report core-clean while
    // the import fails at runtime in a filtered install.
    for (const m of code.matchAll(/from\s+['"]\.\/([\w.-]+\.mjs)['"]/g)) stack.push(m[1]);
    for (const m of code.matchAll(/import\s*\(\s*['"]\.\/([\w.-]+\.mjs)['"]\s*\)/g)) stack.push(m[1]);
  }
  _coreClosure = seen;
  return seen;
}

/** .bearing/lib modules that only make sense with the graph (minus anything core needs). */
const GITNEXUS_LIBS = new Set([
  "check-staleness.mjs",
  "load-staleness.mjs",
  "classify.mjs",
  "agent-brief.mjs",
  "agent-health.mjs",
  "first-nudge.mjs",
  "graph-smoke.mjs",
  "cypher-cli.mjs",
  "cypher-helpers.mjs",
  "detect-api-router.mjs",
  "generate-arch-doc.mjs",
  "commit-message.mjs",
  "persistence-health.mjs",
  "rename-helpers.mjs",
  "session-health-audit.mjs",
  "session-health-context.mjs",
  "set-refresh-pending.mjs",
  "verify-kit.mjs",
  "stabilize-agent-docs.mjs",
]);

// NOTE: stale-policy.mjs is deliberately CORE even though it is about graph staleness — core
// claude-emit.mjs imports it, and a core module may never depend on a feature module. It degrades
// harmlessly when there is no index.

/** taskcore-only lib modules. */
const TASKCORE_LIBS = new Set(["context-pressure.mjs"]);

/**
 * Which feature owns a bundle file? null = core (always ships).
 * @param {string} rel
 * @returns {FeatureId|null}
 */
export function featureOf(rel) {
  if (rel.startsWith(".claude/hooks/")) {
    return CLAUDE_HOOK_OWNER[rel.slice(".claude/hooks/".length)] ?? null;
  }
  if (rel.startsWith(".bearing/lib/")) {
    const base = rel.slice(".bearing/lib/".length);
    if (coreLibClosure().has(base)) return null; // reachable from core → always ships
    if (TASKCORE_LIBS.has(base)) return "taskcore";
    if (GITNEXUS_LIBS.has(base)) return "gitnexus";
    return null; // hook-helpers, session-primer, emit shims → core
  }
  for (const [dir, id] of Object.entries(SKILL_OWNER)) {
    if (rel.startsWith(`skills/${dir}/`) || rel.startsWith(`.bearing/skills/${dir}/`)) return id;
  }
  if (rel.startsWith("skills/") || rel.startsWith(".bearing/skills/")) return "gitnexus";
  // Cursor hooks + the enforcement rule + every runnable script are graph plumbing.
  if (rel.startsWith(".cursor/hooks/")) return "gitnexus";
  if (rel.startsWith(".cursor/rules/") && rel.includes("enforcement")) return "gitnexus";
  if (rel.startsWith("scripts/")) return "gitnexus";
  if (rel.startsWith("docs/")) return "gitnexus";
  return null;
}
