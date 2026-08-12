#!/usr/bin/env node
/**
 * Context-pressure estimation for the TASK-CORE compaction-migration routine.
 *
 * Claude Code auto-compacts (summarizes + drops the transcript) when the context window
 * fills. The PreCompact hook CANNOT make the agent act or inject context, so we can't wait
 * for it. Instead a PostToolUse hook estimates how full the window is and, past a threshold,
 * nudges the agent to write/refresh its TASK-CORE *before* the summary lands — the only thing
 * guaranteed to survive compaction with full detail.
 *
 * This module is the estimator: it reads the CURRENT context size from the transcript cheaply
 * (tail-read, no full-file parse) and accurately (the last assistant message's usage = the
 * exact prompt size the model saw), with a byte-size fallback.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Widen the tail read until a usage record appears. A single huge tool-result line (a big file
// read / grep / command dump can be MBs) sits at the very end at PostToolUse time and pushes the
// preceding assistant usage out of a small tail — so 128 KB alone often misses it. Cap the widen
// so the hook stays cheap; past the cap we report "unknown" rather than guessing.
// 128 KB → 2 MB → 8 MB → 32 MB. A single tool result can be many MB and sits at the very tail at
// PostToolUse time, pushing the last usage record out of a smaller window. Past the final step we
// report unknown, which reads as "not full" — silent, and correlated with the highest-risk moment —
// so the cap is generous enough that a realistic giant result still resolves.
const TAIL_STEPS = [131072, 2097152, 8388608, 33554432];

/**
 * Estimate the current context size in tokens from a Claude Code transcript (JSONL).
 * The signal is the LAST assistant message's usage (non-cached input + cache read + cache creation
 * = everything sent to the model). We deliberately DO NOT fall back to a byte-count of the file:
 * the transcript is an unbounded append-only log (it keeps already-compacted turns), so its size
 * has no relation to current window occupancy — a byte estimate reads as "always full" and would
 * fire the compaction nudge spuriously. Unknown → 0, which the caller treats as "not full".
 * @param {string} transcriptPath
 * @returns {number} estimated context tokens (0 if unknown/unreadable)
 */
export function estimateContextTokens(transcriptPath) {
  let size = 0;
  try {
    size = fs.statSync(transcriptPath).size;
  } catch {
    return 0;
  }
  if (!size) return 0;

  let prevRead = 0;
  for (const step of TAIL_STEPS) {
    const readBytes = Math.min(size, step);
    if (readBytes <= prevRead) break; // whole file already scanned
    let text;
    try {
      const fd = fs.openSync(transcriptPath, "r");
      try {
        const buf = Buffer.alloc(readBytes);
        fs.readSync(fd, buf, 0, readBytes, size - readBytes);
        text = buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return 0; // unreadable → unknown, never nudge on a guess
    }
    const tokens = lastUsageTokens(text);
    if (tokens != null) return tokens;
    if (readBytes >= size) break; // scanned the entire file, no usage present
    prevRead = readBytes;
  }
  return 0; // no usage record found → unknown (not "full")
}

/**
 * Sum the LAST assistant-message usage in a JSONL chunk, scanning from the end. A leading partial
 * line (the tail cut mid-record) simply fails to parse and is skipped.
 * @param {string} text
 * @returns {number | null} token total, or null if no usage record present
 */
function lastUsageTokens(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // partial line or non-JSON — skip
    }
    const u = obj?.message?.usage || obj?.usage;
    if (u && typeof u.input_tokens === "number") {
      return (
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0)
      );
    }
  }
  return null;
}

/**
 * @param {string} transcriptPath
 * @param {{ contextWindowTokens?: number, contextPressureThreshold?: number }} config
 * @returns {{ tokens: number, window: number, threshold: number, ratio: number, over: boolean }}
 */
/**
 * Context windows sold today, smallest first. Used only to round an OBSERVED size up to the
 * nearest real one — never to guess which model is running.
 */
const KNOWN_WINDOWS = [200_000, 1_000_000];

