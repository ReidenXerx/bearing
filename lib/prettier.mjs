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
  // The kit payload: hook lib, policy config, the skill store, the rule files. Per-session state
  // inside it is gitignored and therefore already invisible to Prettier 3.
  ".bearing/",
  // Written wholesale by the installer (an existing one is backed up first), so a formatter and an
  // installer would take turns rewriting it forever.
  ".vscode/settings.json",
];

/** @type {Record<string, string[]>} */
const OWNED_BY_RUNTIME = {
  claude: [".claude/hooks/", ".claude/settings.json", ".claude/skills/"],
  // .cursor/rules/ holds the USER's rules too, so the three bearing writes are named rather than
  // the directory taken wholesale.
  cursor: [
    ".cursor/hooks/",
    ".cursor/hooks.json",
    ".cursor/rules/00-bearing-enforcement.mdc",
    ".cursor/rules/bearing-first.mdc",
    ".cursor/rules/bearing.mdc",
    ".cursor/skills/",
  ],
  zed: [".agents/skills/"],
  codex: [],
};

/**
 * The graph module's plumbing. `scripts/` is the user's directory — bearing is a guest in it — so
 * every entry here is a file or subdirectory bearing actually writes, never the folder itself.
 */
const OWNED_BY_GITNEXUS = [
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
  "scripts/lib/setup-ui.mjs",
  "scripts/pack-bearing-teaching.sh",
  "scripts/run-with-project-tmp.sh",
  "scripts/sync-cursor-bearing-teaching.sh",
];

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
