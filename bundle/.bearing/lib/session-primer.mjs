#!/usr/bin/env node
/**
 * Session-first-tool nudge + flag management for GitNexus hooks.
 */
import fs from 'node:fs';
import { howToRun } from './how-to-run.mjs';
import os from 'node:os';
import path from 'node:path';
import { playbookForHint, mcpReadContext, repoName, clearDenyCache } from './hook-helpers.mjs';

/**
 * Which feature modules the user actually chose, per the install manifest.
 *
 * The manifest is the ONLY authoritative record. Probing for a lib file instead does not work:
 * `session-primer.mjs` (needed by north-stars and task-core) imports `check-staleness.mjs`, so
 * `coreLibClosure()` absorbs the whole staleness chain into core and ships it even when GitNexus
 * was declined. File presence therefore says "core pulled this in", never "the user wants this".
 *
 * @returns {Set<string>|null} chosen features, or null when unknowable (no manifest, unreadable,
 *   or a pre-1.0.3 manifest with no `features` field) — callers must then fall back, never assume.
 */
export function installedFeatures(root) {
  // Newest first: during an interrupted upgrade both can exist, and the legacy copy is the stale
  // one — reading it would report a module selection the user already changed.
  for (const rel of ['.bearing/manifest.json', '.gitnexus/agent-kit-manifest.json']) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      if (Array.isArray(m.features)) return new Set(m.features);
    } catch {
      /* missing or malformed → try the next location, then fall back */
    }
  }
  return null;
}

/**
 * Is the GitNexus enforcement module installed? Manifest first; for pre-1.0.3 installs (no
 * `features` field) fall back to the file probe, which was accurate back when every install
 * included GitNexus. Fail toward ENABLED: an old GitNexus repo silently losing graph-first
 * discipline is a worse regression than an intel-only repo seeing one stale line.
 */
export function graphFeatureEnabled(root) {
  const features = installedFeatures(root);
  if (features) return features.has('gitnexus');
  return fs.existsSync(path.join(root, '.bearing/lib/check-staleness.mjs'));
}

export function sessionPaths(root) {
  const stateDir = path.join(root, '.bearing');
  return {
    stateDir,
    primedFlag: path.join(stateDir, '.bearing-session-primed.flag'),
    promptHint: path.join(stateDir, '.gitnexus-prompt-hint.json'),
    refreshPendingFlag: path.join(stateDir, '.gitnexus-refresh-pending.flag'),
    refreshFailedFlag: path.join(stateDir, '.gitnexus-refresh-failed.flag'),
    mcpUsedFlag: path.join(stateDir, '.gitnexus-mcp-used.flag'),
    impactUsedFlag: path.join(stateDir, '.gitnexus-impact-used.flag'),
    detectUsedFlag: path.join(stateDir, '.gitnexus-detect-used.flag'),
    stalenessCacheFile: path.join(stateDir, '.gitnexus-staleness-cache.json'),
    scorecardFile: path.join(stateDir, '.gitnexus-scorecard.json'),
    fallbackFlag: path.join(stateDir, '.gitnexus-fallback.json'),
    northStarCounter: path.join(stateDir, '.gitnexus-northstar-counter.json'),
    checkpointFile: path.join(stateDir, '.gitnexus-checkpoint-band.json'),
  };
}

// ── TASK-CORE (compaction-migration save-state) ──────────────────────────────
// A dense, AI-facing save-state of the CURRENT TASK (goal/constraints/decisions/state/
// anchors/gotchas/next). The task-core nudge hook prompts a refresh once enough edits have
// auto-compaction; the SessionStart(compact) recovery brief reads it back — so the task
// survives the summary without drift. Lives under .bearing/ (gitignored, survives compaction
// AND new sessions since a task can span both; the agent overwrites it when the task changes).

