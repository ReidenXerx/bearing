/**
 * Keep Prettier off the files bearing owns.
 *
 * A full install puts ~90 tracked, formattable files into a repo — `.bearing/lib/` alone is 31
 * `.mjs` modules — and every one of them is bearing's, replaced wholesale on the next update. A
 * repo that formats on commit therefore reformats all 90, `bearing update` overwrites them back,
 * and the churn repeats every cycle. Neither side is wrong; they simply both claim the file.
 *
 * Prettier 3 reads `.gitignore` as well as `.prettierignore`, so bearing's per-session runtime
 * state is already out of reach. What needs saying here is the TRACKED payload — the part
 * teammates receive through git, which is exactly the part Prettier can see.
 *
 * Scope is "what bearing wholly owns". `CLAUDE.md` and `AGENTS.md` are deliberately absent: bearing
 * owns a marked block inside them, not the file, and silently exempting a user's own prose from
 * their own formatter is not ours to do. The block there is rewritten on update anyway, so the
 * churn self-heals in one file rather than ninety.
 *
 * The list below is written by hand because a `.prettierignore` nobody can read is a worse artifact
 * than one that is slightly redundant. It is kept honest by a test that walks the bundle and fails
 * if a formattable file an install ships is matched by none of these patterns (GP-11).
 */
import fs from "node:fs";
import path from "node:path";
import { runtimeIds } from "./kit-shared.mjs";

export const PRETTIERIGNORE_PATH = ".prettierignore";
export const PRETTIERIGNORE_MARKER = "# bearing — files bearing owns and overwrites on update";
export const PRETTIERIGNORE_END = "# --- end bearing ---";

/**
 * Every surface that means "this repo runs Prettier", newest-first only in the sense that the
 * cheapest, most certain evidence is checked first.
 *
 * The `.prettierrc` family is matched by prefix rather than by an extension list: Prettier accepts
 * `.json`, `.json5`, `.yaml`, `.yml`, `.toml`, `.js`, `.cjs`, `.mjs` and no extension at all, and a
 * hand-listed set would quietly answer "no Prettier here" for whichever one it missed.
 */
function configFileEvidence(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  const hit = entries.find(
    (e) => e === ".prettierrc" || e.startsWith(".prettierrc.") || e.startsWith("prettier.config."),
  );
  return hit ?? null;
}

/**
 * Does this repo run Prettier, and what says so?
 *
 * Returns the EVIDENCE, not just a boolean: the prompt quotes it back, and a user who is about to
 * let an installer edit a config file deserves to know what it thinks it saw (GP-1).
 *
 * `.prettierignore` alone counts. A repo can configure Prettier entirely through editor settings or
 * a shared config package, and the one file it still keeps locally is the ignore list.
 *
 * @param {string} root
 * @returns {{ found: boolean, why: string|null }}
 */
export function detectPrettier(root) {
  const cfg = configFileEvidence(root);
  if (cfg) return { found: true, why: cfg };

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.prettier !== undefined) return { found: true, why: 'package.json: "prettier" key' };
    for (const field of ["devDependencies", "dependencies", "peerDependencies"]) {
      if (pkg[field]?.prettier) return { found: true, why: `package.json: ${field}.prettier` };
    }
  } catch {
    /* no package.json, or not JSON — neither is evidence either way */
  }

  if (fs.existsSync(path.join(root, PRETTIERIGNORE_PATH))) {
    return { found: true, why: PRETTIERIGNORE_PATH };
  }
  return { found: false, why: null };
}

/** Always ours, whatever was selected. */
const OWNED_CORE = [
  // The skill farms are NOT gated on the runtime that owns them, because bearing does not gate
  // writing them either: setup and `bearing:refresh` create .claude/skills/generated/ and
  // .claude/skills/gitnexus/ on a ZED-ONLY install. Observed, not assumed — a wizard install with
  // --runtime zed left nine Claude skill files that no .claude/ pattern had been emitted for.
  ".agents/skills/",
  ".claude/skills/",
  // The kit payload: hook lib, policy config, the skill store, the rule files. Per-session state
  // inside it is gitignored and therefore already invisible to Prettier 3.
  ".bearing/",
  // Written wholesale by the installer (an existing one is backed up first), so a formatter and an
  // installer would take turns rewriting it forever.
  ".vscode/settings.json",
];

/** @type {Record<string, string[]>} */
const OWNED_BY_RUNTIME = {
  claude: [".claude/hooks/", ".claude/settings.json"],
  // The zed twin of .claude/settings.json: written by the adapter (lib/adapters/zed.mjs), never
  // copied from the bundle — which is exactly why walking the bundle did not notice it was missing.
  zed: [".zed/settings.json"],
  codex: [],
};

/**
 * The graph module's plumbing. `scripts/` is the user's directory — bearing is a guest in it — so
 * every entry here is a file or subdirectory bearing actually writes, never the folder itself.
 */
