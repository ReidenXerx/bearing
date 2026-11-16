#!/usr/bin/env node
/**
 * Every version of every `.e2e/` file bearing has ever shipped, as sha256 hashes → lib/e2e-known-hashes.json.
 *
 * The e2e harness is "a harness you finish yourself": projects edit its core and tools, and five real
 * installs were found holding 21 such edits that `bearing update` would have overwritten (NS-1). An
 * edit is any content that matches NO version bearing ever wrote — which only the git history can
 * answer, so it is computed here, at release time, and shipped with the package. `.e2e/` files are
 * copied verbatim (no placeholders), so a hash of the committed content is the hash of what an
 * install wrote. A test fails when a current bundle file's hash is missing: re-run this.
 *
 *   node scripts/gen-e2e-hashes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "buffer", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const out = {};
const add = (rel, buf) => {
  out[rel] ??= new Set();
  out[rel].add(sha(buf));
};
const paths = new Set(git("log", "--all", "--format=", "--name-only", "--", "bundle/.e2e").toString().split("\n").filter(Boolean));
for (const p of paths) {
  const rel = p.slice("bundle/".length);
  for (const c of git("log", "--all", "--format=%H", "--", p).toString().split("\n").filter(Boolean)) {
    try {
      add(rel, git("show", `${c}:${p}`));
    } catch {
      /* the path does not exist at that commit (a delete or a rename) */
    }
  }
}
// The working tree too, so an uncommitted edit to the kit is not mistaken for a user's.
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else add(path.relative(path.join(ROOT, "bundle"), abs), fs.readFileSync(abs));
  }
};
walk(path.join(ROOT, "bundle/.e2e"));

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, [...out[k]].sort()]));
fs.writeFileSync(path.join(ROOT, "lib/e2e-known-hashes.json"), JSON.stringify(sorted, null, 1) + "\n");
console.log(`${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((n, v) => n + v.length, 0)} known versions → lib/e2e-known-hashes.json`);