// ONE FILE PER CHAT, not per repo. A single `.bearing/.task-core.md` was wrong the moment two
// agent sessions ran in the same repository — which is the normal case, not the edge one: three
// editor windows, or a second chat opened to look at something, and they overwrite each other's
// save-state. The failure is worse than losing it: on recovery a session reads whatever the last
// writer left, so it reconstructs from ANOTHER CHAT'S TASK with full confidence. That is precisely
// the drift the task-core exists to prevent, produced by the task-core itself.

/** The legacy single-file path. Still read so an in-flight task is not lost on upgrade. */
function legacyTaskCorePath(root) {
  return path.join(root, '.bearing', '.task-core.md');
}

/** @param {string} root */
export function taskCoreDir(root) {
  return path.join(root, '.bearing', 'task-cores');
}

/**
 * Stable per-chat key, derived from the transcript path Claude Code passes every hook. Its basename
 * IS the session id, and it stays the same across compaction — the same session continues — which
 * is exactly when the core has to be found again.
 * @param {string} [transcriptPath]
 */
export function sessionKey(transcriptPath) {
  const base = path.basename(String(transcriptPath || ''), '.jsonl').trim();
  // Filesystem-safe and bounded. No transcript (a runtime that does not pass one) falls back to a
  // shared key, which reproduces the old single-file behaviour rather than dropping the core.
  const safe = base.replace(/[^\w.-]/g, '').slice(0, 64);
  return safe || 'shared';
}

/**
 * Make sure the directory exists before anyone is told to write into it.
 *
 * Moving from one file to a directory introduced a failure the single file never had: writing
 * `.bearing/task-cores/<id>.md` into a directory that does not exist is ENOENT, so the agent is
 * handed a path it cannot write. Cheap and idempotent; called at install and on session start.
 * @param {string} root
 */
export function ensureTaskCoreDir(root) {
  try {
    fs.mkdirSync(taskCoreDir(root), { recursive: true });
  } catch {
    /* best effort — a missing dir surfaces when the agent writes, not by failing the session */
  }
  return taskCoreDir(root);
}

/** @param {string} root @param {string} [key] */
export function taskCorePath(root, key) {
  return path.join(taskCoreDir(root), `${sessionKey(key)}.md`);
}

/** Non-empty file for this chat, else the legacy single file (one-way, for upgrades). */
function resolveTaskCore(root, key) {
  for (const p of [taskCorePath(root, key), legacyTaskCorePath(root)]) {
    try {
      if (fs.statSync(p).size > 0) return p;
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** @param {string} root @param {string} [key] @returns {boolean} */
export function taskCoreExists(root, key) {
  return resolveTaskCore(root, key) !== null;
}

/** Path the agent should actually READ on recovery — keyed if present, else the legacy file. */
export function taskCoreReadPath(root, key) {
  return resolveTaskCore(root, key) ?? taskCorePath(root, key);
}

/**
 * Drop cores from chats that ended long ago. Without this the directory grows one file per chat
 * forever. Never removes the CURRENT chat's core regardless of age — a long-running session that
 * has not needed to rewrite its core must not have it deleted underneath it.
 * @param {string} root @param {string} [keepKey] @param {number} [maxAgeMs] default 30 days
 */
export function pruneTaskCores(root, keepKey, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const keep = `${sessionKey(keepKey)}.md`;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(taskCoreDir(root))) {
      if (name === keep || !name.endsWith('.md')) continue;
      const p = path.join(taskCoreDir(root), name);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) {
          fs.unlinkSync(p);
          removed++;
        }
      } catch {
        /* best effort — a core we cannot stat or remove is not worth failing a session over */
      }
    }
  } catch {
    /* no directory yet */
  }
  return removed;
}

