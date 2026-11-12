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

/** @typedef {'northstars'|'goldpractices'|'taskcore'|'microscope'|'consult'|'minions'|'tsjs'|'frontend'|'react'|'astgrep'|'gitnexus'} FeatureId */

export const FEATURES = [
  {
    id: "northstars",
    title: "North-stars — semantic anchor",
    blurb:
      "A short, numbered, authoritative statement of what your project IS — invariants, exact term " +
      "meanings, evidence standards, settled decisions, and a GRAVEYARD of ideas already rejected " +
      "WITH the reason they failed. It outranks every other doc (a conflicting source is stale, not " +
      "a tie), agents must CITE it, and it is re-anchored both periodically and right after a doc " +
      "is written — the moment a drifted premise becomes 'settled'. Pairs with GOLD PRACTICES, " +
      "which is now its own module: north-stars say what THIS project is, gold practices say how " +
      "the work is done anywhere, and on conflict yours wins.",
    why: "Stops agents redefining your domain, re-proposing ideas you already killed, and discarding ones you already validated.",
    needsGitnexus: false,
    // WHERE THE MODULE DELIVERS SOMETHING, not where its hook runs. The contract — "these outrank
    // every other doc, cite one" — ships to all four and is most of the value; only the
    // mid-session re-anchor is a Claude PostToolUse hook, and that is gated by hook ownership
    // already. Declaring ["claude"] here read as "useless anywhere else" and would have skipped
    // north-stars entirely on a Zed or Codex install.
    runtimes: ["zed", "claude", "codex"],
    recommended: true,
  },
  {
    id: "goldpractices",
    title: "Gold practices — the mistakes that got made anyway",
    blurb:
      "Numbered GP-# rules for how the work is done ANYWHERE, earned from real defects rather than " +
      "invented: a claim from reading rather than running is unverified, a test that has never " +
      "failed has never been tested, a fixture chosen for convenience tests the case that cannot " +
      "fail, a list that must be kept in sync will fall out of sync, establish a contract from the " +
      "thing that DEFINES it and never from something that calls it. Every rule carries the scar " +
      "it came from. Language-neutral and project-neutral — nothing in it names a framework, a " +
      "stack or a tool. Bearing owns the file and refreshes it on update; a project rule belongs " +
      "in your north-stars, which outrank it.",
    why: "Stops the failures that survive being careful — the ones knowing better does not prevent.",
    needsGitnexus: false,
    // A file plus a contract section, both of which every runtime reads. It was part of northstars
    // until it got its own id; see SPLIT_FROM below for why that history has to keep travelling.
    runtimes: ["zed", "claude", "codex"],
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
    // The save-state discipline is useful wherever an agent can write a file, and the contract
    // carries it. The edits NUDGE is a Claude hook, gated separately by hook ownership.
    runtimes: ["zed", "claude", "codex"],
    recommended: true,
  },
  {
    id: "microscope",
    title: "Microscope — deep multi-lens review, when you ask",
    blurb:
      "A review routine you invoke (\"microscope this\") that first adopts the EXPERT ROLE your project implies (a trading " +
      "repo is reviewed by a quant trader, a payments repo by a ledger engineer), then spawns lenses " +
      "per slice — correctness AND judgment — verifies them adversarially, and iterates in waves.",
    why: "Catches code that runs perfectly and is still the wrong thing — the semantic wrongness a linter cannot see.",
    needsGitnexus: false,
    runtimes: ["zed", "claude"],
    recommended: true,
  },
  {
    id: "consult",
    title: "Consult — ask about what changes the product",
    blurb:
      "When to interrupt you and when to just decide. The agent asks about what it cannot find — " +
      "which reading you meant, which tradeoff you prefer, what a user should actually see — as " +
      "options you click (Claude Code's choice tool), not a question you answer in a paragraph, and " +
      "decides the rest from the repo instead of asking. Separately, it CONFIRMS before anything " +
      "irreversible: deleting data, force-pushing, publishing, migrating. The rare answer that is a " +
      "RULE a future task would break is proposed as a north-star, so it is asked once.",
    why: "Stops the two opposite annoyances: permission for boring essentials, and silence while it invents a business rule.",
    needsGitnexus: false,
    // The judgment applies wherever an agent can talk to a human. Claude Code additionally has a
    // structured multiple-choice tool; elsewhere it asks in prose. Codex gets the contract only.
    runtimes: ["zed", "claude"],
    recommended: true,
  },
  {
    id: "minions",
    title: "Minions — fan out to gather, and to apply, when you ask",
    blurb:
      "Wide mechanical work split across a swarm of cheap subagents that each carry the project's " +
      "north-stars and persona. Two contracts: minions that GATHER — every call site, every file " +
      "still on the old API — and return CITATIONS rather than opinions; and INVASIVE minions that " +
      "APPLY a transformation you already decided, each in its own worktree, for the tree-shaped " +
      "changes one agent otherwise grinds through a file at a time (logging coverage, error " +
      "handling, a settled migration). You say when (\"fan this out\"); the skill carries how: a " +
      "gatherer must never conclude, an editor must never decide, and no slice lands until the " +
      "agent has reviewed it.",
    why: "Stops the agent grinding forty files serially — or sampling five and generalising — and stops a cheaper model's summary becoming your conclusion.",
    needsGitnexus: false,
    runtimes: ["claude"], // only Claude Code can spawn subagents with a model choice (NS-14)
    recommended: true,
  },
  {
    id: "tsjs",
    title: "TypeScript/JavaScript — the traps that compile",
    blurb:
      "Numbered TS-# rules for the constructs that type-check, lint clean, and are still wrong at " +
      "runtime: `as` asserts instead of verifying, one `any` un-types everything downstream of it, " +
      "a union without a `never` check falls through silently on the next variant, `||` overwrites " +
      "a deliberate 0, a floating promise sends its rejection where the caller cannot catch it. " +
      "Every rule had to pass one entry test — would tsc AND a standard ESLint config both stay " +
      "silent? — so nothing here duplicates the tooling you already run. Pick it for repos that " +
      "actually write TS/JS: bearing does not detect the language.",
    why: "Stops type-correct code that is wrong at runtime — the failures a green build is not evidence against.",
    needsGitnexus: false,
    // Delivered by a rule file + a contract section + a skill, none of which needs tool
    // interception — so every runtime gets the whole module. Codex has no skills directory to
    // symlink into, but the pack and the contract section are most of the value and reach it.
    runtimes: ["zed", "claude", "codex"],
    // OPT-IN, like e2e. `recommended` is what pressing Enter installs, and a language or
    // framework pack is by definition not universal — defaulting it on puts TypeScript rules in
    // the always-on contract of a Python repo, ~1,400 tokens a session for guidance that cannot
    // apply. This module's own design says packs are per-language; the flag has to agree.
    recommended: false,
  },
  {
    id: "frontend",
    title: "Frontend — structure, and what it costs to change it",
    blurb:
      "Numbered UI-# rules for laying out a rendered UI: a structural unit — a table, a bordered " +
      "panel, a card, a modal shell — is a component, and you SEARCH BY SHAPE for an existing one " +
      "before writing a near-duplicate, because the duplicate is always cheaper to write than to " +
      "find and is always caught in review instead of before it. Editing a shared component is the " +
      "sharp half: you see a five-line diff, the user sees every screen that renders it. An " +
      "optional prop whose default preserves today's output is yours to decide; anything that " +
      "changes what an existing caller renders is an ASK, with the call sites counted. Names no " +
      "framework — pick it for repos with a UI.",
    why: "Stops the near-duplicate component nobody finds until review, and the shared-component edit nobody sees until it is on a user's screen.",
    needsGitnexus: false,
    // A rule file, a contract section and a skill — none of which needs tool interception, so every
    // runtime carries the module. Codex has no skills directory to link into; the pack and the
    // contract section reach it regardless.
    runtimes: ["zed", "claude", "codex"],
    // OPT-IN, like e2e. `recommended` is what pressing Enter installs, and a language or
    // framework pack is by definition not universal — defaulting it on puts TypeScript rules in
    // the always-on contract of a Python repo, ~1,400 tokens a session for guidance that cannot
    // apply. This module's own design says packs are per-language; the flag has to agree.
    recommended: false,
  },
  {
    id: "react",
    title: "React — the parts the library's types do not catch",
    blurb:
      "Numbered REACT-# rules for what type-checks against React and its form library, runs, and is " +
      "still wrong — every one of them by going QUIET rather than by failing. A form field owns its " +
      "Controller so the wiring exists once instead of at every call site; `field` is spread rather " +
      "than destructured, because taking onChange/onBlur/value by hand drops the ref and kills " +
      "focus-on-error with nothing thrown; and a `name` typed `string` instead of FieldPath<T> lets " +
      "a renamed field compile, render, validate clean and contribute NOTHING to the submitted " +
      "payload. Pick it for React repos; it is not a tutorial and skips anything the docs answer.",
    why: "Catches the form bugs that are reported by a user days later as \"it did not save\", because nothing in the code looks wrong.",
    needsGitnexus: false,
    // A rule file, a contract section and a skill — no tool interception, so every runtime carries
    // it. Codex has no skills directory; the pack and the contract section reach it anyway.
    runtimes: ["zed", "claude", "codex"],
    // OPT-IN, like e2e. `recommended` is what pressing Enter installs, and a language or
    // framework pack is by definition not universal — defaulting it on puts TypeScript rules in
    // the always-on contract of a Python repo, ~1,400 tokens a session for guidance that cannot
    // apply. This module's own design says packs are per-language; the flag has to agree.
    recommended: false,
  },
  {
    id: "astgrep",
    title: "ast-grep — search and rewrite by code shape",
    blurb:
      "When the question is about the SHAPE of code — every fetch with no signal, every catch that " +
      "swallows, every handler not wrapped in the audit call — the agent searches the syntax tree " +
      "with ast-grep instead of a regex that misses a call split over lines and hits the same words " +
      "in a comment. The skill carries what makes that safe: a pattern that does not parse returns " +
      "the same empty result as a clean codebase, `-l ts` silently skips .tsx, and a `not:` whose inner rule never " +
      "matches excludes nothing — so every pattern is proven on a known site before its count is " +
      "trusted, and every rewrite is previewed, applied, then searched again to show zero. Uses " +
      "ast-grep from PATH, or downloads it with npx on first use; nothing is added to package.json.",
    why: "Stops a confident \"there are none\" from a pattern that never matched anything, and turns a 100-site rewrite into one checked rule.",
    needsGitnexus: false,
    // A contract section and a skill — no tool interception — so any agent with a shell gets it.
    runtimes: ["zed", "claude", "codex"],
    // OPT-IN until an eval shows it changes what the agent does (NS-23). It is a tool, like the
    // graph, and NS-29 is the record of a tool taught to agents that went unused.
    recommended: false,
  },
  {
    id: "gitnexus",
    title: "GitNexus code graph — opt-in, used when you ask",
    blurb:
      "A knowledge graph of this repo (symbols, calls, imports, execution flows) served to the agent " +
      "over MCP, plus one skill, bearing-gitnexus, that loads when you ask for the graph. No gates, no " +
      "nudges, no always-on instructions: grep and Read stay the defaults.",
    why: "Worth it on large codebases, for questions text search answers badly — the blast radius of a change, what a diff affects indirectly, renames across files. Needs the gitnexus CLI and an index build.",
    needsGitnexus: true,
    runtimes: ["zed", "claude"],
    // OPT-IN (NS-25). It was recommended, so Enter installed it: an index build, an MCP server and
    // nineteen skills pulling the agent towards the graph on every task. The installer now asks
    // about it in a step of its own, with what it costs and when it helps.
    recommended: false,
    askSeparately: true,
  },
  {
    id: "e2e",
    title: "E2E harness — verify in a real browser",
    blurb:
      "A `.e2e/` browser harness the project FINISHES: working substrate (report + exit code, " +
      "polling waits, request/response readers, screenshots keyed by view) plus CONTRACT STUBS the " +
      "agent fills in for your app. Carries the scars — a skip stored as a pass turning an " +
      "all-skipped run green, a URL pattern that matched the list instead of the create, a 2xx " +
      "carrying an error envelope, a blanket POST block that severed the session and made a working " +
      "feature look missing. `blockWrites` tests a destructive write WITHOUT performing it. Every " +
      "run records ITSELF: a frame for each failed check, one for an uncaught crash, and video of " +
      "the whole thing — because a verifier otherwise captures only moments someone predicted, and " +
      "nobody predicts where a failure lands.",
    why: "Turns 'I checked it in the browser' into an exit code, and stops the agent reporting a green run that verified nothing.",
    needsGitnexus: false,
    // Any agent that can write a file can write a verifier; the judgment travels in the skill and
    // the README, so this is not runtime-gated.
    runtimes: ["zed", "claude", "codex"],
    // The ONLY feature that is off by default. It writes a new top-level directory, declares a
    // playwright dependency, and is inert without a running app to point at — three reasons a repo
    // must ASK for it rather than receive it for pressing Enter (NS-1).
    recommended: false,
    // The release that introduced it. Off-by-default plus silent-on-update equals a module nobody
    // ever discovers, so an update that CROSSES this version says the module now exists. Only that
    // update: a user who declined it is not asked again (see whatsNewModules).
    since: "1.1.6",
  },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);

