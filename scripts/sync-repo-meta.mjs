#!/usr/bin/env node
/**
 * Push package.json's description + keywords to the GitHub repo's About box.
 *
 * The product is described in three places: package.json (npm), README.md (GitHub page), and the
 * GitHub About blurb. A test keeps the first two honest against the code, but About lives on
 * GitHub's servers — no test can reach it, so it silently rots. This makes updating it one command
 * driven by the same source, instead of a thing to remember.
 *
 *   node scripts/sync-repo-meta.mjs          # show what would change
 *   node scripts/sync-repo-meta.mjs --write  # apply via gh
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const write = process.argv.includes("--write");

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

let current;
try {
  current = JSON.parse(gh(["repo", "view", "--json", "description,repositoryTopics"]));
} catch {
  console.error("gh CLI unavailable or not authenticated — run `gh auth login`.");
  process.exit(1);
}

const haveTopics = (current.repositoryTopics ?? []).map((t) => t.name).sort();
// GitHub topics: lowercase, hyphens, digits only.
const wantTopics = [...new Set(pkg.keywords.map((k) => k.toLowerCase().replace(/[^a-z0-9-]/g, "-")))].sort();

const descChanged = current.description !== pkg.description;
const topicsToAdd = wantTopics.filter((t) => !haveTopics.includes(t));

console.log(`description: ${descChanged ? "CHANGED" : "in sync"}`);
if (descChanged) {
  console.log(`  from: ${current.description ?? "(none)"}`);
  console.log(`  to:   ${pkg.description}`);
}
console.log(`topics: ${topicsToAdd.length ? `+${topicsToAdd.join(", +")}` : "in sync"}`);

if (!write) {
  if (descChanged || topicsToAdd.length) console.log("\nRe-run with --write to apply.");
  process.exit(0);
}
if (!descChanged && !topicsToAdd.length) process.exit(0);

const args = ["repo", "edit"];
if (descChanged) args.push("--description", pkg.description);
for (const t of topicsToAdd) args.push("--add-topic", t);
gh(args);
console.log("\n✓ GitHub About updated from package.json");
