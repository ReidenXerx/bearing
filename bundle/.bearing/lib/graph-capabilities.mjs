#!/usr/bin/env node
/**
 * What does the graph actually support IN THIS REPO?
 *
 * A day spent querying live indexes turned up five traps, and every one of them is a per-repo FACT
 * that the agent currently has to carry as a rule and apply from memory:
 *
 *   - `Route` nodes are framework-dependent. A NestJS backend with 33 `@Controller` classes and 210
 *     route decorators indexed THREE, none of them an endpoint — so `api_impact({route:"/venues"})`
 *     answers "no routes found" for a live route, and a not-found reads as a safe change.
 *   - The PDG layer is opt-in. Four tools return zero rows without it, and a zero is not an answer.
 *   - `explain` needs taint edges. Zero findings with a healthy layer means "none found"; zero
 *     findings with no layer means "nothing looked". The difference matters and looks identical.
 *   - `Community.keywords`/`description`/`label` are filled by an enrichment pass the analyzer
 *     ships and never calls, so they are empty in every index that exists.
 *   - Without embeddings, `query` degrades from semantic ranking to something much blunter.
 *
 * Five rules to remember, or one report to read. This is the report. It states what works here,
 * what does not, and — the part that matters — what a NEGATIVE result from each tool actually means
 * given that, so an empty answer is never mistaken for an empty codebase.
 *
 * Usage: node .bearing/lib/graph-capabilities.mjs [repoRoot] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoName } from './hook-helpers.mjs';
import { gitnexusSpawn } from './gitnexus-cmd.mjs';

/** The CLI returns JSON whose `markdown` field holds the table; the count is its first number. */
export function firstNumber(stdout) {
  try {
    const md = JSON.parse(stdout).markdown ?? '';
    const rows = md.split('\n').filter((l) => l.includes('|'));
    const last = rows[rows.length - 1] ?? '';
    const m = last.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    const m = String(stdout).match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }
}

const COUNT = {
  embeddings: "MATCH (n) WHERE n.embedding IS NOT NULL RETURN count(n) AS n",
  accesses: "MATCH ()-[r:CodeRelation {type:'ACCESSES'}]->() RETURN count(r) AS n",
  routes: 'MATCH (r:Route) RETURN count(r) AS n',
  controllers: "MATCH (c:Class) WHERE c.name ENDS WITH 'Controller' RETURN count(c) AS n",
  routeFiles:
    "MATCH (f:File) WHERE f.filePath CONTAINS '.controller.' OR f.filePath CONTAINS '/routes/' " +
    "OR f.filePath CONTAINS '/controllers/' OR f.filePath ENDS WITH '/route.ts' " +
    "OR f.filePath CONTAINS '/api/' RETURN count(f) AS n",
  pdg: "MATCH ()-[r:CodeRelation]->() WHERE r.type IN ['CFG','REACHING_DEF','CDG'] RETURN count(r) AS n",
  taint: "MATCH ()-[r:CodeRelation]->() WHERE r.type IN ['TAINTED','TAINT_PATH'] RETURN count(r) AS n",
  enriched: "MATCH (c:Community) WHERE c.enrichedBy <> 'heuristic' RETURN count(c) AS n",
  communities: 'MATCH (c:Community) RETURN count(c) AS n',
};

/** The most-read field in the repo — the best case for "who touches this field?". */
const BUSIEST_FIELD =
  "MATCH (a)-[r:CodeRelation {type:'ACCESSES'}]->(b) WHERE b.name IS NOT NULL " +
  'RETURN b.name AS name, b.filePath AS file, count(*) AS n ORDER BY n DESC LIMIT 1';

/** First data row of the CLI's markdown table, as cells. */
export function firstRow(stdout) {
  let md;
  try {
    md = JSON.parse(stdout).markdown ?? '';
  } catch {
    return null;
  }
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2 || cells[0] === 'name' || cells[0].startsWith('---')) continue;
    return cells;
  }
  return null;
}

/**
 * Two-node import cycles, which are the ones worth naming: `a` imports `b` imports `a`. Longer
 * cycles exist and this does NOT find them — said plainly in the output rather than left for the
 * reader to assume completeness.
 */
const CYCLE_QUERY =
  "MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File)-[:CodeRelation {type:'IMPORTS'}]->(a) " +
  'WHERE a.filePath < b.filePath RETURN a.filePath AS a, b.filePath AS b LIMIT 200';

/** Rows of `{a, b}` out of the CLI's markdown table. */
export function parseCyclePairs(stdout) {
  let md;
  try {
    md = JSON.parse(stdout).markdown ?? '';
  } catch {
    return [];
  }
  const out = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 2 || cells[0] === 'a' || cells[0].startsWith('---')) continue;
    out.push({ a: cells[0], b: cells[1] });
  }
  return out;
}