/**
 * What an install gets when nobody said. NOT the same as `"all"`, and the difference is the point:
 * a module that writes a new top-level directory into someone's repo has to be asked for, not
 * received by default (NS-1). `--features all` still means all — an explicit ask is an answer.
 */
export const defaultFeatureIds = () => FEATURES.filter((f) => f.recommended).map((f) => f.id);

/**
 * Modules that NO active runtime can support — selected, but inert wherever they landed.
 *
 * `runtimes` means "where this module's ENFORCING implementation lives", not "where it is useful".
 * north-stars declares `["claude"]` because only Claude Code re-anchors mid-session, yet its
 * contract ships to all four runtimes — so this must NOT be used to filter the contract. It answers
 * one narrow question: did the user select a module that can do nothing at all here?
 */
export function unsupportedFeatures(features, runtimeIds) {
  if (!features) return [];
  return [...features].filter((id) => {
    const f = FEATURES.find((x) => x.id === id);
    if (!f?.runtimes) return false;
    return !runtimeIds.some((r) => f.runtimes.includes(r));
  });
}

/**
 * Resolve `--features` against what the repo already has.
 *
 * A bare list REPLACES, which is right for install and wrong for update: adding one module meant
 * retyping the other six correctly, and getting that list wrong silently UNINSTALLS whatever was
 * left out. So a spec whose every token is signed is a DELTA — `+e2e`, `-minions`, `+e2e,-consult`.
 *
 * All-or-nothing on the signs, deliberately: `northstars,+e2e` could mean either operation, and
 * guessing at that would silently drop five modules. Mixed specs fall through to replacement, which
 * then fails on the `+` as an unknown feature name rather than doing something surprising.
 *
 * @param {string|undefined|null} spec @param {string[]|undefined} base currently-enabled ids
 * @returns {string|undefined} a comma list for parseFeatures, or undefined when nobody said
 */
