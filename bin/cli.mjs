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
 * The verb can come from argv (`bearing install …`) or from the binary's own name
 * (`bearing-update …`), so the historical verb-specific commands keep working unchanged.
 */
import path from "node:path";
import { cliMain } from "../lib/kit.mjs";

const argv = process.argv.slice(2);
const invokedAs = path.basename(process.argv[1] || "bearing").replace(/\.(mjs|js)$/, "");

// Verb-specific aliases (bearing-update, bearing-uninstall, …) inject their verb so the user does
// not repeat it. The generic binaries expect the verb as the first argument. The old gn-kit-* and
// gn-agent-kit-* names still match: the suffix test below is name-agnostic.
const VERB_SUFFIX = [
  ["-update-all", "update-all"],
  ["-update", "update"],
  ["-uninstall", "uninstall"],
  ["-install", "install"],
];
const implied = VERB_SUFFIX.find(([suffix]) => invokedAs.endsWith(suffix))?.[1];

// `bearing <path>` means install; keep that, but only when the first argument is clearly not
// already a verb (otherwise `bearing install …` would become `install install …`).
//
// A LEADING FLAG means install too. `bearing --stealth` is the whole reason the mode exists — you
// are standing in someone else's repo and want bearing only for yourself — and it used to print
// "Missing target repo path", because a `-` prefix suppressed the implied verb. Only the flags that
// are genuinely verb-less stay exempt; everything else is options to an install.
const VERBS = new Set(["install", "update", "update-all", "uninstall"]);
const VERBLESS_FLAGS = new Set(["--help", "-h", "--version", "-v"]);
const first = argv[0];
const needsImpliedInstall =
  !implied && (!first || (!VERBS.has(first) && !VERBLESS_FLAGS.has(first)));

const effective = implied
  ? [implied, ...argv]
  : needsImpliedInstall
    ? ["install", ...argv]
    : argv;

// cliMain is async (it may prompt for the runtime). An unhandled rejection here would print a bare
// stack after the install had already reported progress, so failures are surfaced deliberately.
cliMain(effective, invokedAs).catch((e) => {
  console.error(`\n✗ ${e?.message ?? e}`);
  if (process.env.BEARING_DEBUG) console.error(e?.stack ?? "");
  else console.error("  (BEARING_DEBUG=1 for the stack trace)");
  process.exitCode = 1;
});
