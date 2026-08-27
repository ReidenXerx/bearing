#!/usr/bin/env node
/**
 * GitNexus npm script gates — single source of truth.
 * Maps enforcement-rule gates to copy-paste npm commands (with comment gate entries in package.json).
 */
import fs from "node:fs";
import path from "node:path";

const WRAP = "bash scripts/run-with-project-tmp.sh";
const GATE_HINT = "node scripts/bearing-gate-hint.mjs";

/** @typedef {{ gate: string, name: string, title: string, description: string, scripts: Record<string, string> }} ScriptGate */

/** @type {ScriptGate[]} */
export const GITNEXUS_SCRIPT_GATES = [
  {
    gate: "1",
    name: "session",
    title: "Gate 1 — Session start",
    description:
      "Before task work: health check, agent brief, staleness. Matches enforcement rule + session-health hooks.",
    scripts: {
      "bearing:health": "node scripts/bearing-agent.mjs health",
      "bearing:agent-brief": "node scripts/bearing-agent.mjs brief",
      "bearing:agent-status": "node scripts/bearing-agent.mjs status",
    },
  },
  {
    gate: "2",
    name: "orient",
    title: "Gate 2–4 — Orient, drill, Cypher (agents use MCP)",
    description:
      "Fuzzy work → query (embeddings). Symbols → context. Structural → cypher. Hooks inject MCP calls — not separate npm scripts.",
    scripts: {
      "bearing:graph-smoke": "node scripts/bearing-agent.mjs graph-smoke",
      "bearing:capabilities": "node scripts/bearing-agent.mjs capabilities",
      "bearing:token-benchmark": "node scripts/bearing-agent.mjs token-benchmark",
  // Ordering, never filtering — see the header of the script for why that distinction is
  // the entire design.
  "bearing:test-order": "node scripts/bearing-test-order.mjs --report",
      "bearing:detect-api": "node scripts/bearing-agent.mjs detect-api",
      "bearing:scorecard": "node scripts/bearing-agent.mjs scorecard",
      "bearing:stats": "node scripts/bearing-agent.mjs stats",
      "bearing:map": "node scripts/bearing-agent.mjs map",
      "bearing:fallback": "node scripts/bearing-agent.mjs fallback",
      "bearing:fallback:off": "node scripts/bearing-agent.mjs fallback:off",
      "bearing:fallback-log": "node scripts/bearing-agent.mjs fallback-log",
      "bearing:northstars": "node scripts/bearing-agent.mjs northstars",
    },
  },
  {
    gate: "5",
    name: "index",
    title: "Gate 5 — Graph index (fresh embeddings)",
    description:
      "Humans/CI refresh the graph. Agents run bearing:agent-refresh autonomously when stale (hook pre-approved).",
    scripts: {
      "bearing:refresh": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skills`,
      "bearing:full": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skills`,
      "bearing:pdg": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skills --pdg`,
      "bearing:full-pdg": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skills --pdg`,
      "bearing:status": `${WRAP} npx gitnexus@latest status`,
      "bearing:agent-refresh": "node scripts/bearing-agent.mjs refresh",
      "bearing:agent-review": "node scripts/bearing-agent.mjs review",
      "bearing:pr-impact": "node scripts/bearing-agent.mjs pr-impact",
      "bearing:branch-status": "node scripts/bearing-agent.mjs branch-status",
      "bearing:commit-msg": "node scripts/bearing-agent.mjs commit-msg",
      "bearing:clean-tmp": "bash scripts/clean-project-tmp.sh",
      "bearing:list": `${WRAP} npx gitnexus@latest list`,
    },
  },
  {
    gate: "6",
    name: "verify",
    title: "Install / CI verification",
    description:
      "Full kit check + backend probe after install, update, or index build. Run before demoing to GitNexus authors.",
    scripts: {
      "bearing:verify": "node scripts/bearing-agent.mjs verify",
      "bearing:doctor": "node scripts/bearing-agent.mjs doctor",
      "bearing:ci": "node scripts/bearing-ci.mjs",
    },
  },
  {
    gate: "kit",
    name: "maintainer",
    title: "Kit maintenance",
    description:
      "Re-sync teaching bundle, hooks, and pack for other repos after pulling kit updates.",
    scripts: {
      "bearing:setup": "bash scripts/bearing-setup.sh",
      "bearing:sync-teaching": "bash scripts/sync-cursor-bearing-teaching.sh",
      "bearing:pack": "bash scripts/pack-bearing-teaching.sh",
      "hooks:install": "bash scripts/install-git-hooks.sh",
    },
  },
  {
    gate: "opt",
    name: "wiki",
    title: "Optional — wiki generation",
    description:
      "Generate repo wiki from the graph (requires OpenAI API key in env).",
    scripts: {
      "bearing:wiki": `${WRAP} npx gitnexus@latest wiki --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
      "bearing:wiki-force": `${WRAP} npx gitnexus@latest wiki --force --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
    },
  },
];