export function applyFeatureDelta(spec, base) {
  if (spec === undefined || spec === null || spec === "") return undefined;
  const toks = String(spec).split(",").map((t) => t.trim()).filter(Boolean);
  if (!toks.length || !toks.every((t) => t.startsWith("+") || t.startsWith("-"))) return spec;
  const set = new Set(base ?? []);
  for (const tok of toks) {
    const id = tok.slice(1);
    if (!FEATURE_IDS.includes(id)) {
      throw new Error(`Unknown feature(s): ${id}. Available: ${FEATURE_IDS.join(", ")}`);
    }
    if (tok[0] === "+") set.add(id);
    else set.delete(id);
  }
  // Everything removed is a real answer, but an empty string means "nobody said" to parseFeatures,
  // which would then reinstate the whole default set — the opposite of what was asked.
  return set.size ? [...set].join(",") : "none";
}

/**
 * Modules that were split OUT of another module, and the module they were split from.
 *
 * A recorded feature list states what the user chose — and it was written before the split existed,
 * so it cannot possibly name the new id. Update REMOVES files whose owning feature is not selected
 * (kit.mjs, "A file the BUNDLE no longer ships is also ours to take back"), so without this a repo
 * that said yes to `northstars` in 1.1.x would have .bearing/gold-practices.md deleted by the next
 * update, silently, as a consequence of having agreed to it earlier.
 *
 * Inheritance applies ONLY to a set read back from the manifest. An explicit `--features northstars`
 * is a choice made with the new id available, and must be honoured as written.
 */
