/**
 * May a `<file>.bearing-backup` be put back as the user's original?
 *
 * Install stashes a file it is about to overwrite as `<file>.bearing-backup`, and the retirement sweep
 * and uninstall put that backup back when they remove bearing's file. That is right for a file the
 * user owned (.githooks/pre-commit, .vscode/settings.json). It is wrong when the backup is an older
 * copy of BEARING'S OWN file — which is what an update makes in a clone whose manifest is not
 * committed, because without a manifest every file bearing wrote looks like the user's.
 *
 * Measured on a real repo at the 2.0.0 rollout: such backups, made by an update months earlier, were
 * "restored as your original" by the sweep that retires the graph gates — 19 retired files put back,
 * the gate hooks, a pre-commit hook and two workflows among them. 48 more such backups were waiting
 * beside files bearing still ships.
 *
 * The verdict, in the order it is decided — and never at the cost of a real original (NS-1):
 * - "discard": the path is one only bearing ships — its code, named for it. No user wrote
 *   `.claude/hooks/bearing-grep-guard.mjs` before installing bearing, so the backup is ours: delete it.
 * - "keep": any other path whose backup READS like bearing's. Probably ours, but a user's own file
 *   could mention it too — so do not put it back, do not delete it either: leave it and say so.
 * - "restore": a genuine original. Put it back, as before.
 */
import fs from "node:fs";
import path from "node:path";

/** bearing's own script helpers that live at generic-looking paths. */
const BEARING_HELPERS = new Set([
  "scripts/lib/require-kit.mjs",
  "scripts/lib/project-tmp.mjs",
  "scripts/lib/setup-ui.mjs",
  "scripts/run-with-project-tmp.sh",
  "scripts/clean-project-tmp.sh",
]);

/**
 * A path only bearing ever ships — its CODE. Deliberately not "anything under .bearing/": the
 * north-stars and the gold practices live there and hold the project's own NS-# and PP-# rules, and
 * a gold-practices backup is exactly where declined PP-# rules are set aside.
 * @param {string} rel repo-relative path
 */
export function isBearingOnlyPath(rel) {
  const p = rel.replace(/\\/g, "/");
  const base = path.posix.basename(p);
  if (p.startsWith(".bearing/lib/") || p.startsWith(".gnkit/lib/")) return true;
  if (/^(bearing|gitnexus|gn-kit)[-_.]/i.test(base) && !/\.md$/i.test(base)) return true;
  if (p.startsWith("scripts/bearing-teaching/")) return true;
  if (/(^|\/)skills\/(bearing|gitnexus)-/.test(p)) return true;
  return BEARING_HELPERS.has(p);
}

const BEARING_MARK = /\bbearing\b|gitnexus|gn-kit|\.gnkit\b/i;

/**
 * @param {string} rel repo-relative path of the file the backup sits beside
 * @param {string} bakAbs absolute path of the `.bearing-backup`
 * @returns {"discard" | "keep" | "restore"}
 */
export function backupVerdict(rel, bakAbs) {
  if (isBearingOnlyPath(rel)) return "discard";
  let head = "";
  try {
    head = fs.readFileSync(bakAbs, "utf8").slice(0, 65536);
  } catch {
    return "keep"; // unreadable: neither restore nor delete what we cannot judge
  }
  return BEARING_MARK.test(head) ? "keep" : "restore";
}
