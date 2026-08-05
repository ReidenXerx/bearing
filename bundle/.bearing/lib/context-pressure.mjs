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

// Widen the tail read until a usage record appears. A single huge tool-result line (a big file
// read / grep / command dump can be MBs) sits at the very end at PostToolUse time and pushes the
// preceding assistant usage out of a small tail — so 128 KB alone often misses it. Cap the widen
// so the hook stays cheap; past the cap we report "unknown" rather than guessing.
const TAIL_STEPS = [131072, 2097152, 8388608]; // 128 KB → 2 MB → 8 MB

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
export function contextPressure(transcriptPath, config = {}) {
  const window = Number(config.contextWindowTokens) > 0 ? Number(config.contextWindowTokens) : 200000;
  const threshold =
    Number(config.contextPressureThreshold) > 0 ? Number(config.contextPressureThreshold) : 0.9;
  const tokens = estimateContextTokens(transcriptPath);
  const ratio = window > 0 ? tokens / window : 0;
  return { tokens, window, threshold, ratio, over: ratio >= threshold };
}
