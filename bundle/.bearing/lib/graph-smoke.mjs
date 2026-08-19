#!/usr/bin/env node
/**
 * Post-index graph smoke test — verifies Cypher works and graph has expected structure.
 * Usage: node .bearing/lib/graph-smoke.mjs [repoRoot]
 * Exit 0 = OK (warnings allowed); exit 1 = graph/Cypher broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoName } from './hook-helpers.mjs';
import { gitnexusSpawn } from './gitnexus-cmd.mjs';

const root = process.argv[2] ?? process.cwd();
const repo = repoName(root);

function runCypher(query) {
  const gn = gitnexusSpawn(['cypher', '-r', repo, query], root);
  const r = spawnSync(gn.command, gn.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function parseCount(out) {
  const m = out.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Does this repo look like it has an HTTP API the graph failed to see?
 *
 * `api_impact`, `route_map` and `shape_check` all read `Route` nodes, and route detection is
 * FRAMEWORK-DEPENDENT. Measured on a NestJS backend with 33 `@Controller` classes and 210 route
 * decorators: the index held THREE Route nodes, and all three were URL strings scraped out of
 * utility code. So `api_impact({route: "/venues"})` answered `error: No routes found matching
 * "/venues"` for a live endpoint — and a not-found reads as "nothing depends on it, safe to
 * change". A second NestJS repo indexed zero.
 *
 * The smoke test already counted Route nodes and printed the number without comment. Comparing it
 * against evidence of an API turns a silent trap into a line the reader sees once per refresh.
 *
 * Deliberately quiet unless the gap is stark: below FIVE pieces of evidence any repo has an
 * incidental `/api/` path, and a false warning here would be one more thing to learn to ignore
 * (NS-5).
 * @param {number} routeNodes @param {number} routeEvidence controller-ish classes or route-ish files
 * @returns {boolean}
 */
export function routeCoverageWarning(routeNodes, routeEvidence) {
  if (!(routeEvidence >= 5)) return false;
  return (routeNodes ?? 0) < routeEvidence / 4;
}

function main() {
  const metaPath = path.join(root, '.gitnexus/meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error('graph-smoke: no .gitnexus/meta.json — run gitnexus:refresh first');
    process.exit(1);
  }

  let nodeCount = 0;
  try {
    nodeCount = JSON.parse(fs.readFileSync(metaPath, 'utf8')).stats?.nodes ?? 0;
  } catch {
    console.error('graph-smoke: invalid meta.json');
    process.exit(1);
  }

  const lines = ['GitNexus graph smoke', ''];

  const nodeQ = runCypher('MATCH (n) RETURN count(n) AS nodes LIMIT 1');
  if (!nodeQ.ok) {
    console.error('graph-smoke: Cypher FAILED (graph engine unreachable)');
    console.error(nodeQ.stderr.slice(0, 500));
    process.exit(1);
  }
  const liveNodes = parseCount(nodeQ.stdout);
  lines.push(`Nodes (cypher)  ${liveNodes ?? '?'} (meta: ${nodeCount})`);

  const accessQ = runCypher(
    "MATCH ()-[r:CodeRelation {type: 'ACCESSES'}]->() RETURN count(r) AS accesses LIMIT 1"
  );
  const accesses = accessQ.ok ? parseCount(accessQ.stdout) : null;
  if (!accessQ.ok) {
    console.error('graph-smoke: ACCESSES query failed');
    process.exit(1);
  }
  lines.push(`ACCESSES edges   ${accesses ?? 0}`);

  const routeQ = runCypher("MATCH (r:Route) RETURN count(r) AS routes LIMIT 1");
  const routes = routeQ.ok ? parseCount(routeQ.stdout) : null;
  lines.push(`Route nodes      ${routes ?? 0}`);

  // Evidence that an API exists, from the graph itself — no filesystem walk. Two signals, because
  // one convention never covers every framework: classes named *Controller (NestJS, Spring) and
  // files living where routes live (Next.js app router, Express, Django).
  const ctrlQ = runCypher(
    "MATCH (c:Class) WHERE c.name ENDS WITH 'Controller' RETURN count(c) AS n LIMIT 1"
  );
  const fileQ = runCypher(
    "MATCH (f:File) WHERE f.filePath CONTAINS '.controller.' OR f.filePath CONTAINS '/routes/' " +
      "OR f.filePath CONTAINS '/controllers/' OR f.filePath ENDS WITH '/route.ts' " +
      "OR f.filePath CONTAINS '/api/' RETURN count(f) AS n LIMIT 1"
  );
  const evidence = Math.max(
    (ctrlQ.ok ? parseCount(ctrlQ.stdout) : 0) ?? 0,
    (fileQ.ok ? parseCount(fileQ.stdout) : 0) ?? 0
  );

  let warn = false;
  if (routeCoverageWarning(routes ?? 0, evidence)) {
    lines.push('');
    lines.push(
      `WARN: ${evidence} route-ish file(s)/controller(s) but only ${routes ?? 0} Route node(s) — ` +
        'api_impact / route_map / shape_check will report this API as ABSENT. A not-found from ' +
        'them is NOT evidence the route is unused. Use query/context/cypher on the controllers.'
    );
    warn = true;
  }
  if ((nodeCount ?? 0) > 200 && (accesses ?? 0) === 0) {
    lines.push('');
    lines.push('WARN: large graph but zero ACCESSES — field-level cypher may be empty (indexer/version?)');
    warn = true;
  }

  lines.push('');
  lines.push(warn ? 'Smoke: PASS with warnings' : 'Smoke: PASS');
  console.log(lines.join('\n'));
  process.exit(0);
}

// Importing this module must not run it: the test imports `routeCoverageWarning`, and a top-level
// main() would process.exit() the test runner out from under it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