/**
 * The window the session ACTUALLY has.
 *
 * The transcript does not record it and the model id cannot settle it — `claude-opus-5` is the
 * same string on a 200k and a 1M session. So the assumption is corrected by EVIDENCE: a session
 * that has already carried more tokens than the assumed window is proof the assumption is too
 * small, since a real 200k session cannot hold 300k. Round that observation up to the nearest
 * real window rather than trusting it exactly, because usage is measured at the last assistant
 * turn and the true ceiling is higher than whatever we happened to see.
 *
 * Only ever revises UPWARD. Guessing a window too small is the failure being fixed here — it had
 * every 1M session reading 150% full, so the agent wrote task-cores and hedged about running out
 * from the first hour on, permanently. Guessing too large merely delays a warning.
 *
 * An explicit `contextWindowTokens` is the user's own statement of fact and always wins.
 * @param {number} tokens observed @param {number|undefined} configured
 */
export function resolveWindow(tokens, configured) {
  if (Number(configured) > 0) return Number(configured);
  const base = KNOWN_WINDOWS[0];
  if (!(tokens > base)) return base;
  return KNOWN_WINDOWS.find((w) => w >= tokens) ?? tokens;
}

/**
 * The window PROVEN by an auto-compaction, read from the transcript.
 *
 * Claude Code writes a `compact_boundary` record when it compacts, carrying
 * `compactMetadata: { trigger: "auto", preTokens }`. `preTokens` is the size the session had
 * reached when the CLIENT decided it was full — which is the window itself, measured rather than
 * assumed. `trigger: "manual"` proves nothing: a person can /compact at any size.
 *
 * Rounds DOWN, where the usage signal rounds up, because the two prove opposite bounds. Usage of N
 * proves the window is at LEAST N — the session held it. An auto-compaction at N proves it is at
 * MOST N, and slightly less: the check runs after a turn completes, so it overshoots. Real values
 * seen on one machine were 1000070, 1000459 and 1001889 — all of them a 1M window.
 * @param {string} text a chunk of JSONL
 * @returns {number} proven window, or 0
 */
export function windowFromCompaction(text) {
  let best = 0;
  const re = /"trigger":"auto","preTokens":(\d+)/g;
  for (const m of text.matchAll(re)) best = Math.max(best, Number(m[1]) || 0);
  if (!best) return 0;
  const atOrBelow = KNOWN_WINDOWS.filter((w) => w <= best);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : best;
}

/**
 * What the machine's own history says the window is.
 *
 * The estimator's blind spot is structural, not a tuning problem: it corrects the assumed window by
 * noticing usage ABOVE it, but the warning fires at 90% — BELOW it. So on a 1M session the false
 * "you are nearly full" is guaranteed to land in the 180k–200k band every single time, and the
 * evidence that would have prevented it only arrives afterwards. Observed: 197,084 tokens read as
 * 98.5% full when it was 19.7%.
 *
 * Recent transcripts settle it. An auto-compaction anywhere on this machine is a measurement of the
 * window that was actually in force, and the setting is sticky across sessions — far better than a
 * hardcoded floor. Newest-first and capped, because this is only consulted at the moment we would
 * otherwise cry wolf, and a wrong-but-cheap answer beats a slow one.
 * @param {number} limit how many recent transcripts to consult
 * @returns {number} learned window, or 0
 */
export function learnWindowFromHistory(limit = 24) {
  try {
    const home = process.env.HOME || os.homedir();
    const base = path.join(home, ".claude", "projects");
    /** @type {{p: string, m: number}[]} */
    const files = [];
    for (const dir of fs.readdirSync(base)) {
      const d = path.join(base, dir);
      let entries;
      try {
        entries = fs.readdirSync(d);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (!f.endsWith(".jsonl")) continue;
        const p = path.join(d, f);
        try {
          files.push({ p, m: fs.statSync(p).mtimeMs });
        } catch {
          /* vanished mid-scan */
        }
      }
    }
    files.sort((a, b) => b.m - a.m);
    let best = 0;
    for (const { p } of files.slice(0, limit)) {
      try {
        best = Math.max(best, windowFromCompaction(fs.readFileSync(p, "utf8")));
      } catch {
        /* unreadable — skip */
      }
      if (best >= KNOWN_WINDOWS[KNOWN_WINDOWS.length - 1]) break; // cannot do better
    }
    return best;
  } catch {
    return 0;
  }
}