const SPLIT_FROM = { goldpractices: "northstars" };

/**
 * Grant a recorded feature set the modules that have since been split out of what it selected.
 * @param {Set<string>} features a set read back from a manifest
 * @returns {Set<string>} a new set; the input is not modified
 */
export function inheritSplitFeatures(features) {
  const out = new Set(features);
  for (const [id, parent] of Object.entries(SPLIT_FROM)) {
    if (out.has(parent)) out.add(id);
  }
  return out;
}

/**
 * Turn a feature array read back from a manifest into a spec string for {@link parseFeatures}.
 *
 * `[]` is a REAL ANSWER — the user selected nothing — but `[].join(",")` is `""`, which
 * parseFeatures reads as "nobody said" and answers with the full recommended set. So a repo
 * installed with `--features none` had all eleven modules reinstated by its very next `update`,
 * writing files into a repo that had explicitly declined every one of them (NS-1), and silently
 * re-adding the graph gates a repo had turned off (NS-13). `applyFeatureDelta` guards this exact
 * trap already, and says so in its own comment; the manifest-read path had the identical hole.
 *
 * @param {string[]} recorded @returns {string}
 */
export function featureSpecOf(recorded) {
  return recorded.length ? recorded.join(",") : "none";
}

/** @param {string} v comma list, "all", or "" */
export function parseFeatures(v) {
  if (!v || v === "all") return new Set(FEATURE_IDS);
  if (v === "none") return new Set();
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
  "bearing-precompact.mjs": "taskcore",
  "bearing-impact-audit.mjs": "gitnexus",
  // Missing until it was added, so it counted as CORE and shipped to every install (NS-13). The
  // microscope and minion nudges that used to sit here are retired: both modules are user-invoked.
  "bearing-consult-nudge.mjs": "consult",
  // bearing-session.mjs is CORE: it carries the north-stars pointer and session hygiene, and
  // degrades to a graph-free brief when the gitnexus feature is off.
};

