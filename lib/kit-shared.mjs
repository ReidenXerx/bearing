import path from "node:path";
import { featureOf } from "./features.mjs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(__dirname, "..");
export const BUNDLE_ROOT = path.join(KIT_ROOT, "bundle");
export const PLACEHOLDER = "__GITNEXUS_REPO__";
/** Domain persona, resolved per repo at install (see lib/domain.mjs). */
export const PERSONA_PLACEHOLDER = "__BEARING_PERSONA__";
/**
 * Follow-up paragraph, present ONLY when no domain could be resolved.
 *
 * A missing persona is the one gap the installer cannot close by itself — it needs a human who
 * knows what the project is. A single warn line at install time is read once and forgotten, so the
 * ask lives in the always-on contract instead: the agent sees it every session and can raise it
 * with the user at a moment when the answer is obvious.
 */
export const PERSONA_NOTE_PLACEHOLDER = "__BEARING_PERSONA_NOTE__";

const TEXT_EXTENSIONS = new Set([
  ".mdc",
  ".sh",
  ".mjs",
  ".js",
  ".md",
  ".json",
  ".txt",
  ".yml",
  ".yaml",
  ".gitnexusignore",
]);

/** @param {string} filePath */
export function isTextCandidate(filePath) {
  const base = path.basename(filePath);
  if (
    base === ".gitnexusignore" ||
    base === "hooks.json" ||
    base === "settings.json"
  )
    return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath));
}

/**
 * @param {string} content
 * @param {string} repoName
 */
export function substituteRepoName(content, repoName) {
  return content.split(PLACEHOLDER).join(repoName);
}

/**
 * Resolve every placeholder in a bundle file.
 *
 * The persona defaults rather than being required: an unresolved `__BEARING_PERSONA__` reaching a
 * user's CLAUDE.md would be a visible defect in the one file every agent reads first, and a
 * caller that forgets to pass it should degrade to a plain sentence, not leak template syntax.
 * A post-install check asserts that neither this nor __GITNEXUS_REPO__ survives in CLAUDE.md,
 * AGENTS.md or the Cursor rule (see checkPersonaResolved in lib/postcheck.mjs).
 *
 * @param {string} content
 * @param {{ repoName: string, persona?: string }} vars
 */
export function substitutePlaceholders(content, { repoName, persona, personaNote = "" }) {
  return substituteRepoName(content, repoName)
    .split(PERSONA_PLACEHOLDER)
    .join(persona || "senior software engineer experienced in this project's stack")
    .split(PERSONA_NOTE_PLACEHOLDER)
    .join(personaNote);
}

/**
 * The contract paragraph for a repo whose domain could not be resolved.
 *
 * Phrased as a job for the agent, not a notice to skim. It has the context to answer — it is
 * reading the code — and the user is right there to confirm. `suggested` is included when
 * inference leaned somewhere without enough evidence to adopt it, so the ask can be a yes/no
 * rather than an open question.
 * @param {string|null} [suggested]
 */
export function personaNoteFor(suggested) {
  return (
    `\n> **No domain is pinned for this project, so the persona above is a generic fallback.** ` +
    `bearing could not tell what this project *is* from its \`package.json\` description, README or ` +
    `\`CLAUDE.md\` — those say nothing domain-specific, which is common and not a fault.\n` +
    `>\n` +
    `> **You are reading the code, so you can probably tell.** Early in this session, say what ` +
    `domain you think this is and what expertise it calls for, and offer to write it to ` +
    `\`.bearing/domain.json\`. Ask once, accept a no, and do not raise it again in the same session.` +
    (suggested
      ? ` Weak signals pointed at **${suggested}** — offer that as the starting guess.`
      : "") +
    `\n>\n` +
    `> Until it is pinned, judge changes as a careful generalist and say so when a call clearly ` +
    `needs domain knowledge you have not been given.\n`
  );
}

/** Paths never copied verbatim — handled by dedicated installers. */
const BUNDLE_SKIP_PREFIXES = ["skills/", ".claude/skills/"];

/**
 * Runtime aliases. A runtime string is a comma-list of adapter ids and/or these
 * aliases; `runtimeIds` expands it to a Set of concrete adapter ids. Keeping this
 * in the (dependency-free) shared module lets both the copy filter and the adapter
 * registry agree on membership without an import cycle.
 */
const RUNTIME_ALIASES = {
  both: ["cursor", "zed"],
  all: ["cursor", "zed", "claude", "codex"],
};

/** @param {string} runtime @returns {Set<string>} */
export function runtimeIds(runtime) {
  const ids = new Set();
  for (const tok of String(runtime || "")
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)) {
    for (const id of RUNTIME_ALIASES[tok] ?? [tok]) ids.add(id);
  }
  return ids;
}

/** @param {string} rel */
export function isBundleSkipped(rel) {
  return BUNDLE_SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

/**
 * Bundle files written only when absent, because the user is expected to edit them.
 * hooks.json's own header says "Optional hook tuning, TEAM-SHARED (committed)" — re-copying it on
 * every update reverted their settings (e.g. mode: guide -> enforce) without a word.
 *
 * Skipping the copy must not be confused with disowning the file: the installer still records it
 * in the manifest when a previous install created it, or uninstall would leave it behind.
 */
export const SEED_ONCE_FILES = new Set([".bearing/hooks.json"]);

/**
 * @param {string} rel
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {Set<string>|null} features enabled feature ids; null/omitted = all (back-compat)
 */
export function shouldCopyBundleFile(rel, runtime, features = null, targetHas = null) {
  if (isBundleSkipped(rel)) return false;
  if (rel.startsWith("templates/")) return false;
  // Shared helper modules + policy config ship for every runtime — zed/claude
  // CLIs and hook glue import health/brief/classify utilities from .bearing/lib.
  if (rel.startsWith(".bearing/lib/")) {
    const libOwner = featureOf(rel);
    return !features || !libOwner || features.has(libOwner);
  }
  if (SEED_ONCE_FILES.has(rel)) return !targetHas?.(rel);
  const ids = runtimeIds(runtime);
  if (rel.startsWith(".cursor/")) {
    if (!ids.has("cursor")) return false;
  } else if (rel.startsWith(".claude/")) {
    if (!ids.has("claude")) return false;
  }
  // FEATURE axis: a file owned by a disabled feature never ships. Core files (featureOf -> null)
  // always do. This is what keeps e.g. the GitNexus gates out of a repo that has no graph, where
  // they would otherwise DENY Grep and point at a command that does not exist.
  if (features) {
    const owner = featureOf(rel);
    if (owner && !features.has(owner)) return false;
  }
  return true;
}
