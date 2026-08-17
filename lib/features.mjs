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
      "is written — the moment a drifted premise becomes 'settled'. Ships GOLD PRACTICES alongside: " +
      "numbered GP-# rules for how the work is done ANYWHERE, most of them earned from real defects " +
      "— a claim from reading rather than running is unverified, a test that has never failed has " +
      "never been tested, a fixture chosen for convenience tests the case that cannot fail. Bearing " +
      "owns that file and refreshes it; your north-stars outrank it.",
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
      "Written BEFORE compaction drops the detail — prompted by how much work is UNSAVED (edits " +
      "since the last write), not by a context percentage, because the window is not knowable at " +
      "runtime — and read back on recovery.",
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
    id: "minions",
    title: "Minions — fan out to gather",
    blurb:
      "Wide mechanical work — every call site of a symbol, every file that still uses the old API, " +
      "every migration site — split across a swarm of cheap subagents that each carry the project's " +
      "north-stars and persona, and each return CITATIONS rather than opinions. The agent can " +
      "already spawn subagents; what it does not know is that this is the shape of problem that " +
      "wants one, and that a subagent must never be the thing that concludes.",
    why: "Stops the agent grinding forty files serially — or sampling five and generalising — and stops a cheaper model's summary becoming your conclusion.",
    needsGitnexus: false,
    runtimes: ["claude"], // only Claude Code can spawn subagents with a model choice (NS-14)
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
  "bearing-taskcore-nudge.mjs": "taskcore",
  "bearing-minion-nudge.mjs": "minions",
  "bearing-precompact.mjs": "taskcore",
  "bearing-grep-guard.mjs": "gitnexus",
  "bearing-read-guard.mjs": "gitnexus",
  "bearing-edit-guard.mjs": "gitnexus",
  "bearing-bash-guard.mjs": "gitnexus",
  "bearing-mcp-guard.mjs": "gitnexus",
  "bearing-impact-audit.mjs": "gitnexus",
  // bearing-session.mjs is CORE: it carries the north-stars pointer and session hygiene, and
  // degrades to a graph-free brief when the gitnexus feature is off.
};

const SKILL_OWNER = {
  "bearing-northstars": "northstars",
  "bearing-taskcore": "taskcore",
  "bearing-microscope": "microscope",
  "bearing-minions": "minions",
  // Authoring a PR is milestone judgment, the same kind microscope exists for: the moment work is
  // handed to someone else is the moment its blast radius and its rejected alternatives have to be
  // written down. It uses the graph when there is one and falls back to git + grep when there is
  // not, so it does not belong to the gitnexus module.
  "bearing-pr": "microscope",
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
    // Child-process dependencies: spawnSync(process.execPath, [path.join(LIB, "x.mjs"), …]).
    for (const m of code.matchAll(/["']([\w.-]+\.mjs)["']/g)) {
      if (/\bLIB\b|\blibPath\b|process\.execPath/.test(code)) stack.push(m[1]);
    }
  }
  _coreClosure = seen;
  return seen;
}

/** .bearing/lib modules that only make sense with the graph (minus anything core needs). */
const GITNEXUS_LIBS = new Set([
  "check-staleness.mjs",
  "refresh-plan.mjs",
  "refresh-cli.mjs",
  "gitnexus-cmd.mjs",
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
/** taskcore-only lib modules. (context-pressure.mjs retired: the window is not measurable.) */
const TASKCORE_LIBS = new Set([]);

/** minions-only lib modules. */
const MINION_LIBS = new Set(["verify-citations.mjs"]);

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
    if (MINION_LIBS.has(base)) return "minions";
    if (GITNEXUS_LIBS.has(base)) return "gitnexus";
    return null; // hook-helpers, session-primer, emit shims → core
  }
  // Gold practices ship WITH bearing and belong to the north-stars module: same numbered, cite-able
  // form, same re-anchoring, and the two are read together (NS wins on conflict — a project's own
  // invariant is more specific than a general rule). Unlike northstars.md, which the user owns and
  // bearing never overwrites, this file is bearing's and refreshes on update.
  if (rel === ".bearing/gold-practices.md") return "northstars";
  for (const [dir, id] of Object.entries(SKILL_OWNER)) {
    if (rel.startsWith(`skills/${dir}/`) || rel.startsWith(`.bearing/skills/${dir}/`)) return id;
  }
  if (rel.startsWith("skills/") || rel.startsWith(".bearing/skills/")) return "gitnexus";
  // Cursor hooks + every always-on Cursor rule + every runnable script are graph plumbing. The
  // rules are graph playbooks end to end (bearing.mdc: 42 graph references, bearing-first.mdc: 20),
  // so shipping them to a repo without a graph is instruction the agent cannot act on. Cursor's
  // only non-gitnexus feature is microscope, which travels as a skill rather than a rule.
  if (rel.startsWith(".cursor/hooks/")) return "gitnexus";
  // Every hook it registers is a gitnexus hook, so shipping it without them points Cursor at 12
  // scripts that are not on disk — a failed spawn on every session start, prompt and tool call.
  if (rel === ".cursor/hooks.json") return "gitnexus";
  if (rel.startsWith(".cursor/rules/")) return "gitnexus";
  if (rel.startsWith("scripts/")) return "gitnexus";
  if (rel.startsWith("docs/")) return "gitnexus";
  // Root-level graph plumbing. Each of these is inert-to-broken without the module: the indexer's
  // ignore file configures an indexer that isn't there, the CI workflow gates on graph staleness,
  // and the pre-commit hook calls `npm run bearing:full-pdg` — an npm script only the gitnexus
  // module installs, so a wired hook would fail every commit.
  if (
    rel === ".gitnexusignore" ||
    rel === ".github/workflows/gitnexus-ci.yml" ||
    rel === ".github/workflows/bearing-index-cache.yml" ||
    rel === ".githooks/pre-commit"
  ) {
    return "gitnexus";
  }
  return null;
}