/**
 * Remember what the evidence said, per session.
 *
 * Without this the lookup is not paid once, it is paid on EVERY PostToolUse for as long as the
 * session sits in the ambiguous band — and the worst case is the machine that has no evidence at
 * all, which reads two dozen transcripts in full and concludes nothing, over and over.
 *
 * Kept beside the transcripts it summarizes, NOT in the repo: the finding is about this machine, and
 * a stealth install cannot afford a new path inside someone else's project. Colocating also scopes
 * the cache to the same HOME the evidence was read from — a cache keyed only by session would
 * outlive the world it described.
 *
 * A negative expires; a positive does not. "No evidence yet" is a statement about a moment — the
 * session may compact five minutes later and settle it — while a window that has been PROVEN cannot
 * become unproven.
 */
const CACHE_FILE = () =>
  path.join(process.env.HOME || os.homedir(), ".claude", ".bearing-context-window.json");
const NEGATIVE_TTL_MS = 15 * 60 * 1000;

function readWindowCache(key) {
  try {
    const all = JSON.parse(fs.readFileSync(CACHE_FILE(), "utf8"));
    const hit = all[key];
    if (!hit || !(hit.window > 0)) return null;
    if (hit.source === "assumed" && Date.now() - hit.at > NEGATIVE_TTL_MS) return null;
    return hit;
  } catch {
    return null;
  }
}

function writeWindowCache(key, window, source) {
  try {
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(CACHE_FILE(), "utf8"));
    } catch {
      /* first write */
    }
    all[key] = { window, source, at: Date.now() };
    fs.mkdirSync(path.dirname(CACHE_FILE()), { recursive: true });
    // Bound it — one entry per session transcript, and sessions are endless over a machine's life.
    const keys = Object.keys(all);
    if (keys.length > 200) {
      for (const k of keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, 100))
        delete all[k];
    }
    fs.writeFileSync(CACHE_FILE(), JSON.stringify(all));
  } catch {
    /* a cache that cannot be written is a slow correct answer, not a wrong one */
  }
}

export function contextPressure(transcriptPath, config = {}) {
  const threshold =
    Number(config.contextPressureThreshold) > 0 ? Number(config.contextPressureThreshold) : 0.9;
  const tokens = estimateContextTokens(transcriptPath);
  let window = resolveWindow(tokens, config.contextWindowTokens);
  /** @type {'configured'|'usage'|'compaction'|'history'|'assumed'} */
  let source =
    Number(config.contextWindowTokens) > 0
      ? "configured"
      : tokens > KNOWN_WINDOWS[0]
        ? "usage"
        : "assumed";

  // Only pay for evidence when it could change what we SAY. Below the threshold the answer is
  // "quiet" either way, and reading transcripts on every PostToolUse to confirm silence would be
  // pure cost. So the lookup happens exactly once conditions are wrong enough to cry wolf.
  // Investigate as soon as the answer could change ANY message, not just the loud one. The periodic
  // checkpoints divide the window into bands, so they need it resolved from the first band onward —
  // waiting for the 90% warning meant a 1M session spent all nine checkpoints inside its first 195k
  // tokens (reported as 13%, 30%, 53%, 80%, 98%) and then went silent for the remaining 800k. The
  // per-session cache keeps this to one lookup.
  const every = Number(config.contextCheckpointEvery) > 0 ? Number(config.contextCheckpointEvery) : 0;
  const investigateAt = every > 0 ? Math.min(threshold, every) : threshold;
  if (source === "assumed" && window > 0 && tokens / window >= investigateAt) {
    const hit = readWindowCache(transcriptPath);
    if (hit) {
      window = hit.window;
      source = hit.source;
    } else {
      let proven = 0;
      try {
        proven = windowFromCompaction(fs.readFileSync(transcriptPath, "utf8"));
      } catch {
        /* unreadable — fall through to history */
      }
      if (proven > window) {
        window = proven;
        source = "compaction";
      } else {
        const learned = learnWindowFromHistory();
        if (learned > window) {
          window = learned;
          source = "history";
        }
      }
      writeWindowCache(transcriptPath, window, source);
    }
  }

  const ratio = window > 0 ? tokens / window : 0;
  return { tokens, window, threshold, ratio, over: ratio >= threshold, source };
}
