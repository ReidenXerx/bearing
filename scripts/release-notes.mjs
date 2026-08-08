#!/usr/bin/env node
/**
 * Cut release notes out of CHANGELOG.md, and resolve the commit each version was released at.
 *
 * The changelog is written for humans and is already the best description of every release; a
 * GitHub release should be that text, not a second summary that drifts from it. So this reads —
 * never writes — and prints what `gh release create` should be handed.
 *
 * It deliberately does NOT publish. Creating a release is outward-facing and irreversible enough
 * that it stays a separate, deliberate step.
 *
 *   node scripts/release-notes.mjs --list        every version, with the commit it shipped at
 *   node scripts/release-notes.mjs 1.0.7         the notes for one version, ready to pipe to gh
 *   node scripts/release-notes.mjs --title 1.0.7 just the release title
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

/** `## 1.0.7 — title` or `## Unreleased`. The em-dash separator is the file's own convention. */
const HEADING = /^## +(\S+)(?: +[—-] +(.*))?$/;

/**
 * @param {string} md
 * @returns {{version: string, title: string, body: string, preRename: boolean}[]}
 *   In file order, i.e. newest first.
 */
export function parseChangelog(md) {
  const lines = md.split("\n");
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(HEADING);
    if (m) marks.push({ version: m[1], title: (m[2] ?? "").trim(), line: i });
  });

  // Everything BELOW `1.0.0 — first public release (as bearing)` predates the rename and carries
  // the old package's version numbers — which is why a `1.2.0` sits under a `1.0.0`. Releasing
  // those as `v1.2.0` would put a tag newer than every real one at the bottom of the history.
  // Position in the file decides it, not the number: this file is strictly newest-first.
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

/** Every version worth publishing as a GitHub release. */
export function releasableVersions(md) {
  return parseChangelog(md).filter(
    (e) => e.version !== "Unreleased" && !e.preRename && /^\d+\.\d+\.\d+$/.test(e.version),
  );
}

/**
 * The commit where package.json first declared this version — the honest tag target. Matching on
 * commit MESSAGE looks equivalent and is not: `--grep '^1.0.4'` anchors to any line of the message,
 * so a later commit whose BODY mentions 1.0.4 wins and the tag lands on the wrong code.
 * @param {string} version @returns {string|null} full sha
 */
export function commitForVersion(version) {
  let shas;
  try {
    // Oldest first: the first commit that declares the version is the one that released it.
    shas = execFileSync("git", ["log", "--reverse", "--format=%H", "--", "package.json"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
  for (const sha of shas) {
    try {
      const pkg = JSON.parse(execFileSync("git", ["show", `${sha}:package.json`], {
        cwd: ROOT,
        encoding: "utf8",
      }));
      if (pkg.version === version) return sha;
    } catch {
      /* unparseable or absent at that commit */
    }
  }
  return null;
}

function main(argv) {
  const md = fs.readFileSync(CHANGELOG, "utf8");
  const [flag, arg] = argv;

  if (flag === "--list") {
    for (const e of releasableVersions(md)) {
      const sha = commitForVersion(e.version);
      const words = e.body.split(/\s+/).filter(Boolean).length;
      console.log(
        `v${e.version.padEnd(7)} ${(sha ?? "NO COMMIT").slice(0, 9)}  ${String(words).padStart(5)} words  ${e.title}`,
      );
    }
    const skipped = parseChangelog(md).filter((e) => e.preRename || e.version === "Unreleased");
    if (skipped.length) {
      console.log(`\nnot releasable: ${skipped.map((e) => e.version).join(", ")}`);
      console.log("  Unreleased = not cut yet; the rest predate the rename to bearing.");
    }
    return;
  }

  const version = (flag === "--title" ? arg : flag)?.replace(/^v/, "");
  const entry = releasableVersions(md).find((e) => e.version === version);
  if (!entry) {
    console.error(
      `No releasable changelog section for "${version ?? "(none given)"}".\n` +
        `Try: node scripts/release-notes.mjs --list`,
    );
    process.exitCode = 1;
    return;
  }
  if (flag === "--title") {
    console.log(entry.title ? `${entry.version} — ${entry.title}` : entry.version);
    return;
  }
  console.log(entry.body);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main(process.argv.slice(2));
}
