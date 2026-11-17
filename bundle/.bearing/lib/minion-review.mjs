#!/usr/bin/env node
/**
 * The mechanical half of reviewing an invasive minion's slice, before it touches your tree.
 *
 * An invasive minion works in isolation — its own git worktree on Claude Code, or a patch file on a
 * runtime without one — so nothing it writes reaches the main tree until the main agent accepts it.
 * Accepting is a judgment (does every hunk match a shape in the brief?) and stays with the main
 * agent (NS-24). What this does is everything that is NOT judgment, so the judgment is spent on the
 * diff rather than on bookkeeping:
 *
 *   - SCOPE: every file the slice touched is in the slice's list. A file outside it is the one
 *     failure a skim misses on a large diff, and it is always a reject.
 *   - APPLIES: the slice still applies to HEAD as it is now — including the slices already landed.
 *     Two minions that both touched one file used to be a silent lost update; here the second one
 *     simply does not apply, and says so.
 *   - EMPTY: a minion that reported WROTE but committed or saved nothing.
 *
 *   node .bearing/lib/minion-review.mjs <slice> --allow <path>... [--name <id>] [--land] [--no-diff]
 *
 * <slice> is a branch or commit (the minion committed in its worktree), a worktree DIRECTORY (it did
 * not commit — uncommitted and untracked files are included), or a .patch / .diff file.
 * --allow takes files or directory prefixes ending in "/". --land applies an accepted slice to the
 * working tree and index — never commits — and keeps the patch so `git apply -R` can take it back.
 *
 * Exit 0 = ready for your review (or landed). Exit 1 = rejected, empty, or not found.
 *
 * Deliberately NOT an npm script, for the same reason as verify-citations.mjs: npm scripts are
 * owned by the gitnexus module, and a minions-only install must be able to run this.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @param {string} cwd @param {string[]} args @param {string} [input] */
function git(cwd, args, input) {
  const r = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
}

/**
 * Turn a slice reference into a patch against the main tree's history.
 * @param {string} root main checkout
 * @param {string} slice
 * @returns {{ kind: string, patch: string } | { error: string }}
 */
export function slicePatch(root, slice) {
  const asPath = path.resolve(root, slice);
  if (/\.(patch|diff)$/.test(slice) && fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    return { kind: "patch", patch: fs.readFileSync(asPath, "utf8") };
  }
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory() && fs.existsSync(path.join(asPath, ".git"))) {
    // A worktree the minion did not commit in. Diff its WORKING TREE against where it branched from
    // the main history, so committed and uncommitted edits both count — and untracked new files,
    // which `git diff` alone skips, are marked intent-to-add first (in the minion's own index).
    const head = git(root, ["rev-parse", "HEAD"]);
    const wtHead = git(asPath, ["rev-parse", "HEAD"]);
    if (!head.ok || !wtHead.ok) return { error: `cannot read HEAD in ${slice}` };
    const base = git(root, ["merge-base", head.out.trim(), wtHead.out.trim()]);
    if (!base.ok) return { error: `${slice} shares no history with this checkout` };
    git(asPath, ["add", "--intent-to-add", "--all"]);
    const d = git(asPath, ["diff", "--binary", base.out.trim()]);
    return d.ok ? { kind: "worktree", patch: d.out } : { error: d.err };
  }
  const commit = git(root, ["rev-parse", "--verify", "--quiet", `${slice}^{commit}`]);
  if (!commit.ok) return { error: `no branch, commit, worktree or patch file named ${slice}` };
  const base = git(root, ["merge-base", "HEAD", commit.out.trim()]);
  if (!base.ok) return { error: `${slice} shares no history with HEAD` };
  const d = git(root, ["diff", "--binary", base.out.trim(), commit.out.trim()]);
  return d.ok ? { kind: "branch", patch: d.out } : { error: d.err };
}