// ── NORTH-STARS (user-owned semantic anchor) ─────────────────────────────────
// The fixed point that stops SEMANTIC drift: a short, numbered, falsifiable statement of what
// this project IS — invariants, exact term meanings, settled decisions, and the graveyard of
// tried/rejected ideas. Distinct from the other two memories:
//   task-core  — AGENT-authored, ephemeral, THIS task, gitignored session state.
//   MEMORY.md  — running cross-session notes.
//   northstars — USER-owned, permanent, whole-project, TRACKED (committed, team-shared) and
//                AUTHORITATIVE: it outranks every other doc, and the agent may PROPOSE edits but
//                never silently make them — otherwise drift contaminates the anchor itself.
// Note the filename has NO dot prefix: the managed .gitignore covers `.bearing/.gitnexus-*`, so a
// dotted name would be ignored. This one is meant to be committed.

/** @param {string} root */
export function northStarsPath(root) {
  return path.join(root, '.bearing', 'northstars.md');
}

/** @param {string} root @returns {boolean} does a north-stars doc exist + have content? */
export function northStarsExists(root) {
  try {
    return fs.statSync(northStarsPath(root)).size > 0;
  } catch {
    return false;
  }
}

/** @param {string} root @returns {string} full north-stars text ('' if none) */
export function readNorthStars(root) {
  try {
    return fs.readFileSync(northStarsPath(root), 'utf8');
  } catch {
    return '';
  }
}

/**
 * The re-anchor payload: just the numbered `NS-#` propositions, verbatim. Re-injecting the WHOLE
 * doc every N tool calls would be expensive and would train the agent to skim it; the numbered
 * lines alone are the citable anchor, so they stay cheap enough to repeat mid-session.
 * @param {string} root
 * @param {number} max cap the number of lines returned (0 = no cap)
 * @returns {string[]} e.g. ['NS-1 — Backtest stop model MUST match the live order.', …]
 */
