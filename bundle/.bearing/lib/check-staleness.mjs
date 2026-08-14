#!/usr/bin/env node
/**
 * Compare .gitnexus/meta.json lastCommit vs git HEAD.
 * stdout: JSON { fresh, reason, commitsBehind, indexedCommit, headCommit, indexedAt }
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadHookConfig } from './hook-helpers.mjs';
import { howToRun } from './how-to-run.mjs';

const root = process.argv[2] ?? process.cwd();

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * Count git-dirty SOURCE files modified since the index was built (mtime > indexedAt).
 * Commit-equality can't see UNCOMMITTED edits (HEAD unchanged → "fresh" forever), so this
 * is the working-tree drift that lets guards require a fast incremental resync. Only stats
 * the handful of dirty files (fast), and RESETS on refresh because indexedAt advances.
 * @param {string|null} at meta.indexedAt (ISO)
 * @param {RegExp} sourceExtRe the kit's canonical source-file matcher (loadHookConfig)
 */
/**
 * SOURCE files changed between the indexed commit and HEAD.
 *
 * Same filters as countDrift — extension, and bearing's own files excluded, since `bearing update`
 * rewrites those without re-indexing and they are not the user's code.
 *
 * Returns -1 when git cannot answer. The caller treats that as material: an unknown gap must not
 * quietly downgrade a block, because the failure mode of guessing "small" is a confident answer from
 * a graph that no longer describes the repo.
 * @param {string} from indexed commit @param {string} to HEAD @param {RegExp} sourceExtRe
 * @returns {number} count, or -1 if unknown
 */