/** Undo git's C-style quoting of a path ("a/caf\303\251.js" → a/café.js). @param {string} q */
function unquoteGitPath(q) {
  const bytes = [];
  for (let i = 1; i < q.length - 1; i++) {
    const c = q[i];
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const n = q[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(q.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push({ n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 }[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Repo-relative paths a unified diff touches (both sides of a rename).
 *
 * git QUOTES a path with special or non-ASCII characters — `diff --git "a/src/caf\303\251.js" "b/…"`
 * — and the unquoted-only pattern skipped those headers, so a quoted out-of-scope file never reached
 * the allowlist and `--land` applied it (fail closed is NS-8's rule for exactly this kind of gate).
 * Every header is now read, quoted or not, and `unparsed` counts any that still cannot be — the
 * caller rejects a slice with one rather than checking a partial list.
 * @param {string} patch @returns {string[] & { unparsed?: number }}
 */
export function patchFiles(patch) {
  const files = new Set();
  let unparsed = 0;
  const tok = String.raw`("(?:[^"\\]|\\.)*"|\S+)`;
  const header = new RegExp(`^diff --git ${tok} ${tok}$`);
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    // Unquoted names may contain spaces (git quotes only special characters), so a header with no
    // quote falls back to the lazy split it always used.
    const m = line.includes('"') ? line.match(header) : line.match(/^diff --git (a\/.+?) (b\/.+)$/);
    const sides = m ? [m[1], m[2]].map((t) => (t.startsWith('"') ? unquoteGitPath(t) : t)) : [];
    if (sides.length !== 2 || !sides[0].startsWith("a/") || !sides[1].startsWith("b/")) {
      unparsed++;
      continue;
    }
    files.add(sides[0].slice(2));
    files.add(sides[1].slice(2));
  }
  const out = [...files];
  out.unparsed = unparsed;
  return out;
}

/** @param {string} file @param {string[]} allow */
function allowed(file, allow) {
  return allow.some((a) => (a.endsWith("/") ? file.startsWith(a) : file === a));
}

/**
 * @param {string} root @param {string} slice @param {{ allow?: string[] }} [opts]
 * @returns {{ verdict: 'ready'|'reject'|'empty'|'missing', reasons: string[], files: string[],
 *   outOfScope: string[], applies: boolean|null, hunks: number, patch: string, kind?: string }}
 */
export function reviewSlice(root, slice, { allow = [] } = {}) {
  const got = slicePatch(root, slice);
  if ("error" in got) {
    return { verdict: "missing", reasons: [got.error], files: [], outOfScope: [], applies: null, hunks: 0, patch: "" };
  }
  const { patch, kind } = got;
  const files = patchFiles(patch);
  const hunks = (patch.match(/^@@ /gm) ?? []).length;
  if (!files.length && files.unparsed) {
    return {
      verdict: "reject", kind, files, outOfScope: [], applies: null, hunks, patch,
      reasons: [`${files.unparsed} file header(s) in the patch could not be read, so its scope cannot be checked`],
    };
  }
  if (!files.length) {
    return {
      verdict: "empty", kind, files, outOfScope: [], applies: null, hunks, patch,
      reasons: ["the slice changes nothing — the minion committed or saved no edit (a WROTE line with nothing behind it)"],
    };
  }
  const reasons = [];
  if (files.unparsed) {
    reasons.push(`${files.unparsed} file header(s) in the patch could not be read, so its scope cannot be checked`);
  }
  // No --allow means nothing is in scope. A review that cannot say what the slice was FOR cannot
  // say it stayed inside it, so it must not pass by default.
  const outOfScope = files.filter((f) => !allowed(f, allow));
  if (!allow.length) reasons.push("no --allow list given — the slice's scope is unknown, so nothing is in scope");
  else if (outOfScope.length) reasons.push(`touches files outside its slice: ${outOfScope.join(", ")}`);
  const check = git(root, ["apply", "--check", "--index", "-"], patch);
  if (!check.ok) reasons.push(`does not apply to HEAD as it is now: ${check.err.split("\n").slice(0, 3).join(" | ")}`);
  return {
    verdict: reasons.length ? "reject" : "ready",
    kind, files, outOfScope, applies: check.ok, hunks, patch, reasons,
  };
}

/**
 * Apply a slice that passed review to the working tree and index. Never commits — whether and how
 * to commit is the user's call — and keeps the patch so the slice can be taken back on its own.
 * @param {string} root @param {string} name @param {string} patch @returns {{ ok: boolean, saved?: string, err?: string }}
 */
export function landSlice(root, name, patch) {
  const r = git(root, ["apply", "--index", "-"], patch);
  if (!r.ok) return { ok: false, err: r.err };
  // `.bearing/.bearing-*` is gitignored and swept by uninstall, so the record never reaches a commit.
  const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "slice";
  const saved = path.join(".bearing", `.bearing-minion-${safe}.patch`);
  try {
    fs.mkdirSync(path.join(root, ".bearing"), { recursive: true });
    fs.writeFileSync(path.join(root, saved), patch);
  } catch {
    return { ok: true }; // landed; only the undo record is missing
  }
  return { ok: true, saved };
}

function parseArgs(argv) {
  const a = { slice: null, allow: [], name: null, land: false, diff: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--allow") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) a.allow.push(argv[++i]);
    } else if (v === "--name") a.name = argv[++i];
    else if (v === "--land") a.land = true;
    else if (v === "--no-diff") a.diff = false;
    else if (!a.slice) a.slice = v;
  }
  return a;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.slice) {
    console.error("usage: node .bearing/lib/minion-review.mjs <branch|worktree-dir|file.patch> --allow <path>... [--land]");
    process.exit(1);
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out.trim() || process.cwd();
  const r = reviewSlice(root, a.slice, { allow: a.allow });
  const name = a.name ?? path.basename(a.slice).replace(/\.(patch|diff)$/, "");
  console.log(`slice    ${a.slice}${r.kind ? ` (${r.kind})` : ""}`);
  console.log(`files    ${r.files.length}${r.files.length ? ` — ${r.files.join(", ")}` : ""}`);
  if (r.applies !== null) console.log(`applies  ${r.applies ? "cleanly onto HEAD" : "NO"} · ${r.hunks} hunk(s)`);
  for (const why of r.reasons) console.log(`  ✗ ${why}`);
  if (r.verdict === "ready") {
    if (a.diff) console.log(`\n${r.patch}`);
    if (a.land) {
      const l = landSlice(root, name, r.patch);
      if (!l.ok) {
        console.log(`\nLAND FAILED — ${l.err}`);
        process.exit(1);
      }
      console.log(`\nLANDED   ${name} — applied to the working tree and index, not committed.`);
      if (l.saved) console.log(`         take it back alone with: git apply -R --index ${l.saved}`);
    } else {
      console.log("VERDICT  ready for YOUR review: check every hunk against a shape in the brief, then --land it or reject it.");
    }
    process.exit(0);
  }
  console.log(`VERDICT  ${r.verdict.toUpperCase()} — ${r.verdict === "reject" ? "do not land; fix the brief or the split and re-run this slice" : "nothing to review"}`);
  process.exit(1);
}