const SKILL_OWNER = {
  "bearing-northstars": "northstars",
  "bearing-taskcore": "taskcore",
  "bearing-microscope": "microscope",
  "bearing-minions": "minions",
  // Same module, second contract. A repo that declined the fan-out judgment does not want the
  // editing version of it either, and splitting them would duplicate the anchored-spawn block, the
  // tier rule and the scope gate — the parts that are identical because the judgment is identical.
  // What differs is only what a minion may DECIDE, and that lives in the skill.
  "bearing-invasive-minions": "minions",
  "bearing-consult": "consult",
  "bearing-tsjs": "tsjs",
  "bearing-frontend": "frontend",
  "bearing-react": "react",
  "bearing-astgrep": "astgrep",
  // Authoring a PR is milestone judgment, the same kind microscope exists for: the moment work is
  // handed to someone else is the moment its blast radius and its rejected alternatives have to be
  // written down. It uses the graph when there is one and falls back to git + grep when there is
  // not, so it does not belong to the gitnexus module.
  "bearing-pr": "microscope",
  "bearing-e2e": "e2e",
  // every other skill teaches the graph tool surface
};

/**
 * Rule packs → the feature that owns them. One entry per shipped pack, keyed by full path.
 *
 * Two axes live here and they are not the same thing: `lang/` packs are properties of a LANGUAGE,
 * `stack/` packs are properties of a kind of PROGRAM. A TypeScript CLI has no components, so the
 * frontend pack is not a language pack with a different name.
 */