function countBehindSource(from, to, sourceExtRe) {
  let names = '';
  try {
    names = execSync(`git -c core.quotePath=false diff --name-only ${from}..${to}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return -1;
  }
  let n = 0;
  for (let f of names.split('\n')) {
    f = f.trim();
    if (!f) continue;
    if (f.startsWith('"') && f.endsWith('"')) f = f.slice(1, -1);
    if (!sourceExtRe.test(f)) continue;
    if (
      /^\.bearing\//.test(f) ||
      /^scripts\/bearing-/.test(f) ||
      /^\.claude\/hooks\/bearing-/.test(f) ||
      /^\.cursor\/hooks\/bearing-/.test(f)
    )
      continue;
    n++;
  }
  return n;
}

function countDrift(at, sourceExtRe) {
  const atMs = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(atMs)) return 0;
  let porcelain = '';
  try {
    // -c core.quotePath=false → real UTF-8 paths (no octal escaping) so non-ASCII source
    // names still stat. No .trim() on the output — the leading-space status column (" M path")
    // must keep its alignment for slice(3).
    // -uall → list untracked FILES individually. Without it git collapses a new directory into a
    // single "?? path/" entry, which carries no source extension and therefore matches nothing —
    // so scaffolding a whole new module in a new folder produced ZERO drift (silent blind spot).
    porcelain = execSync('git -c core.quotePath=false status --porcelain -uall', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue; // "XY path" is ≥4 chars
    let f = line.slice(3);
    if (f.includes(' -> ')) f = f.split(' -> ').pop(); // rename → new path (before unquote)
    f = f.trim();
    if (f.startsWith('"') && f.endsWith('"')) f = f.slice(1, -1);
    if (!sourceExtRe.test(f)) continue;
    // The kit's OWN files are not the user's work. `bearing update` rewrites them without
    // re-indexing, which otherwise registers as drift and blocks graph queries immediately after
    // an update — the tool gating itself.
    if (/^\.bearing\//.test(f) || /^scripts\/bearing-/.test(f) || /^\.claude\/hooks\/bearing-/.test(f) || /^\.cursor\/hooks\/bearing-/.test(f)) continue;
    try {
      if (fs.statSync(path.join(root, f)).mtimeMs > atMs) n++;
    } catch {
      // The path is GONE → a deleted source file. That is real drift, and arguably worse than an
      // edit: the graph keeps serving symbols that no longer exist, so results aren't stale-but-close,
      // they're phantom. There is no file left to stat, so use the PARENT DIRECTORY's mtime as the
      // deletion timestamp (removing an entry updates it). That keeps the mtime discipline: once the
      // index is rebuilt, indexedAt overtakes the directory mtime and the deletion stops counting —
      // otherwise a pending deletion would block every graph query until it was committed.
      try {
        if (fs.statSync(path.dirname(path.join(root, f))).mtimeMs > atMs) n++;
      } catch {
        n++; // parent gone too (whole folder removed) — unambiguously drift
      }
    }
  }
  return n;
}

const staleHookNote =
  'Hooks block Grep/Read/MCP/shell until refresh succeeds or fails.';
// Resolved, not hardcoded: a stealth install has no npm scripts, so naming one made every block
// point at a command that repo did not have (NS-6 — a block whose exit does not exist is a trap).
const agentFix =
  `${staleHookNote} Agent MUST run ${howToRun(root, "bearing:agent-refresh")} autonomously (required_permissions: ["all"]).`;

const out = {
  fresh: true,
  reason: null,
  commitsBehind: 0,
  indexedCommit: null,
  headCommit: null,
  indexedAt: null,
  nodeCount: 0,
  embeddingCount: 0,
  embeddingsReady: false,
  driftingFiles: 0,
};

const metaPath = path.join(root, '.gitnexus/meta.json');
if (!fs.existsSync(metaPath)) {
  out.fresh = false;
  out.reason = 'missing';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
} catch {
  out.fresh = false;
  out.reason = 'invalid_meta';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

out.indexedCommit = meta.lastCommit ?? null;
out.indexedAt = meta.indexedAt ?? null;
out.nodeCount = meta.stats?.nodes ?? 0;
out.embeddingCount = meta.stats?.embeddings ?? 0;
// Truthful: an index with symbols but no vectors is not embeddings-ready. (An
// empty 0-node index leaves this false but does not flip `fresh` below — the
// missing_embeddings branch requires nodeCount > 0 — so docs-only repos never wedge.)
out.embeddingsReady = out.embeddingCount > 0;

if (!out.indexedCommit) {
  out.fresh = false;
  out.reason = 'invalid_meta';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

try {
  out.headCommit = git('git rev-parse HEAD');
} catch {
  out.fresh = false;
  // A repo with NO COMMITS (fresh `git init`, or an orphan branch) is a legitimate state, not a

  // failure: `git rev-parse HEAD` fails simply because there is nothing to point at. Treating it

  // as not_git denied ls / cat / Read / Grep / Edit with "STALE INDEX — mandatory refresh", and

  // the refresh cannot help because there is nothing to index yet.

  try {

    execSync('git rev-parse --is-inside-work-tree', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });

    out.reason = 'no_commits';

    out.fresh = true;

    out.detail = 'Repository has no commits yet — nothing to index; enforcement is inactive.';

    process.stdout.write(JSON.stringify(out));

    process.exit(0);

  } catch {

    /* genuinely not a git worktree — fall through to not_git */

  }

  out.reason = 'not_git';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

if (out.indexedCommit === out.headCommit) {
  // Working-tree drift matters ONLY when commit-fresh (mid-session edits; HEAD unchanged).
  // When behind/diverged a full refresh is needed regardless, so don't pay the git-status
  // cost there — and skip it entirely when the drift gate is disabled (threshold ≤ 0).
  const config = loadHookConfig(root);
  if (config.driftRefreshThreshold > 0) {
    out.driftingFiles = countDrift(out.indexedAt, config.sourceExtRe);
  }
  if (out.nodeCount > 0 && !out.embeddingsReady) {
    out.fresh = false;
    out.reason = 'missing_embeddings';
    out.detail = `Graph has ${out.nodeCount} symbol(s) but 0 embeddings — gitnexus_query semantic search is unavailable. ${agentFix}`;
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

try {
  git(`git merge-base --is-ancestor ${out.indexedCommit} ${out.headCommit}`);
  out.commitsBehind =
    parseInt(git(`git rev-list --count ${out.indexedCommit}..${out.headCommit}`), 10) || 0;
  if (out.commitsBehind > 0) {
    // COUNT WHAT MOVED, not merely that something moved.
    //
    // This branch used to read `commitsBehind > 0 → stale → block everything`. A commit touching a
    // single file stopped the whole session, and a commit touching only README.md stopped it too —
    // even though the graph remained accurate for every line of code in the repo. Meanwhile the
    // drift path, which is the same underlying condition arrived at through the working tree,
    // measured SOURCE files and gated only the graph query tools. One rule was proportionate and
    // the other was not, and the one that was not had no measurement behind it at all.
    const cfg = loadHookConfig(root);
    const threshold = Number(cfg.driftRefreshThreshold) > 0 ? Number(cfg.driftRefreshThreshold) : 0;
    out.behindFiles = countBehindSource(out.indexedCommit, out.headCommit, cfg.sourceExtRe);
    if (out.behindFiles === 0) {
      // Docs, lockfiles, CI config. Nothing the graph indexes changed, so the graph is not stale.
      out.fresh = true;
      out.reason = 'behind_non_source';
      out.detail =
        `Index is ${out.commitsBehind} commit(s) behind HEAD, but none of them touched source — ` +
        'every indexed symbol is still accurate.';
    } else if (threshold > 0 && out.behindFiles > 0 && out.behindFiles < threshold) {
      // A small gap: the graph is wrong about a few files, not structurally invalid. Gate the graph
      // and leave the rest of the toolbox open, exactly as drift does.
      out.fresh = false;
      out.reason = 'behind_small';
      out.softBehind = true;
    } else {
      out.fresh = false;
      out.reason = 'behind';
    }
  }
} catch {
  out.fresh = false;
  out.reason = 'diverged';
}

if (!out.fresh) {
  if (out.reason === 'missing') {
    out.detail = `GitNexus index missing — ${agentFix}`;
  } else if (out.reason === 'invalid_meta') {
    out.detail = `GitNexus meta.json invalid — ${agentFix}`;
  } else if (out.reason === 'not_git') {
    out.detail = 'Not a git repo — cannot verify index freshness.';
  } else if (out.reason === 'diverged') {
    out.detail = `Index commit ${(out.indexedCommit || '').slice(0, 7)} diverged from HEAD ${(out.headCommit || '').slice(0, 7)} — ${agentFix}`;
  } else {
    const n = out.commitsBehind ?? '?';
    out.detail = `Index is ${n} commit(s) behind HEAD (indexed ${(out.indexedCommit || '').slice(0, 7)} → HEAD ${(out.headCommit || '').slice(0, 7)}). ${agentFix}`;
  }
}

process.stdout.write(JSON.stringify(out));
