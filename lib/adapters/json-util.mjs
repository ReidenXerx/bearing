import fs from "node:fs";
import path from "node:path";

/**
 * Read + parse a JSON file, returning `fallback` if it is missing OR malformed.
 * Never throws — a hand-edited broken config must not abort install/uninstall.
 * @template T
 * @param {string} filePath
 * @param {T} fallback
 * @returns {T}
 */
export function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Strip line comments, block comments and trailing commas, outside strings — JSONC, the format Zed's
 * project settings use by default and that people hand-edit into `.claude/settings.json`.
 * @param {string} text
 */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      i = i < 0 ? text.length : i + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Config files this run could not wire because they did not parse. A library must not set the host
 * process's exit code (the suite calls installKit in-process), so the adapters record here and the
 * installer decides, as the CLI, whether to exit non-zero.
 * @type {string[]}
 */
export const unreadableConfigs = [];

/**
 * Read a config file bearing is about to MERGE INTO and write back — which is never safe with
 * readJsonSafe's fallback: a file that did not parse as strict JSON (a comment, a trailing comma)
 * became `{}`, bearing's keys were written over it, and the user's settings were gone with no
 * backup — a team's `permissions.allow` replaced by the hooks block, Zed's `tab_size` erased.
 *
 * - strict JSON → parsed, as before;
 * - JSONC → parsed; the original is backed up once (rewriting drops its comments) and that is said;
 * - neither → `unreadable: true`, and the caller must leave the file alone and say so.
 * @template T
 * @param {string} filePath @param {T} fallback
 * @returns {{ value: T | any, unreadable: boolean, note?: string }}
 */
export function readJsonForMerge(filePath, fallback, { backupNow = true } = {}) {
  if (!fs.existsSync(filePath)) return { value: fallback, unreadable: false };
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return { value: fallback, unreadable: false };
  try {
    return { value: JSON.parse(text), unreadable: false };
  } catch {
    /* not strict JSON — try JSONC */
  }
  try {
    const value = JSON.parse(stripJsonc(text));
    const bak = `${filePath}.bearing-backup`;
    // Lazy for a caller that may end up writing nothing (an uninstall with nothing of ours to remove).
    const backup = () => {
      if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak);
    };
    if (backupNow) backup();
    return {
      value,
      unreadable: false,
      backup,
      note: `${path.basename(filePath)} had comments or trailing commas, which rewriting it drops — the original is at ${path.basename(bak)}`,
    };
  } catch {
    return { value: fallback, unreadable: true };
  }
}

/** @param {string} filePath @param {unknown} obj */
export function writeJson(filePath, obj) {
  // A NO-OP WRITE IS NOT FREE when the file belongs to the repo rather than to us. bearing
  // re-serialises what it merges, so a `.mcp.json` whose gitnexus entry was written on one line
  // came back expanded over six — every update dirtied a committed, team-shared file with a diff
  // that changed nothing, and reviewers had to read it to find that out. Compare PARSED content,
  // not bytes: only then does "unchanged" mean unchanged, and the project's own formatting
  // survives (NS-1 — the file is theirs, and we were only asked to add one key).
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (JSON.stringify(existing) === JSON.stringify(obj)) return;
  } catch {
    /* absent or malformed — fall through and write */
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

/**
 * Deep-merge plain objects (arrays are replaced, not concatenated).
 * @param {Record<string, any>} base
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
export function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === "object" &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
