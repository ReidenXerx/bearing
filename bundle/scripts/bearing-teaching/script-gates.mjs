#!/usr/bin/env node
/**
 * GitNexus npm scripts — single source of truth.
 *
 * The groups below are only an ordering for the generated package.json block. They used to be
 * "gates" — each group also wrote a `bearing.__gate.<n>.<name>` entry that printed the step of an
 * enforced graph-first loop. The gates were retired (NS-25, NS-28), so no gate entry is written any
 * more, and merging strips the ones earlier versions left behind (see isRetiredGateScript).
 */
import fs from "node:fs";
import path from "node:path";

const WRAP = "bash scripts/run-with-project-tmp.sh";

/** @typedef {{ gate: string, name: string, title: string, description: string, scripts: Record<string, string> }} ScriptGate */

/** @type {ScriptGate[]} */
export const GITNEXUS_SCRIPT_GATES = [
  {
    gate: "1",
    name: "session",
    title: "Session",
    description: "Health check, agent brief, staleness.",
    scripts: {
      "bearing:health": "node scripts/bearing-agent.mjs health",
      "bearing:agent-brief": "node scripts/bearing-agent.mjs brief",
      "bearing:agent-status": "node scripts/bearing-agent.mjs status",
    },
  },
  {
    gate: "2",
    name: "orient",
    title: "Orient",
    description: "Graph smoke test, capabilities, benchmark, maps and failure reports.",
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
    title: "Graph index",
    description: "Build and refresh the index, branch and PR helpers.",
    scripts: {
      "bearing:refresh": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skip-skills`,
      "bearing:full": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skip-skills`,
      "bearing:pdg": `${WRAP} npx gitnexus@latest analyze --embeddings 0 --skip-skills --pdg`,
      "bearing:full-pdg": `${WRAP} npx gitnexus@latest analyze --force --embeddings 0 --skip-skills --pdg`,
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
      "Full kit check + backend probe after install, update, or index build.",
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

/**
 * A `bearing.__gate.*` entry an earlier version wrote: the key shape AND our own gate-hint script
 * as the value (bearing-gate-hint.mjs, or gitnexus-gate-hint.mjs before the rename — no longer
 * shipped). Both, so a key someone repurposed for their own command survives —
 * package.json is theirs, and we only take back what we wrote (NS-1).
 * @param {string} key @param {unknown} value
 */
export function isRetiredGateScript(key, value) {
  return (
    /^(bearing|gitnexus)\.__gate\./.test(key) &&
    typeof value === "string" &&
    /\bscripts\/(bearing|gitnexus)-gate-hint\.mjs\b/.test(value)
  );
}

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

/** All keys managed by the kit. */
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
  // The retired gate entries go first, so an update converges on a block without them (NS-3).
  let removed = 0;
  for (const [key, value] of Object.entries(pkg.scripts)) {
    if (isRetiredGateScript(key, value)) {
      delete pkg.scripts[key];
      removed++;
    }
  }

  for (const [key, value] of Object.entries(gated)) {
    if (pkg.scripts[key] === undefined) added++;
    else if (pkg.scripts[key] !== value) updated++;
    else unchanged++;
    pkg.scripts[key] = value;
  }

  return { added, updated, unchanged, removed, total: Object.keys(gated).length };
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
