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
