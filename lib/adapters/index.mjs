/**
 * Adapter registry — the single place that knows which IDE adapters exist.
 *
 * The install/uninstall core (lib/kit.mjs) is vendor-agnostic: it resolves the
 * active adapters for a runtime and drives them through the Adapter contract
 * (see ./contract.mjs). Adding an IDE = add a module + one line here.
 */
import { runtimeIds } from "../kit-shared.mjs";
import { zedAdapter } from "./zed.mjs";
import { claudeAdapter } from "./claude.mjs";
import { codexAdapter } from "./codex.mjs";

/** @type {import('./contract.mjs').Adapter[]} */
export const ADAPTERS = [zedAdapter, claudeAdapter, codexAdapter];

/** @param {import('../constants.mjs').Runtime} runtime */
export function activeAdapters(runtime) {
  const ids = runtimeIds(runtime);
  return ADAPTERS.filter((a) => ids.has(a.id));
}

/**
 * Skill-store symlink targets for the active runtime (e.g. .agents/skills).
 * @param {import('../constants.mjs').Runtime} runtime
 */
export function skillLinkDirs(runtime) {
  return activeAdapters(runtime)
    .map((a) => a.skillLinkDir)
    .filter(Boolean);
}
