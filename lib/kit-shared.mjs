import path from "node:path";
import { featureOf } from "./features.mjs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(__dirname, "..");
export const BUNDLE_ROOT = path.join(KIT_ROOT, "bundle");
export const PLACEHOLDER = "__GITNEXUS_REPO__";

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
