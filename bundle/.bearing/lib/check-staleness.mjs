#!/usr/bin/env node
/**
 * Compare .gitnexus/meta.json lastCommit vs git HEAD.
 * stdout: JSON { fresh, reason, commitsBehind, driftSpan, indexedCommit, headCommit, indexedAt }
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Wall-clock bound for every git call on the hook path (NS-7). Generous enough for a big repo's
 * `status --porcelain -uall`, short enough that a wedged git degrades the gate instead of the
 * developer's session.
 */
const GIT_TIMEOUT_MS = 5000;
import path from 'node:path';
import { loadHookConfig } from './hook-helpers.mjs';
import { howToRun } from './how-to-run.mjs';

const root = process.argv[2] ?? process.cwd();

/**
 * Once ONE git call has timed out, git is wedged for this process — a concurrent `analyze` holding
 * the index lock, a network filesystem, a hung credential helper. Trying the next one just pays the
 * bound again, so the worst case was the timeout times the number of calls. Short-circuit instead:
 * one bound per hook invocation, not one per command.
 */
let gitWedged = false;

function git(cmd) {
  if (gitWedged) throw new Error('git timed out earlier in this run');
  // BOUNDED. Every git call here runs on the hook path, so an unresponsive one blocks the tool
  // call itself — measured: a PATH-shimmed `git` that never returns left the Grep guard hanging at
  // 15s with no verdict at all. In the field it showed up as a concurrent `analyze` pegging the
  // disk and `git status --porcelain -uall` taking longer than the cache TTL, so every single tool
  // call re-paid it. NS-7 says nothing on this path may block without a bound; a timeout throws,
  // and every caller here already treats a throw as "unknown" and fails safe.
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch (e) {
    if (e?.signal === 'SIGTERM' || e?.code === 'ETIMEDOUT') gitWedged = true;
    throw e;
  }
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
/**
 * Paths bearing installed, from the manifest it wrote.
 *
 * These are not the user's work: `bearing update` rewrites them without re-indexing, so counting
 * them as drift blocks graph queries immediately after an update — the tool gating itself.
 *
 * This was a list of PREFIXES (`.bearing/`, `scripts/bearing-`, `.claude/hooks/bearing-`) and it
 * missed everything bearing ships that is not named `bearing-*`: scripts/lib/setup-ui.mjs,
 * scripts/run-with-project-tmp.sh, scripts/install-git-hooks.sh and four more. Measured: 12 drift
 * against 10 edited files right after an install. The manifest is the authoritative record of what
 * was installed, so read that rather than keep a second list in sync by hand (GP-11).
 */
let ownFilesCache = null;
function ownFiles() {
  if (ownFilesCache) return ownFilesCache;
  ownFilesCache = new Set();
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, '.bearing/manifest.json'), 'utf8'));
    for (const f of m.files ?? []) ownFilesCache.add(f);
  } catch {
    /* no manifest — the prefix rules below still apply */
  }
  return ownFilesCache;
}

/** @param {string} f repo-relative path */
function isOwnFile(f) {
  return (
    ownFiles().has(f) ||
    /^\.bearing\//.test(f) ||
    /^scripts\/bearing-/.test(f) ||
    /^\.claude\/hooks\/bearing-/.test(f) ||
    /^\.cursor\/hooks\/bearing-/.test(f)
  );
}