/**
 * Not all cycles are the same finding, and a raw count hides that.
 *
 * On one real backend `check` reported 34 cycles. Most were between ORM entity files — TypeScript
 * type-position imports, erased at compile time, which cannot deadlock a module graph. A handful
 * were between DI module files, and those are the ones that force `forwardRef` and break
 * initialisation order. Reporting "34 cycles" treats a design smell and a compile-time non-event as
 * the same number.
 * @param {{a: string, b: string}[]} pairs
 */
export function classifyCycles(pairs) {
  const bucket = { blocking: [], typeLevel: [], other: [] };
  for (const p of pairs) {
    const both = (re) => re.test(p.a) && re.test(p.b);
    if (both(/\.module\.[jt]s$/)) bucket.blocking.push(p);
    else if (both(/\.entity\.[jt]s$|\.model\.[jt]s$|\.schema\.[jt]s$|\.types?\.[jt]s$|\.d\.ts$/))
      bucket.typeLevel.push(p);
    else bucket.other.push(p);
  }
  return bucket;
}

/**
 * @param {(query: string) => {ok: boolean, stdout: string}} run injected so this is testable
 *   without a graph
 */
export function probeCapabilities(run, runImpact = null) {
  const n = (key) => {
    const r = run(COUNT[key]);
    return r.ok ? firstNumber(r.stdout) ?? 0 : null;
  };
  const caps = [];
  const push = (id, ok, label, detail, negative) => caps.push({ id, ok, label, detail, negative });

  const embeddings = n('embeddings');
  push(
    'semantic_query',
    (embeddings ?? 0) > 0,
    'query — semantic ranking',
    embeddings == null ? 'could not probe' : `${embeddings} embedded node(s)`,
    (embeddings ?? 0) > 0
      ? null
      : 'no embeddings: `query` cannot rank by meaning here, so a thin result is the INDEX being blunt, not the concept being absent. Refresh with embeddings, or use cypher.',
  );

  // COUNTING THE EDGES IS NOT THE SAME AS ASKING THE QUESTION.
  //
  // This probe used to report "field reads work" whenever ACCESSES edges existed. On a live index a
  // property with 57 ACCESSES edges pointing at it got `impactedCount: 0` from
  // `impact --direction upstream`, because impact walks CALLS and does not traverse ACCESSES. So the
  // report said the capability was live while the tool that consumes it answered nothing — the
  // exact false-negative this file exists to prevent, produced by the file itself.
  //
  // Probing the DATA tells you the data is there. Only probing the CONSUMER tells you the question
  // is answerable. One extra spawn, against the busiest field in the repo — its best case.
  const accesses = n('accesses');
  let fieldOk = (accesses ?? 0) > 0;
  let fieldDetail = accesses == null ? 'could not probe' : `${accesses} edge(s)`;
  let fieldNegative =
    fieldOk === false
      ? 'no ACCESSES edges: "who reads this field" returns nothing REGARDLESS of the code. Do not report a field as unused from this graph.'
      : null;

  if (fieldOk && runImpact) {
    const row = firstRow(run(BUSIEST_FIELD).stdout ?? '');
    if (row && row.length >= 2) {
      const [fname, ffile] = row;
      const walked = runImpact(fname, ffile);
      if (walked === false) {
        fieldOk = false;
        fieldDetail = `${accesses} edge(s), but impact resolved 0 callers for \`${fname}\` (the most-read field here)`;
        fieldNegative =
          'the edges exist and `impact` does not walk them: it follows CALLS, not ACCESSES. ' +
          '"What breaks if I change this FIELD" is not an `impact` question on this index — it answers ' +
          '`impactedCount: 0` for a field with hundreds of readers, which reads as "safe to change". ' +
          'Use cypher on ACCESSES directly, or a text search.';
      }
    }
  }

  push('field_access', fieldOk, 'ACCESSES — field reads/writes', fieldDetail, fieldNegative);

  const routes = n('routes') ?? 0;
  const evidence = Math.max(n('controllers') ?? 0, n('routeFiles') ?? 0);
  const routesOk = !(evidence >= 5 && routes < evidence / 4);
  push(
    'route_tools',
    routesOk,
    'api_impact / route_map / shape_check',
    `${routes} Route node(s) against ${evidence} controller(s)/route-ish file(s)`,
    routesOk
      ? null
      : 'route detection did not understand this framework. These three tools report the API as ABSENT — `api_impact({route})` answers "no routes found" for LIVE routes, and that reads as a safe change. Use query/context/cypher on the controllers instead.',
  );

  const pdg = n('pdg') ?? 0;
  push(
    'pdg',
    pdg > 0,
    'pdg_query / impact --mode pdg',
    pdg > 0 ? `${pdg} PDG edge(s)` : 'no PDG layer (opt-in: bearing:pdg)',
    pdg > 0
      ? null
      : 'no PDG layer: these tools return ZERO ROWS, which is not an answer. Build it or say you could not check.',
  );

  const taint = n('taint') ?? 0;
  push(
    'taint',
    pdg > 0,
    'explain — taint findings',
    pdg > 0 ? `${taint} taint edge(s), layer present` : 'no PDG layer, so no taint layer',
    pdg > 0
      ? taint === 0
        ? 'layer is present and found nothing. That is "no flows matched", NOT proof of safety — closure, property and implicit flows are not modelled.'
        : null
      : 'no layer at all: an empty `explain` here means nothing looked, which is different from nothing found. Do not report the code as clean.',
  );

  const communities = n('communities') ?? 0;
  const enriched = n('enriched') ?? 0;
  push(
    'community_meta',
    enriched > 0,
    'Community.keywords / description / label',
    enriched > 0
      ? `${enriched} of ${communities} enriched`
      : `0 of ${communities} enriched (the analyzer ships the pass and never calls it)`,
    enriched > 0
      ? null
      : 'these three fields are empty in EVERY index. An empty `keywords` says the pass did not run, not that the area has no keywords. Use heuristicLabel / cohesion / symbolCount / MEMBER_OF.',
  );

  return caps;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  // resolve: a bare '.' makes repoName() report the repo as '.'
  const root = path.resolve(
    process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.cwd(),
  );
  const jsonOut = process.argv.includes('--json');
  const repo = repoName(root);

  const run = (query) => {
    const gn = gitnexusSpawn(['cypher', '-r', repo, query], root);
    const r = spawnSync(gn.command, gn.args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: r.status === 0, stdout: r.stdout ?? '' };
  };

  if (!fs.existsSync(path.join(root, '.gitnexus/meta.json'))) {
    console.error('graph-capabilities: no index — run bearing:refresh first');
    process.exit(1);
  }

  /** Did `impact` resolve ANY caller for this symbol? null when we could not tell. */
  const runImpact = (name, file) => {
    const args = ['impact', name, '--direction', 'upstream', '--summary-only', '-r', repo];
    if (file) args.push('--file', file);
    const gn = gitnexusSpawn(args, root);
    const r = spawnSync(gn.command, gn.args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    if (r.status !== 0) return null;
    try {
      const j = JSON.parse(r.stdout ?? '');
      if (j.status === 'ambiguous') return null; // could not tell, not a failure to walk
      return Number(j.impactedCount) > 0;
    } catch {
      return null;
    }
  };

  const caps = probeCapabilities(run, runImpact);
  const cycleProbe = run(CYCLE_QUERY);
  const cycles = classifyCycles(cycleProbe.ok ? parseCyclePairs(cycleProbe.stdout) : []);

  if (jsonOut) {
    console.log(JSON.stringify({ repo, capabilities: caps, cycles }, null, 2));
    process.exit(0);
  }

  console.log(`\n  What the graph supports in ${repo}\n`);
  for (const c of caps) {
    console.log(`  ${c.ok ? '[1;32m✓[0m' : '[1;33m![0m'} ${c.label}`);
    console.log(`      ${c.detail}`);
    if (c.negative) console.log(`      [1;33m→[0m ${c.negative}`);
  }

  const total = cycles.blocking.length + cycles.typeLevel.length + cycles.other.length;
  if (total) {
    console.log(`\n  Circular imports (two-file cycles only — longer ones are not searched):`);
    if (cycles.blocking.length) {
      console.log(`      ${cycles.blocking.length} between DI module files — these force forwardRef and break init order:`);
      for (const p of cycles.blocking.slice(0, 3)) console.log(`        ${p.a}  <->  ${p.b}`);
    }
    if (cycles.typeLevel.length) {
      console.log(`      ${cycles.typeLevel.length} between entity/type files — usually type-position imports, erased at compile time`);
    }
    if (cycles.other.length) {
      console.log(`      ${cycles.other.length} other — worth a look:`);
      for (const p of cycles.other.slice(0, 3)) console.log(`        ${p.a}  <->  ${p.b}`);
    }
  }

  const gaps = caps.filter((c) => !c.ok).length;
  console.log(
    `\n  ${gaps === 0 ? 'Every capability probed is live here.' : `${gaps} capability gap(s) — a negative result from those tools is not evidence of absence.`}\n`,
  );
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