const OWNED_BY_GITNEXUS = [
  // The graph index. It is in bearing's .gitignore too, and Prettier 3 reads .gitignore — but that
  // is another tool's default, and this is the largest thing bearing creates: a real repo's
  // parse-cache runs to hundreds of machine-generated JSON files. A block that only holds while
  // Prettier keeps a default is not a block; observed relying on it in a live install, where
  // --ignore-path .prettierignore exposed six of them immediately.
  ".gitnexus/",
  // Scratch dir the graph scripts write through, and the architecture doc regenerated on every
  // refresh. Both are bearing's, both are gitignored — and "gitignored" is not the same as
  // "covered", which is the whole point of the check below.
  ".tmp-agent/",
  "docs/*.gitnexus.md",
  ".githooks/pre-commit",
  ".github/workflows/bearing-index-cache.yml",
  ".github/workflows/gitnexus-ci.yml",
  ".gitnexusignore",
  "docs/GITNEXUS-*.md",
  "scripts/bearing-*",
  "scripts/bearing-teaching/",
  "scripts/clean-project-tmp.sh",
  "scripts/gitnexus-*",
  "scripts/install-git-hooks.sh",
  "scripts/lib/project-tmp.mjs",
  // Added after this list was written, and caught by the coverage test below rather than by anyone
  // remembering: it refuses with a diagnosis when .bearing/lib is missing, so it cannot live there.
  "scripts/lib/require-kit.mjs",
  "scripts/lib/setup-ui.mjs",
  "scripts/pack-bearing-teaching.sh",
  "scripts/run-with-project-tmp.sh",
  "scripts/sync-cursor-bearing-teaching.sh",
];

/**
 * The e2e harness. One prefix covers the whole module deliberately: the shipped substrate, the
 * verifiers the AGENT writes into `verify/` and `interact/` afterwards, and the run artifacts
 * (`shots/`, `node_modules/`, the session export). Naming only the files bearing copies would leave
 * everything the harness is designed to grow uncovered — and growing is the point of the module.
 */
const OWNED_BY_E2E = [".e2e/"];

/**
 * MCP server config: written by an adapter, but only when the graph module is installed — so it is
 * gated on BOTH axes. bearing merges its entry in and rewrites the whole file, so a formatter and an
 * installer take turns on it, even though the user may keep servers of their own there.
 * @type {Record<string, string[]>}
 */
const OWNED_BY_RUNTIME_GITNEXUS = {
  claude: [".mcp.json"],
};

/**
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {Set<string>|null} [features] null = every feature
 * @returns {string[]} ignore patterns, sorted, no duplicates
 */
export function prettierIgnoreLines(runtime, features = null) {
  const out = new Set(OWNED_CORE);
  for (const id of runtimeIds(runtime)) {
    for (const line of OWNED_BY_RUNTIME[id] ?? []) out.add(line);
  }
  if (!features || features.has("gitnexus")) {
    for (const line of OWNED_BY_GITNEXUS) out.add(line);
    for (const id of runtimeIds(runtime)) {
      for (const line of OWNED_BY_RUNTIME_GITNEXUS[id] ?? []) out.add(line);
    }
  }
  if (!features || features.has("e2e")) {
    for (const line of OWNED_BY_E2E) out.add(line);
  }
  return [...out].sort();
}

/** @param {import('./constants.mjs').Runtime} runtime @param {Set<string>|null} [features] */
export function buildPrettierIgnoreBlock(runtime, features = null) {
  return [
    PRETTIERIGNORE_MARKER,
    "# Removing a line here does not un-own the file — it just lets two tools fight over it.",
    ...prettierIgnoreLines(runtime, features),
    PRETTIERIGNORE_END,
  ].join("\n");
}

/**
 * Strip the managed block: the marker, its contiguous lines, and the terminating sentinel.
 *
 * Same shape as the .gitignore stripper, including the sentinel, and for the same reason: without
 * one the block is "marker plus every following non-blank line", so a rule the user appends later
 * gets absorbed and silently deleted by the next update.
 * @param {string} text
 */
export function stripManagedPrettierBlock(text) {
  if (!text.includes(PRETTIERIGNORE_MARKER)) return text;
  const lines = text.split("\n");
  let start = lines.findIndex((l) => l.includes(PRETTIERIGNORE_MARKER));
  if (start === -1) return text;
  let end = start;
  while (end < lines.length) {
    const isSentinel = lines[end].trim() === PRETTIERIGNORE_END;
    end++;
    if (isSentinel) break;
    if (lines[end - 1].trim() === "" && end - 1 > start) break; // defensive: unterminated block
  }
  if (start > 0 && lines[start - 1].trim() === "") start--;
  if (end < lines.length && lines[end].trim() === "") end++;
  lines.splice(start, end - start);
  return lines.join("\n");
}

/**
 * Write (or refresh) the managed block. Returns the patterns written.
 * @param {string} targetRoot
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {Set<string>|null} [features]
 */
export function appendPrettierIgnore(targetRoot, runtime, features = null) {
  const p = path.join(targetRoot, PRETTIERIGNORE_PATH);
  const existing = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const block = buildPrettierIgnoreBlock(runtime, features);
  const base = stripManagedPrettierBlock(existing).replace(/\n+$/, "");
  fs.writeFileSync(p, base ? `${base}\n\n${block}\n` : `${block}\n`);
  return prettierIgnoreLines(runtime, features);
}

/**
 * @param {string} targetRoot
 * @param {boolean} [weCreatedIt] manifest-recorded: the repo had no .prettierignore before us
 */
export function removePrettierIgnore(targetRoot, weCreatedIt = false) {
  const p = path.join(targetRoot, PRETTIERIGNORE_PATH);
  if (!fs.existsSync(p)) return;
  const stripped = stripManagedPrettierBlock(fs.readFileSync(p, "utf8"));
  // Only the manifest may authorise deleting the file. An empty .prettierignore the USER committed
  // is still theirs, and emptiness alone cannot tell the two apart (NS-1).
  if (weCreatedIt && !stripped.trim()) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
    return;
  }
  fs.writeFileSync(p, stripped.replace(/\n*$/, "\n"));
}
