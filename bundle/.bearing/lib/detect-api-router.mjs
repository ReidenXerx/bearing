#!/usr/bin/env node
/**
 * Detect Express/framework vs custom hand-rolled HTTP router after index build.
 * Writes .bearing/gitnexus-api-profile.json for agent-brief and api-routes skill routing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoName } from './hook-helpers.mjs';
import { gitnexusSpawn } from './gitnexus-cmd.mjs';

export const API_PROFILE_FILE = '.bearing/gitnexus-api-profile.json';

const FRAMEWORK_RES = [
  /\bexpress\s*\(/,
  /\bfrom\s+['"]express['"]/,
  /\bfastify\s*\(/,
  /\bfrom\s+['"]fastify['"]/,
  /\b@hono\/hono/,
  /\bnew\s+Hono\s*\(/,
  /\bapp\.(get|post|put|patch|delete|use)\s*\(/,
  /\brouter\.(get|post|put|patch|delete)\s*\(/,
];

// Generic hand-rolled-router signals (framework-neutral; no repo-specific symbols).
const CUSTOM_SYMBOLS = [
  'dispatchRequest',
  'routeRequest',
  'matchRoute',
  'handleHttpRequest',
  'createRouter',
];

/**
 * @param {string} root
 */
function scanSourceHeuristics(root) {
  const hits = { framework: 0, custom: 0, customSymbols: [] };
  const dirs = ['src', 'lib', 'apps', 'packages', 'server', 'api'];
  const exts = new Set(['.js', '.mjs', '.ts', '.tsx']);

  function walk(dir, depth = 0) {
    if (depth > 6 || !fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      const ext = path.extname(ent.name);
      if (!exts.has(ext)) continue;
      let text;
      try {
        text = fs.readFileSync(abs, 'utf8').slice(0, 120_000);
      } catch {
        continue;
      }
      for (const re of FRAMEWORK_RES) {
        if (re.test(text)) hits.framework++;
      }
      for (const sym of CUSTOM_SYMBOLS) {
        if (text.includes(sym) && !hits.customSymbols.includes(sym)) {
          hits.custom++;
          hits.customSymbols.push(sym);
        }
      }
    }
  }

  for (const d of dirs) walk(path.join(root, d));
  return hits;
}

/**
 * @param {string} root
 * @param {string} repo
 */
function cypherRouteCount(root, repo) {
  const q =
    "MATCH (r:Route) RETURN count(r) AS routes LIMIT 1";
  // Use the repo's resolved gitnexus, not a hardcoded npx: npx never consults PATH, so this
  // queried the PUBLISHED analyzer's graph while everything else used the installed one.
  const { command, args } = gitnexusSpawn(['cypher', '-r', repo, q], root);
  const r = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * @param {string} root
 * @param {string} [repoArg]
 */
export function detectApiRouterProfile(root, repoArg) {
  const repo = repoArg ?? repoName(root);
  const heur = scanSourceHeuristics(root);
  const routeNodes = fs.existsSync(path.join(root, '.gitnexus'))
    ? cypherRouteCount(root, repo)
    : null;

  let profile = 'unknown';
  let recommendation = 'query + context on handler symbols; try api_impact then bearing-api-routes if empty';

  if (routeNodes != null && routeNodes > 0) {
    profile = 'framework';
    recommendation = 'api_impact / route_map / shape_check — indexed Route nodes present';
  } else if (heur.custom > heur.framework && heur.custom > 0) {
    profile = 'custom';
    recommendation = 'bearing-api-routes skill — no indexed Route nodes; use context on dispatcher symbols';
  } else if (heur.framework > 0) {
    profile = 'framework-likely';
    recommendation =
      'Try api_impact first; if empty after refresh, treat as custom router (bearing-api-routes)';
  } else if (routeNodes === 0) {
    profile = 'none';
    recommendation = 'No HTTP routes detected — skip api_impact unless adding an API layer';
  }

  return {
    repo,
    profile,
    routeNodes: routeNodes ?? null,
    sourceSignals: { framework: heur.framework, custom: heur.custom, customSymbols: heur.customSymbols },
    recommendation,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * @param {string} root
 * @param {string} [repoArg]
 */
export function writeApiRouterProfile(root, repoArg) {
  const profile = detectApiRouterProfile(root, repoArg);
  const out = path.join(root, API_PROFILE_FILE);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(profile, null, 2) + '\n');
  return profile;
}