/** Gate comment script key → prints gate title + description when run. */
export function gateCommentKey(g) {
  return `bearing.__gate.${g.gate}.${g.name}`;
}

/** Ordered scripts block for package.json (gate hints + commands). */
/**
 * How the generated scripts invoke gitnexus. `npx gitnexus@latest` needs no global install and is
 * the right default, but a machine running a LOCAL build wants its own binary — otherwise
 * `bearing:refresh` rebuilds the index with the PUBLISHED analyzer while everything else uses the
 * local one. That is the "same version string, different code" hazard, and it is silent: the index
 * is simply rebuilt by a different program than the one you are developing.
 */
export const DEFAULT_GITNEXUS_CMD = "npx gitnexus@latest";

/** @param {{ gitnexusCmd?: string }} [opts] */
export function buildGatedScripts({ gitnexusCmd = DEFAULT_GITNEXUS_CMD } = {}) {
  const sub = (c) => c.split(DEFAULT_GITNEXUS_CMD).join(gitnexusCmd);
  /** @type {Record<string, string>} */
  const out = {};
  for (const g of GITNEXUS_SCRIPT_GATES) {
    out[gateCommentKey(g)] = `${GATE_HINT} ${g.gate}-${g.name}`;
    for (const [key, rawCmd] of Object.entries(g.scripts)) {
      const cmd = sub(rawCmd);
      out[key] = cmd;
      // LEGACY ALIAS. The kit was renamed gitnexus-agent-kit -> bearing, but these script names are
      // not just muscle memory: they are invoked BY NAME from user-owned git hooks (a pre-commit
      // running `npm run gitnexus:full-pdg`) and from CI. A hard cut would break commits on every
      // existing install, so both names resolve to the same command. Legacy names are deprecated
      // and can be dropped once installs have cycled.
      const legacy = key.replace(/^bearing:/, "gitnexus:");
      if (legacy !== key) out[legacy] = cmd;
    }
  }
  return out;
}

/** Flat command map without gate comment entries (manifest / uninstall). */
export function flatGitnexusScripts() {
  /** @type {Record<string, string>} */
  const out = {};
  for (const g of GITNEXUS_SCRIPT_GATES) {
    Object.assign(out, g.scripts);
  }
  return out;
}

/** All keys managed by the kit (including gate comments). */
export function allManagedScriptKeys() {
  return Object.keys(buildGatedScripts());
}

/** @deprecated alias */
export const GITNEXUS_NPM_SCRIPTS = flatGitnexusScripts();

/**
 * @param {object} pkg
 */
export function mergeGitnexusScripts(pkg, opts = {}) {
  pkg.scripts ??= {};
  const gated = buildGatedScripts(opts);
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [key, value] of Object.entries(gated)) {
    if (pkg.scripts[key] === undefined) added++;
    else if (pkg.scripts[key] !== value) updated++;
    else unchanged++;
    pkg.scripts[key] = value;
  }

  return { added, updated, unchanged, total: Object.keys(gated).length };
}

/**
 * @param {string} pkgPath
 * @param {{ createIfMissing?: boolean, repoName?: string }} opts
 */
export function mergeIntoPackageJson(pkgPath, opts = {}) {
  const abs = path.resolve(pkgPath);
  let pkg;
  // Did WE bring this file into existence? Same question `addedEngines` below already asks about a
  // FIELD, never asked about the file holding it. In a Python repo there is no package.json, so a
  // normal install creates one — and uninstall then left `{"name":…,"scripts":{}}` behind: a Node
  // manifest in a Python project, put there by a tool that had just been removed, which makes npm,
  // Dependabot and CI treat the repo as a Node package (NS-1, NS-22).
  const createdPackageJson = !fs.existsSync(abs) && opts.createIfMissing === true;

  if (fs.existsSync(abs)) {
    pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
  } else if (opts.createIfMissing) {
    pkg = {
      name: opts.repoName ?? path.basename(path.dirname(abs)),
      version: "1.0.0",
      private: true,
      scripts: {},
    };
  } else {
    throw new Error(`package.json not found: ${abs}`);
  }

  const stats = mergeGitnexusScripts(pkg, { gitnexusCmd: opts.gitnexusCmd });

  // Our scripts need Node 22.9, so declaring it is right — but this is the USER's manifest, and an
  // engines floor is enforced by npm under `engine-strict`, by Yarn always, and by CI. Left behind
  // after uninstall it fails their build on Node 20 for a tool they removed. Report whether WE added
  // it so uninstall can take back exactly what it gave, and never touch a floor they set themselves.
  const addedEngines = !pkg.engines?.node;
  if (addedEngines) {
    pkg.engines ??= {};
    pkg.engines.node = ">=22.9.0";
  }

  fs.writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
  return { ...stats, addedEngines, createdPackageJson };
}

/** @param {string} gateId e.g. "1-session" */
export function findGate(gateId) {
  const [gate, ...rest] = gateId.split("-");
  const name = rest.join("-");
  return GITNEXUS_SCRIPT_GATES.find((g) => g.gate === gate && g.name === name);
}
