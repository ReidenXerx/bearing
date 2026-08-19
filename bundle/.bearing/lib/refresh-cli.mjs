#!/usr/bin/env node
/**
 * Run the cheapest refresh that fixes what is actually wrong.
 *
 * Diagnose first, then act: `check-staleness` already knows how many SOURCE files moved, whether
 * embeddings exist and whether the history diverged, and that is everything needed to pick between
 * doing nothing, an incremental pass, and a genuine full rebuild. Before this, every automatic path
 * asked for the most expensive option unconditionally.
 *
 *   node .bearing/lib/refresh-cli.mjs [root] [--pdg] [--force] [--dry-run]
 *
 * Exit 0 when the index is usable afterwards — including when there was nothing to do. A refresh
 * that fails is reported by the caller, which decides whether that blocks anything (it must not:
 * NS-5, a false deny is worse than a missed gate).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith("--")) || process.cwd());
const wantPdg = args.includes("--pdg");
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");

const lib = (rel) => import(pathToFileURL(path.join(root, ".bearing/lib", rel)).href);

/** The staleness checker prints JSON on stdout; a non-zero exit or unparseable output is "unknown". */
function diagnose() {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(root, ".bearing/lib/check-staleness.mjs"), root],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out);
  } catch {
    return null; // no checker, or it failed — planRefresh treats this as "no usable index"
  }
}

/**
 * The resolved `gitnexus` invocation for this repo. Mirrors what the npm scripts use so a repo that
 * pinned a local binary is not silently sent to a different version.
 */
function gitnexusCmd() {
  const pkgPath = path.join(root, "package.json");
  try {
    const scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts ?? {};
    const ref = scripts["bearing:refresh"] || "";
    const m = ref.match(/(\S*gitnexus(?:@\S+)?)\s+analyze/);
    if (m) return m[1];
  } catch {
    /* no package.json — stealth installs have no npm scripts at all */
  }
  return "gitnexus";
}

/**
 * Is this a stealth install? Read from the manifest, which is the only record of the choice — the
 * absence of npm scripts is suggestive but not proof (a non-node repo has none either).
 */
function isStealth() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".bearing/manifest.json"), "utf8")).stealth === true;
  } catch {
    return false; // no manifest → assume the ordinary install, which is the safe direction here
  }
}

const { planRefresh } = await lib("refresh-plan.mjs");
const stale = diagnose();
const plan = planRefresh(stale, { wantPdg, force, stealth: isStealth() });

if (plan.tier === "none") {
  console.log(`==> GitNexus: ${plan.why}`);
  process.exit(0);
}

const bin = gitnexusCmd();
console.log(`==> GitNexus refresh [${plan.tier}] — ${plan.why}`);
console.log(`    ${bin} ${plan.args.join(" ")}`);
if (dryRun) process.exit(0);

const startedAt = Date.now();
const r = spawnSync(bin, plan.args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
const seconds = Math.round((Date.now() - startedAt) / 1000);
if (r.status !== 0) {
  console.error(`==> refresh failed (exit ${r.status ?? "signal"})`);
  process.exit(r.status || 1);
}

// WHAT IT COST, so the next message that suggests a refresh can say so.
//
// Every hint shipped the same words — "incremental, usually quick" — regardless of repo. Measured:
// 52s on a 258-file repo and 573s on a 3,000-file one. An order of magnitude, identical wording, so
// the reader learned nothing from it and had to guess whether to interrupt themselves.
//
// Per machine and per tier: the same repo costs wildly different amounts for an incremental pass
// versus a forced rebuild, and this is a local measurement, not a fact about the project.
try {
  const file = path.join(root, ".bearing", ".gitnexus-refresh-cost.json");
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* first refresh on this machine */
  }
  all[plan.tier] = { seconds, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  console.log(`    took ${seconds}s`);
} catch {
  /* a cost we could not record is a missing hint, not a failed refresh */
}

// The analyzer writes its volatile stats block into AGENTS.md / CLAUDE.md. Strip it here so the
// churn never reaches a commit — and, in a stealth install, never reaches `git status` at all.
try {
  const { stabilizeAgentDocs } = await lib("stabilize-agent-docs.mjs");
  stabilizeAgentDocs(root);
} catch {
  /* the docs are tidier with it and correct without it */
}
