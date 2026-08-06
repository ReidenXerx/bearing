#!/usr/bin/env node
/**
 * Post-index graph smoke test — verifies Cypher works and graph has expected structure.
 * Usage: node .bearing/lib/graph-smoke.mjs [repoRoot]
 * Exit 0 = OK (warnings allowed); exit 1 = graph/Cypher broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoName } from './hook-helpers.mjs';

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

  let warn = false;
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

main();