export function northStarsDigest(root, max = 0) {
  const out = [];
  for (const raw of readNorthStars(root).split('\n')) {
    // Tolerant of markdown noise: "- **NS-3** — …", "NS-3. …", "* NS-3: …", "### NS-3 — …".
    // The HEADING form was missing and cost a real repo its entire anchor: 15 well-written
    // north-stars written as `### NS-1 — …` produced a digest of ZERO, so the hook took the
    // "file exists but has no NS-# lines yet" exit and emitted nothing, silently, on every fire.
    // Nothing reported it — the feature simply did not happen. A structure the author chose is
    // not "noise", and this list must cover the ordinary ways a person numbers a doc.
    if (!/^\s*(?:#{1,6}\s*)?(?:[-*+]\s*)?\**\s*NS-\d+\b/.test(raw)) continue;
    const line = raw
      .replace(/^\s*(?:#{1,6}\s*)?(?:[-*+]\s*)?/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (line) out.push(line);
    if (max > 0 && out.length >= max) break;
  }
  return out;
}

/**
 * Count tool calls since the last re-anchor, so the anchor hook can fire every N calls.
 * @param {string} root
 * @param {boolean} reset start the count over (called right after an anchor is emitted)
 * @returns {number} the count AFTER this call
 */
export function bumpNorthStarCounter(root, reset = false, key = null) {
  const { stateDir, northStarCounter } = sessionPaths(root);
  // ONE COUNTER PER CHAT, not per repo — the same correction the task-core was given, and for the
  // same reason: several agent sessions in one repository is the normal case, not the edge one.
  // A single shared counter meant every concurrent agent bumped it, so with N sessions the repo
  // fired N times as many anchors and each landed in whichever agent happened to make the 25th
  // call — targeted at random rather than at the one that drifted. Measured on this repo: three
  // bumps per one of the observing agent's own tool calls, and 391 anchors in a single repo's
  // telemetry against 8 impact gates fleet-wide. Its neighbours `.bearing-microscope-<key>.json`
  // and `.bearing-consult-<key>.flag` were already keyed; this one was not.
  const counterPath = key
    ? path.join(stateDir, `.gitnexus-northstar-counter-${sessionKey(key)}.json`)
    : northStarCounter;
  let n = 0;
  if (!reset) {
    try {
      n = JSON.parse(fs.readFileSync(counterPath, 'utf8')).n || 0;
    } catch {
      n = 0;
    }
  }
  const next = reset ? 0 : n + 1;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    // Two PostToolUse hooks run per tool call and both touch session state. Write-then-rename so a
    // concurrent reader never observes a partially-written file. (Lost updates are still possible
    // and are benign here: the anchor fires a little later than configured.)
    const tmp = `${counterPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ n: next }));
    fs.renameSync(tmp, counterPath);
  } catch {
    /* best-effort — a missing counter just means we anchor again sooner */
  }
  return next;
}

// ── Classical fallback escape hatch ──────────────────────────────────────────
// When GitNexus returns wrong / suspicious / incomplete info while the index is
// FRESH, graph-first enforcement would otherwise trap the agent. grantClassicalFallback
// opens a BOUNDED, REASONED, LOGGED window where classical Grep/Read/shell are allowed
// (evaluateStalePolicy honours it → phase classical_fallback). It is surfaced in the
// session brief + `gitnexus:status`, so it can never be a silent lazy bypass.

const FALLBACK_TTL_MS = 15 * 60 * 1000; // 15 min, then enforcement auto-resumes

/** @param {string} root @param {string} reason @param {number} [ttlMs] */
export function grantClassicalFallback(root, reason = '', ttlMs = FALLBACK_TTL_MS) {
  const { stateDir, fallbackFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    fallbackFlag,
    JSON.stringify(
      { at: new Date().toISOString(), reason: String(reason).slice(0, 300), ttlMs },
      null,
      2,
    ),
  );
}

// ── Fallback → telemetry bridge (a "where did GitNexus fail" report log) ──────
// The grant flag is transient (expires/clears). To see WHERE GitNexus fell short and
// report it upstream, every fallback also appends a durable record — the reason plus the
// graph state it distrusted (version, size, index commit/age) — to an append-only log.
// Read via `gitnexus:fallback-log` (+ `--json` to export for the GitNexus developers).

const FALLBACK_LOG_FILE = '.gitnexus-fallback-log.jsonl';

/** @param {string} root — append-only fallback-report log (gitignored, never cleared). */
export function fallbackLogPath(root) {
  return path.join(root, '.bearing', FALLBACK_LOG_FILE);
}

/**
 * Append a fallback report: the agent's stated reason + the graph state it distrusted, so
 * the user can review where GitNexus fell short and report it to the GN developers.
 * @param {string} root @param {string} reason @returns {boolean} written?
 */
export function appendFallbackReport(root, reason) {
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(root, '.gitnexus/meta.json'), 'utf8'));
  } catch {
    /* index may be missing — that itself is context */
  }
  const s = meta.stats || {};
  const rec = {
    at: new Date().toISOString(),
    repo: repoName(root),
    reason: String(reason || '').slice(0, 1000),
    gitnexusVersion: meta.version ?? meta.gitnexusVersion ?? null,
    index: {
      files: s.files ?? null,
      nodes: s.nodes ?? null,
      edges: s.edges ?? null,
      embeddings: s.embeddings ?? null,
      processes: s.processes ?? null,
    },
    indexedCommit: meta.lastCommit ?? null,
    indexedAt: meta.indexedAt ?? null,
  };
  try {
    fs.mkdirSync(path.join(root, '.bearing'), { recursive: true });
    fs.appendFileSync(fallbackLogPath(root), JSON.stringify(rec) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Parse the fallback-report log into records (skips blank/malformed lines). */
export function readFallbackReports(root) {
  let text = '';
  try {
    text = fs.readFileSync(fallbackLogPath(root), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** @param {string} root */
export function revokeClassicalFallback(root) {
  try {
    fs.unlinkSync(sessionPaths(root).fallbackFlag);
  } catch {
    /* ignore */
  }
}

/**
 * Active classical-fallback grant, or null. Auto-expires (and self-cleans) after ttlMs.
 * @param {string} root
 * @returns {{ reason: string, remainingMs: number, expiresAt: string } | null}
 */
export function fallbackGrant(root) {
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(sessionPaths(root).fallbackFlag, 'utf8'));
  } catch {
    return null;
  }
  const startedAt = Date.parse(rec.at);
  if (!Number.isFinite(startedAt)) return null;
  const ttl = typeof rec.ttlMs === 'number' ? rec.ttlMs : FALLBACK_TTL_MS;
  const remainingMs = startedAt + ttl - Date.now();
  if (remainingMs <= 0) {
    revokeClassicalFallback(root);
    return null;
  }
  return {
    reason: rec.reason || '',
    remainingMs,
    expiresAt: new Date(startedAt + ttl).toISOString(),
  };
}

/**
 * Record which GitNexus MCP tool the agent used, so edit/commit guards can enforce
 * "impact before edit" and "detect_changes before commit" once per session.
 * @param {string} root
 * @param {string} toolName e.g. "gitnexus_impact" / "mcp_gitnexus_detect_changes"
 */
export function setMcpToolUsed(root, toolName) {
  const { stateDir, mcpUsedFlag, impactUsedFlag, detectUsedFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  const stamp = new Date().toISOString();
  try {
    fs.writeFileSync(mcpUsedFlag, stamp);
    if (/impact|rename/i.test(toolName)) fs.writeFileSync(impactUsedFlag, stamp);
    if (/detect_changes|detect-changes/i.test(toolName)) fs.writeFileSync(detectUsedFlag, stamp);
  } catch {
    /* best effort */
  }
}

/** @param {string} root */
export function isImpactUsed(root) {
  return fs.existsSync(sessionPaths(root).impactUsedFlag);
}

/** @param {string} root */
export function isDetectUsed(root) {
  return fs.existsSync(sessionPaths(root).detectUsedFlag);
}

/**
 * Lightweight enforcement scorecard — counts how often the kit redirected the agent
 * from a lazy pattern to the graph. Surfaced in agent-brief / `gitnexus:scorecard`.
 * @param {string} root
 * @param {string} key
 */
export function bumpScore(root, key) {
  const { stateDir, scorecardFile } = sessionPaths(root);
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    let card = {};
    try {
      card = JSON.parse(fs.readFileSync(scorecardFile, 'utf8'));
    } catch {
      card = {};
    }
    card.counts ??= {};
    card.counts[key] = (card.counts[key] ?? 0) + 1;
    card.startedAt ??= new Date().toISOString();
    card.updatedAt = new Date().toISOString();
    fs.writeFileSync(scorecardFile, JSON.stringify(card, null, 2));
  } catch {
    /* best effort — never block a tool on telemetry */
  }
}

/** @param {string} root */
/**
 * Is the enforcement layer earning its keep, or is it just getting in the way?
 *
 * The kit collects every number needed to answer that and never asked the question. A real session
 * logged 60 graph calls against 49 grep redirects and 8 read redirects — the gates were the
 * dominant interaction, not the graph — and nothing surfaced it. The operator only found out
 * because an agent wrote a report by hand.
 *
 * Deliberately conservative: it stays silent below a traffic floor (early ratios are noise), and
 * every finding names the concrete knob to turn. A diagnosis nobody can act on is just another
 * unactionable message (NS-6).
 *
 * @param {Record<string, number>} counts scorecard counts
 * @returns {{ level: 'warn'|'info', headline: string, advice: string }[]}
 */
export function diagnoseEnforcement(counts = {}) {
  const n = (k) => Number(counts[k] ?? 0);
  const redirects = n('grepRedirects') + n('readRedirects');
  const graphCalls = n('graphCalls');
  const findings = [];
  if (redirects + graphCalls < 15) return findings; // too little traffic to mean anything

  // Not `redirects > graphCalls`: a real reported session ran 57 redirects against 60 graph calls
  // and read as "the gates are the dominant interaction" to the operator, yet a strict majority
  // rule stays silent on it. What matters is that enforcement is a large SHARE of the session.
  if (redirects >= graphCalls * 0.75) {
    findings.push({
      level: 'warn',
      headline:
        `Enforcement is ${Math.round((redirects / (redirects + graphCalls)) * 100)}% of graph interaction: ` +
        `${redirects} redirects vs ${graphCalls} graph calls.`,
      advice:
        'This reads two ways and the log tells you which: the gates may be firing on work the graph ' +
        'cannot answer (a real misfit), OR they may be doing exactly their job on an agent that ' +
        `keeps reaching for grep first (working as intended). Check \`${howToRun('bearing:fallback-log')}\` ` +
        '— recurring distrust of the same tool is the first case and is worth reporting upstream; ' +
        'an empty log points at the second. Only downgrade to `"mode": "guide"` for the first.',
    });
  }
  if (n('classicalFallbackGranted') >= 3) {
    findings.push({
      level: 'warn',
      headline: `${n('classicalFallbackGranted')} classical-fallback grants — agents repeatedly distrusted the graph.`,
      advice:
        `Each grant is a logged failure report. Review with \`${howToRun('bearing:fallback-log')} --json\` ` +
        'and send it upstream; a recurring shape there is a real coverage gap, not agent error.',
    });
  }
  if (n('impactVerdictsQuestioned') >= 2) {
    findings.push({
      level: 'warn',
      headline: `${n('impactVerdictsQuestioned')} impact verdicts had no resolvable callers.`,
      advice:
        'The pre-edit gate is grading changes on a caller set it could not resolve (DI/factory ' +
        'seams, module consts). Confirm blast radius classically before edits in those areas.',
    });
  }
  if (n('driftRefreshBlocks') >= 5) {
    findings.push({
      level: 'info',
      headline: `${n('driftRefreshBlocks')} drift-refresh blocks — the drift gate is firing often.`,
      advice:
        'Expected during a large refactor. If it is constant, raise `driftRefreshThreshold` in ' +
        '.bearing/hooks.json (default 3 uncommitted source edits).',
    });
  }
  return findings;
}

export function readScorecard(root) {
  try {
    return JSON.parse(fs.readFileSync(sessionPaths(root).scorecardFile, 'utf8'));
  } catch {
    return { counts: {} };
  }
}

// ── Persistent telemetry ─────────────────────────────────────────────────────
// The scorecard is per-session (cleared on session start). Before clearing, we
// archive each finished session's tally to an append-only .jsonl so aggregate
// trends survive across sessions. Read/aggregate via `npm run bearing:stats`.

const TELEMETRY_FILE = '.gitnexus-telemetry.jsonl';

/** @param {string} root — append-only telemetry log (gitignored, never cleared). */
export function telemetryPath(root) {
  return path.join(root, '.bearing', TELEMETRY_FILE);
}

/** Best-effort index stats snapshot for context on a telemetry record. */
function indexSnapshot(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, '.gitnexus/meta.json'), 'utf8')).stats || {};
    return {
      files: s.files ?? null,
      nodes: s.nodes ?? null,
      embeddings: s.embeddings ?? null,
      processes: s.processes ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Archive the finished session's scorecard to the persistent telemetry log.
 * No-op when the session recorded nothing. Never throws (telemetry must not
 * block session start).
 * @param {string} root
 * @returns {boolean} whether a record was written
 */
export function flushScorecardToTelemetry(root) {
  const card = readScorecard(root);
  if (!card?.counts || Object.keys(card.counts).length === 0) return false;
  const startedAt = card.startedAt ?? null;
  const endedAt = card.updatedAt ?? null;
  const durationMs =
    startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : null;
  const rec = { startedAt, endedAt, durationMs, counts: card.counts, index: indexSnapshot(root) };
  try {
    fs.mkdirSync(path.join(root, '.bearing'), { recursive: true });
    fs.appendFileSync(telemetryPath(root), JSON.stringify(rec) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Parse the telemetry log into records (skips blank/malformed lines). */
export function readTelemetry(root) {
  let text = '';
  try {
    text = fs.readFileSync(telemetryPath(root), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Aggregate telemetry records into totals / per-session averages / recent. */
export function summarizeTelemetry(records) {
  const sessions = records.length;
  const totals = {};
  let totalDurationMs = 0;
  let durCount = 0;
  let firstAt = null;
  let lastAt = null;
  for (const r of records) {
    for (const [k, v] of Object.entries(r.counts || {})) {
      totals[k] = (totals[k] ?? 0) + (Number(v) || 0);
    }
    if (typeof r.durationMs === 'number') {
      totalDurationMs += r.durationMs;
      durCount++;
    }
    if (r.startedAt && (!firstAt || r.startedAt < firstAt)) firstAt = r.startedAt;
    if (r.endedAt && (!lastAt || r.endedAt > lastAt)) lastAt = r.endedAt;
  }
  const avgPerSession = {};
  for (const [k, v] of Object.entries(totals)) {
    avgPerSession[k] = sessions ? Math.round((v / sessions) * 100) / 100 : 0;
  }
  return {
    sessions,
    firstAt,
    lastAt,
    totals,
    avgPerSession,
    avgDurationMs: durCount ? Math.round(totalDurationMs / durCount) : null,
    recent: records.slice(-5),
  };
}

export function setRefreshPending(root, pending, detail = '') {
  const { stateDir, refreshPendingFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  if (pending) {
    fs.writeFileSync(refreshPendingFlag, JSON.stringify({ at: new Date().toISOString(), detail }, null, 2));
  } else {
    try {
      fs.unlinkSync(refreshPendingFlag);
    } catch {
      /* ignore */
    }
  }
}

export function isRefreshPending(root) {
  const { refreshPendingFlag } = sessionPaths(root);
  return fs.existsSync(refreshPendingFlag);
}

export function setRefreshFailed(root, failed, detail = '') {
  const { stateDir, refreshFailedFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  if (failed) {
    fs.writeFileSync(refreshFailedFlag, JSON.stringify({ at: new Date().toISOString(), detail }, null, 2));
  } else {
    try {
      fs.unlinkSync(refreshFailedFlag);
    } catch {
      /* ignore */
    }
  }
}

export function isRefreshFailed(root) {
  const { refreshFailedFlag } = sessionPaths(root);
  return fs.existsSync(refreshFailedFlag);
}

// ── Durable memory + compaction recovery ────────────────────────────────────
// Context compaction (auto or manual) drops the middle of a conversation. The
// per-session gate flags + a running memory file must survive it, so the agent
// doesn't re-run cleared gates or lose task state after a compaction.

const MEMORY_FILE = 'MEMORY.md';

/**
 * Claude Code's NATIVE per-project memory file — `~/.claude/projects/<slug>/memory/MEMORY.md`,
 * where <slug> is the project's absolute path with "/" → "-". We reuse it (not a kit-specific
 * file) so Claude Code refers to its own memory and every other agent mirrors the same file.
 * Lives outside the repo, so it is never committed/gitignored.
 * @param {string} root project root (absolute)
 */
export function memoryPath(root) {
  const home = process.env.HOME || os.homedir();
  const slug = path.resolve(root).replace(/\//g, '-');
  return path.join(home, '.claude', 'projects', slug, 'memory', MEMORY_FILE);
}

/**
 * Clear per-session state ONLY on a genuinely new session. A compaction/resume
 * is the SAME task continuing — clearing there would wipe satisfied gates and
 * re-block the agent mid-task.
 * @param {string} [source] Claude SessionStart source: startup|clear|compact|resume
 */
export function shouldClearOnSource(source) {
  return source !== 'compact' && source !== 'resume';
}

/**
 * MEMORY.md IS AN INDEX, NOT A NOTEBOOK — so bearing does not write to it.
 *
 * `appendMemoryCheckpoint` used to append a two-line PreCompact breadcrumb here. Under the Claude
 * Code CLI that file is the memory INDEX: it is loaded into context on EVERY session, and its
 * contract is one `- [Title](file.md) — hook` line per memory, with the content in the files those
 * point at. So each compaction did not preserve state — it pushed two lines of kit telemetry into
 * every future session's window and buried the real pointers. One real project accumulated nine
 * near-identical stanzas around a single genuine entry.
 *
 * Nothing ever READ them: the only consumer checked whether the file exists, never its contents.
 * A write-only append to someone else's index is not a checkpoint, it is litter — and the durable
 * state it claimed to be preserving already lives in `.bearing/task-cores/<chat>.md`, per chat,
 * rewritten by the agent that owns it. The compaction COUNT is still recorded, in the scorecard.
 *
 * `memoryPath` stays: the session brief points the agent at their own memory, which is correct.
 */

export function clearSessionState(root) {
  const {
    stateDir,
    primedFlag,
    promptHint,
    mcpUsedFlag,
    impactUsedFlag,
    detectUsedFlag,
    refreshFailedFlag,
    // refreshFailedFlag is deliberately NOT here. Everything else in this list is per-session —
    // gates satisfied, nudges shown, counters — and resetting it for a new session is right.
    // "The index could not be built" is not a fact about the session: an index does not repair
    // itself because the user opened a new chat. Clearing it meant the pre-commit hook's warning
    // survived only until the next session, after which the agent went back to trusting a graph
    // that had failed to build. It is cleared where it is actually disproven — bearing-agent
    // passes `clear` on a successful refresh and `set-failed` on a failed one.
    stalenessCacheFile,
    scorecardFile,
    fallbackFlag,
    northStarCounter,
  } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  // Archive the finishing session's tally BEFORE wiping the scorecard.
  flushScorecardToTelemetry(root);
  for (const f of [
    primedFlag,
    promptHint,
    mcpUsedFlag,
    impactUsedFlag,
    detectUsedFlag,
    stalenessCacheFile,
    scorecardFile,
    fallbackFlag,
    // NB the north-stars DOC itself is never touched here (it's user-owned + committed) — only the
    // per-session anchor counter, so a new session re-anchors promptly.
    northStarCounter,
  ]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  for (const rel of ['.bearing-session-user-notified.flag']) {
    try {
      fs.unlinkSync(path.join(stateDir, rel));
    } catch {
      /* ignore */
    }
  }
  clearDenyCache(root);
}

export function writePromptHint(root, hint) {
  const { stateDir, promptHint } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(promptHint, JSON.stringify({ ...hint, at: new Date().toISOString() }, null, 2));
}

export function readPromptHint(root) {
  const { promptHint } = sessionPaths(root);
  try {
    return JSON.parse(fs.readFileSync(promptHint, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Returns nudge text once per session (sets primed flag).
 * @param {object} stale from check-staleness.mjs
 */
export function firstToolNudge(root, stale) {
  const { primedFlag } = sessionPaths(root);
  if (fs.existsSync(primedFlag)) return null;

  fs.mkdirSync(path.dirname(primedFlag), { recursive: true });
  fs.writeFileSync(primedFlag, new Date().toISOString());

  const hint = readPromptHint(root);
  const repo = repoName(root);
  const parts = [];

  if (!stale?.fresh) {
    const reason =
      stale?.reason === 'missing_embeddings'
        ? 'MISSING EMBEDDINGS: semantic query unavailable — '
        : 'STALE INDEX: ';
    parts.push(
      `${reason}next Shell MUST be ${howToRun('bearing:agent-refresh')} (required_permissions: ["all"]). Includes --embeddings. Run yourself — never ask user to analyze.`
    );
  } else {
    parts.push(`SESSION: ${mcpReadContext(repo)} OR ${howToRun('bearing:agent-brief')}`);
  }

  const playbook = playbookForHint(hint, repo);
  if (playbook) parts.push(playbook);

  return parts.join('\n');
}

