/**
 * Read CHANGELOG.md — the one description of every release, so nothing here rewrites or summarises
 * it. Two callers: `scripts/release-notes.mjs` (cuts a section for a GitHub release) and the
 * installer (tells you what changed since the version you had).
 *
 * Lives in lib/ rather than scripts/ because the INSTALLER needs it at runtime, and everything
 * under scripts/ is owned by the gitnexus feature — an intel-only install has none of it (NS-21).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `## 1.0.7 — title` or `## Unreleased`. The em-dash separator is the file's own convention. */
const HEADING = /^## +(\S+)(?: +[—-] +(.*))?$/;

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} md
 * @returns {{version: string, title: string, body: string, preRename: boolean}[]} newest first
 */
export function parseChangelog(md) {
  const lines = md.split("\n");
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(HEADING);
    if (m) marks.push({ version: m[1], title: (m[2] ?? "").trim(), line: i });
  });

  // Everything BELOW `1.0.0 — first public release (as bearing)` predates the rename and carries
  // the old package's numbers — which is why a `1.2.0` sits under a `1.0.0`. Releasing those would
  // put a tag newer than every real one at the bottom of the history. Position decides, not the
  // number: this file is strictly newest-first.
  const firstPublic = marks.findIndex((m) => m.version === "1.0.0");

  return marks.map((m, idx) => ({
    version: m.version,
    title: m.title,
    body: lines
      .slice(m.line + 1, marks[idx + 1]?.line ?? lines.length)
      .join("\n")
      .trim(),
    preRename: firstPublic >= 0 && idx > firstPublic,
  }));
}

/** Every entry that is a real, cut release. */
export function releasableVersions(md) {
  return parseChangelog(md).filter(
    (e) => e.version !== "Unreleased" && !e.preRename && /^\d+\.\d+\.\d+$/.test(e.version),
  );
}

/**
 * Releases newer than `prevVersion`, newest first. Derived from POSITION in the file rather than by
 * comparing version numbers: the file is authoritative about its own order, and a semver compare
 * would confidently place the pre-rename `1.2.0` above everything.
 *
 * An unknown `prevVersion` yields nothing. That is deliberate — we cannot honestly say what changed
 * between a version this changelog has never heard of and now, and inventing a range is worse than
 * staying quiet (NS-20).
 * @param {string} md @param {string|undefined|null} prevVersion
 */
export function versionsSince(md, prevVersion) {
  if (!prevVersion) return [];
  const all = releasableVersions(md);
  const idx = all.findIndex((e) => e.version === prevVersion);
  if (idx <= 0) return []; // -1 = never heard of it; 0 = already on the newest
  return all.slice(0, idx);
}

/**
 * The packaged CHANGELOG.md, or null. Null is a normal outcome — a consumer running an older
 * tarball has no copy — and must never break an install, so every caller treats it as "say nothing"
 * rather than an error (NS-8).
 * @returns {string|null}
 */
export function readPackagedChangelog() {
  try {
    return fs.readFileSync(path.join(PKG_ROOT, "CHANGELOG.md"), "utf8");
  } catch {
    return null;
  }
}
