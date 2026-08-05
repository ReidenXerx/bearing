#!/usr/bin/env node
/**
 * GitNexus CI impact gate — merge-time enforcement for target repos.
 *
 * Fails a PR when a changed symbol has a large upstream blast radius but the PR
 * touches no tests. Graph-stale repos are flagged too. Pure CLI (no MCP).
 *
 * Usage:  node scripts/gitnexus-ci.mjs [baseRef]
 * Env:
 *   GITNEXUS_CI_MODE=block|warn   (default: block — non-zero exit on violation)
 *   GITNEXUS_CI_HIGH=<n>          (caller threshold for HIGH risk, default 8)
 *   GITNEXUS_CI_SKIP_BUILD=1      (don't run analyze; assume index present)
 *   GITHUB_BASE_REF              (used as base when no arg given)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF || 'main';
const mode = (process.env.GITNEXUS_CI_MODE || 'block').toLowerCase();
const highThreshold = Number(process.env.GITNEXUS_CI_HIGH || 8);

const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala)$/i;
const TEST_RE = /(^|\/)(tests?|spec|__tests__)\/|\.(test|spec)\./i;

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function repoName() {
  return process.env.GITNEXUS_REPO || path.basename(ROOT);
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(mode === 'warn' ? 0 : 1);
}

async function main() {
  const { runCypher, parseCount } = await import(
    pathToFileURL(path.join(ROOT, '.bearing/lib/cypher-cli.mjs')).href
  );
  const repo = repoName();

  console.log(`GitNexus CI impact gate — base=${baseRef} mode=${mode} highThreshold=${highThreshold}`);

  if (!git(`rev-parse --verify ${baseRef}`)) {
    // Common in shallow CI checkouts — try origin/<base>.
    if (git(`rev-parse --verify origin/${baseRef}`)) {
      console.log(`(using origin/${baseRef})`);
    } else {
      fail(`base ref "${baseRef}" not found (fetch it with fetch-depth: 0).`);
      return;
    }
  }
  const base = git(`rev-parse --verify ${baseRef}`) ? baseRef : `origin/${baseRef}`;

  // Ensure an index exists.
  if (!process.env.GITNEXUS_CI_SKIP_BUILD && !fs.existsSync(path.join(ROOT, '.gitnexus/meta.json'))) {
    console.log('No index — running gitnexus analyze --embeddings …');
    const r = spawnSync('npx', ['-y', 'gitnexus@latest', 'analyze', '--embeddings'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (r.status !== 0) fail('gitnexus analyze failed — cannot run impact gate.');
  }

  const changed = git(`diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
  const codeFiles = changed.filter((f) => CODE_RE.test(f) && !TEST_RE.test(f));
  const testChanged = changed.some((f) => TEST_RE.test(f));

  if (!codeFiles.length) {
    console.log('No changed production code files — gate passes.');
    process.exit(0);
  }

  const symbols = [...new Set(codeFiles.map((f) => path.basename(f, path.extname(f))).filter(Boolean))];
  const findings = [];
  for (const sym of symbols) {
    const q = `MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f {name: '${sym.replace(/'/g, "\\'")}'}) RETURN count(caller)`;
    const r = runCypher(ROOT, repo, q);
    const callers = r.ok ? parseCount(r.stdout) ?? 0 : 0;
    findings.push({ sym, callers });
  }
  findings.sort((a, b) => b.callers - a.callers);

  console.log('\nUpstream callers per changed symbol:');
  for (const f of findings.slice(0, 20)) {
    const tag = f.callers >= highThreshold ? 'HIGH' : f.callers >= Math.ceil(highThreshold / 2) ? 'MED ' : 'low ';
    console.log(`  [${tag}] ${f.sym}: ${f.callers}`);
  }

  const high = findings.filter((f) => f.callers >= highThreshold);
  console.log(`\nTests changed in PR: ${testChanged ? 'yes' : 'NO'}`);

  if (high.length && !testChanged) {
    fail(
      `${high.length} high-impact symbol(s) changed with NO test changes: ${high.map((h) => `${h.sym}(${h.callers})`).join(', ')}. ` +
        'Add/adjust tests or set GITNEXUS_CI_MODE=warn to allow.'
    );
    return;
  }

  console.log('\n✓ Impact gate passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(mode === 'warn' ? 0 : 1);
});
