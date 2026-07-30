#!/usr/bin/env node
/**
 * GitNexus npm script gates — single source of truth.
 * Maps enforcement-rule gates to copy-paste npm commands (with comment gate entries in package.json).
 */
import fs from "node:fs";
import path from "node:path";

const WRAP = "bash scripts/run-with-project-tmp.sh";
const GATE_HINT = "node scripts/gitnexus-gate-hint.mjs";

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
      "gitnexus:health": "node scripts/gitnexus-agent.mjs health",
      "gitnexus:agent-brief": "node scripts/gitnexus-agent.mjs brief",
      "gitnexus:agent-status": "node scripts/gitnexus-agent.mjs status",
    },
  },
  {
    gate: "2",
    name: "orient",
    title: "Gate 2–4 — Orient, drill, Cypher (agents use MCP)",
    description:
      "Fuzzy work → query (embeddings). Symbols → context. Structural → cypher. Hooks inject MCP calls — not separate npm scripts.",
    scripts: {
      "gitnexus:graph-smoke": "node scripts/gitnexus-agent.mjs graph-smoke",
      "gitnexus:detect-api": "node scripts/gitnexus-agent.mjs detect-api",
      "gitnexus:scorecard": "node scripts/gitnexus-agent.mjs scorecard",
      "gitnexus:stats": "node scripts/gitnexus-agent.mjs stats",
      "gitnexus:map": "node scripts/gitnexus-agent.mjs map",
      "gitnexus:fallback": "node scripts/gitnexus-agent.mjs fallback",
      "gitnexus:fallback:off": "node scripts/gitnexus-agent.mjs fallback:off",
      "gitnexus:fallback-log": "node scripts/gitnexus-agent.mjs fallback-log",
      "gitnexus:northstars": "node scripts/gitnexus-agent.mjs northstars",
    },
  },
  {
    gate: "5",
    name: "index",
    title: "Gate 5 — Graph index (fresh embeddings)",
    description:
      "Humans/CI refresh the graph. Agents run gitnexus:agent-refresh autonomously when stale (hook pre-approved).",
    scripts: {
      "gitnexus:refresh": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skills`,
      "gitnexus:full": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skills`,
      "gitnexus:pdg": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skills --pdg`,
      "gitnexus:full-pdg": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skills --pdg`,
      "gitnexus:status": `${WRAP} npx gitnexus@latest status`,
      "gitnexus:agent-refresh": "node scripts/gitnexus-agent.mjs refresh",
      "gitnexus:agent-review": "node scripts/gitnexus-agent.mjs review",
      "gitnexus:pr-impact": "node scripts/gitnexus-agent.mjs pr-impact",
      "gitnexus:branch-status": "node scripts/gitnexus-agent.mjs branch-status",
      "gitnexus:commit-msg": "node scripts/gitnexus-agent.mjs commit-msg",
      "gitnexus:clean-tmp": "bash scripts/clean-project-tmp.sh",
      "gitnexus:list": `${WRAP} npx gitnexus@latest list`,
    },
  },
  {
    gate: "6",
    name: "verify",
    title: "Install / CI verification",
    description:
      "Full kit check + backend probe after install, update, or index build. Run before demoing to GitNexus authors.",
    scripts: {
      "gitnexus:verify": "node scripts/gitnexus-agent.mjs verify",
      "gitnexus:doctor": "node scripts/gitnexus-agent.mjs doctor",
      "gitnexus:ci": "node scripts/gitnexus-ci.mjs",
    },
  },
  {
    gate: "kit",
    name: "maintainer",
    title: "Kit maintenance",
    description:
      "Re-sync teaching bundle, hooks, and pack for other repos after pulling kit updates.",
    scripts: {
      "gitnexus:setup": "bash scripts/gitnexus-setup.sh",
      "gitnexus:sync-teaching": "bash scripts/sync-cursor-gitnexus-teaching.sh",
      "gitnexus:pack": "bash scripts/pack-gitnexus-teaching.sh",
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
      "gitnexus:wiki": `${WRAP} npx gitnexus@latest wiki --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
      "gitnexus:wiki-force": `${WRAP} npx gitnexus@latest wiki --force --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
    },
  },
];

/** Gate comment script key → prints gate title + description when run. */
export function gateCommentKey(g) {
  return `gitnexus.__gate.${g.gate}.${g.name}`;
}

/** Ordered scripts block for package.json (gate hints + commands). */
export function buildGatedScripts() {
  /** @type {Record<string, string>} */
  const out = {};
  for (const g of GITNEXUS_SCRIPT_GATES) {
    out[gateCommentKey(g)] = `${GATE_HINT} ${g.gate}-${g.name}`;
    Object.assign(out, g.scripts);
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
export function mergeGitnexusScripts(pkg) {
  pkg.scripts ??= {};
  const gated = buildGatedScripts();
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

  const stats = mergeGitnexusScripts(pkg);

  if (!pkg.engines?.node) {
    pkg.engines ??= {};
    pkg.engines.node = ">=22.9.0";
  }

  fs.writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
  return stats;
}

/** @param {string} gateId e.g. "1-session" */
export function findGate(gateId) {
  const [gate, ...rest] = gateId.split("-");
  const name = rest.join("-");
  return GITNEXUS_SCRIPT_GATES.find((g) => g.gate === gate && g.name === name);
}