function countBehindSource(from, to, sourceExtRe) {
  let names = '';
  try {
    names = execSync(`git -c core.quotePath=false diff --name-only ${from}..${to}`, {
      timeout: GIT_TIMEOUT_MS,
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
    if (isOwnFile(f)) continue;
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
      timeout: GIT_TIMEOUT_MS,
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
    if (isOwnFile(f)) continue;
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

// The blocking claim is CONDITIONAL, and this string is shipped into the session brief — the one
// message a reader cannot check. With `stalenessGate: "off"` (the default) staleness denies
// nothing, so asserting "hooks block" here made every stale-index report state a consequence that
// does not happen. NS-20: an unchecked claim is a lie waiting to happen.
const staleHookNote =
  loadHookConfig(root).stalenessGate === 'block'
    ? 'Hooks block Grep/Read/MCP/shell until refresh succeeds or fails.'
    : 'Nothing is blocked (stalenessGate: off) — graph answers may be WRONG rather than refused, so confirm anything load-bearing.';
// Resolved, not hardcoded: a stealth install has no npm scripts, so naming one made every block
// point at a command that repo did not have (NS-6 — a block whose exit does not exist is a trap).
const agentFix =
  `${staleHookNote} Agent MUST run ${howToRun(root, "bearing:agent-refresh")} autonomously (required_permissions: ["all"]).`;

const out = {
  fresh: true,
  reason: null,
  commitsBehind: 0,
  driftSpan: null,
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

    // Through the SAME helper, so a wedged git is noticed once rather than re-timed here. This
    // direct call is why the worst case was still two full timeouts after the first bound landed.
    git('git rev-parse --is-inside-work-tree');

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

/**
 * How much TIME the index is behind, not just how many commits.
 *
 * "236 commits behind" is a number without a scale — it reads the same whether that is a busy
 * afternoon or most of a year. On a real repo it was seven weeks: the graph was answering questions
 * about code from a different era, confidently, and the count alone never conveyed that. A span is
 * what makes a reader act.
 * @param {string} indexedCommit @returns {string|null} e.g. "7 weeks" — null when git cannot say
 */
function driftSpan(indexedCommit) {
  try {
    const at = parseInt(git(`git log -1 --format=%ct ${indexedCommit}`), 10);
    if (!Number.isFinite(at)) return null;
    const days = Math.floor((Date.now() / 1000 - at) / 86400);
    if (days < 1) return "today";
    if (days === 1) return "1 day";
    if (days < 14) return `${days} days`;
    if (days < 60) return `${Math.round(days / 7)} weeks`;
    if (days < 730) return `${Math.round(days / 30)} months`;
    return `${(days / 365).toFixed(1)} years`;
  } catch {
    return null; // shallow clone, or the commit is no longer reachable
  }
}

try {
  git(`git merge-base --is-ancestor ${out.indexedCommit} ${out.headCommit}`);
  out.commitsBehind =
    parseInt(git(`git rev-list --count ${out.indexedCommit}..${out.headCommit}`), 10) || 0;
  if (out.commitsBehind > 0) {
    out.driftSpan = driftSpan(out.indexedCommit);
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
      // Drift still has to be measured. This path declares the index FRESH, and the block below
      // only measures the working tree when HEAD has not moved — so a single docs commit landing on
      // top of dirty source made drift read 0 and the planner answer "nothing to do" while four
      // source files were modified. The optimisation that skips work when nothing was committed
      // must not also skip LOOKING at what was not committed.
      if (threshold > 0) out.driftingFiles = countDrift(out.indexedAt, cfg.sourceExtRe);
    } else if (threshold > 0 && out.behindFiles > 0 && out.behindFiles < threshold) {
      // A small gap: the graph is wrong about a few files, not structurally invalid. Gate the graph
      // and leave the rest of the toolbox open, exactly as drift does.
      out.fresh = false;
      out.reason = 'behind_small';
      out.softBehind = true;
    } else {
      out.fresh = false;
      // -1 means git could not answer. Named separately so the planner can force rather than run an
      // incremental pass over a gap of unknown size — guessing "small" buys a confident answer from
      // a graph that may no longer describe the repo.
      out.reason = out.behindFiles < 0 ? 'behind_unmeasured' : 'behind';
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
    // Say how much TIME that is. A count has no scale — 236 commits reads the same whether it is
    // an afternoon or most of a year, and on one real repo it was seven weeks of drift.
    const span = out.driftSpan ? `, ${out.driftSpan} of drift` : '';
    out.detail = `Index is ${n} commit(s) behind HEAD${span} (indexed ${(out.indexedCommit || '').slice(0, 7)} → HEAD ${(out.headCommit || '').slice(0, 7)}). ${agentFix}`;
  }
}

process.stdout.write(JSON.stringify(out));
