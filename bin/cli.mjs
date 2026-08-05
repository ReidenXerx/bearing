#!/usr/bin/env node
/**
 * Single Node entry point for every published binary.
 *
 * Why Node rather than the bash wrappers: npm links `bin` entries as SYMLINKS into
 * `node_modules/.bin`, and bash's `dirname "$0"` resolves to the SYMLINK's directory — so the old
 * wrappers computed KIT_ROOT as `node_modules` and could not find `lib/`. Under `npx` they broke
 * outright. `import.meta.url` always resolves to the real module path, through any number of
 * symlinks. It also drops the bash dependency, so Windows works without WSL.
 *
 * The verb can come from argv (`gn-kit install …`) or from the binary's own name
 * (`gn-kit-update …`), so the historical verb-specific commands keep working unchanged.
 */
import path from "node:path";
import { cliMain } from "../lib/kit.mjs";

const argv = process.argv.slice(2);
const invokedAs = path.basename(process.argv[1] || "gn-kit").replace(/\.(mjs|js)$/, "");

// Verb-specific aliases (gn-kit-update, gn-agent-kit-uninstall, …) inject their verb so the user
// does not repeat it. The generic binaries expect the verb as the first argument.
const VERB_SUFFIX = [
  ["-update-all", "update-all"],
  ["-update", "update"],
  ["-uninstall", "uninstall"],
  ["-install", "install"],
];
const implied = VERB_SUFFIX.find(([suffix]) => invokedAs.endsWith(suffix))?.[1];

// `gn-agent-kit <path>` historically meant install; keep that, but only when the first argument is
// clearly not already a verb (otherwise `gn-kit install …` would become `install install …`).
const VERBS = new Set(["install", "update", "update-all", "uninstall"]);
const first = argv[0];
const needsImpliedInstall =
  !implied && (!first || (!VERBS.has(first) && !first.startsWith("-") ? true : false));

const effective = implied
  ? [implied, ...argv]
  : needsImpliedInstall
    ? ["install", ...argv]
    : argv;

cliMain(effective, invokedAs);