export const PACK_DIRS = [".bearing/lang/", ".bearing/stack/"];
export const PACK_OWNER = {
  // TS and JS share one pack: every trap in it is the language's, not the dialect's.
  ".bearing/lang/typescript.md": "tsjs",
  ".bearing/stack/frontend.md": "frontend",
  ".bearing/stack/react.md": "react",
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
  "agent-brief.mjs",
  "agent-health.mjs",
  "graph-smoke.mjs",
  "cypher-cli.mjs",
  "cypher-helpers.mjs",
  "detect-api-router.mjs",
  "generate-arch-doc.mjs",
  "commit-message.mjs",
  "persistence-health.mjs",
  "rename-helpers.mjs",
  "session-health-audit.mjs",
  "set-refresh-pending.mjs",
  "verify-kit.mjs",
  "stabilize-agent-docs.mjs",
  // The scope check the bearing-gitnexus skill runs (`node .bearing/lib/index-scope.mjs`).
  "index-scope.mjs",
]);

/** taskcore-only lib modules. */
/** taskcore-only lib modules. (context-pressure.mjs retired: the window is not measurable.) */
const TASKCORE_LIBS = new Set([]);

/** minions-only lib modules. */
const MINION_LIBS = new Set(["verify-citations.mjs", "minion-review.mjs"]);

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
  // Gold practices are their own module. They were part of northstars — same numbered, cite-able
  // form, and the two are still read together (NS wins on conflict) — but the content is
  // language- and project-neutral where north-stars are neither, and binding them meant you could
  // not take one without the other. Unlike northstars.md, which the user owns and bearing never
  // overwrites, this file is bearing's and refreshes on update.
  if (rel === ".bearing/gold-practices.md") return "goldpractices";
  // The north-stars doc belongs to its module like any other file, so declining the module does not
  // install it and a later `-northstars` takes it back. It is SEED-ONCE (kit-shared.mjs): bearing
  // writes the starter on first install and never writes it again, because by the second run every
  // word in it is the user's.
  if (rel === ".bearing/northstars.md") return "northstars";
  // Language packs: one file per language, one FEATURE per language, so a repo installs rules for
  // the languages it actually writes and a Python repo carries no TypeScript. Same ownership as
  // gold-practices above — bearing's file, refreshed on update, never seed-once. An unmapped pack
  // would fall through to core and ship everywhere, so a test asserts every pack in the bundle is
  // named here and that its owner is a real feature id.
  if (PACK_DIRS.some((d) => rel.startsWith(d))) return PACK_OWNER[rel] ?? null;
  for (const [dir, id] of Object.entries(SKILL_OWNER)) {
    if (rel.startsWith(`skills/${dir}/`) || rel.startsWith(`.bearing/skills/${dir}/`)) return id;
  }
  if (rel.startsWith("skills/") || rel.startsWith(".bearing/skills/")) return "gitnexus";
  if (rel.startsWith("scripts/")) return "gitnexus";
  if (rel.startsWith("docs/")) return "gitnexus";
  // The whole harness is one feature. A repo that declined it must not find a Playwright kit and a
  // package.json declaring a dependency it never asked for — an unowned path here returns null,
  // which means CORE, which means it ships to everyone (NS-1).
  if (rel.startsWith(".e2e/")) return "e2e";
  // Root-level graph plumbing: the indexer's ignore file configures an indexer that isn't there
  // without the module. (The pre-commit refresh and the two CI workflows that rebuilt and read a
  // cached index were retired — the index is refreshed when the developer asks, NS-25. An update
  // takes them back as files the bundle no longer ships.)
  if (rel === ".gitnexusignore") return "gitnexus";
  return null;
}
