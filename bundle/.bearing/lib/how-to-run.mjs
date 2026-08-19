/**
 * Name a command the reader can actually run, here, in this repo.
 *
 * Every deny message, block and hint used to hardcode `npm run bearing:…`. A STEALTH install adds no
 * npm scripts at all — modifying `package.json` is precisely what that mode exists to avoid — so in
 * those repos every exit bearing named was a command that did not exist. Observed in the wild: a
 * stale-index block told the agent to run `npm run bearing:agent-refresh`, the agent noticed the
 * script was missing and had to work out the real invocation itself. That is NS-6 failing at exactly
 * the moment it matters, since the block is what stops the work.
 *
 * The mapping cannot be derived by trimming the name — `bearing:agent-refresh` runs the `refresh`
 * subcommand, `bearing:health` runs `health` — so it is written at install time from the same
 * definitions that produce the npm scripts, and read back from `.bearing/commands.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This module lives at `<root>/.bearing/lib/`, so the repo root is two levels up. Defaulting to it
 * means call sites deep in the classifier — which build deny messages and never had a `root` in
 * scope — can resolve a command without threading a parameter through every signature.
 */
const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {Map<string, Record<string,string>|null>} */
const cache = new Map();

function commandTable(root) {
  if (cache.has(root)) return cache.get(root);
  let table = null;
  try {
    table = JSON.parse(fs.readFileSync(path.join(root, ".bearing/commands.json"), "utf8"));
  } catch {
    /* older install, or the table was never written */
  }
  cache.set(root, table);
  return table;
}

/**
 * @param {string} [root] repo root; defaults to the repo this module was installed into
 * @param {string} name npm script name, e.g. "bearing:agent-refresh"
 * @returns {string} something the reader can paste
 */
export function howToRun(root, name) {
  if (name === undefined) {
    name = /** @type {string} */ (root);
    root = OWN_ROOT;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.scripts?.[name]) return `npm run ${name}`;
  } catch {
    /* no package.json — a stealth install in a non-node repo still has the scripts on disk */
  }

  const direct = commandTable(root)?.[name];
  if (direct) {
    // Only name it if it is really there: pointing at a missing file is the same failure in a new
    // costume. The first token after `node`/`bash` is the script path.
    const file = direct.match(/(?:node|bash)\s+(\S+)/)?.[1];
    if (!file || fs.existsSync(path.join(root, file))) return direct;
  }

  // Nothing installed can do it. Say so rather than name a command that will fail.
  return `${name} (not installed in this repo)`;
}

/**
 * What a refresh actually cost here, last time, as a short phrase for a message.
 *
 * Every hint shipped the same words — "incremental — usually quick" — whatever the repo. Measured on
 * two real ones: 52s and 573s. Same wording, an order of magnitude apart, so the reader learned
 * nothing and had to guess whether to interrupt themselves. A number they can act on beats an
 * adjective they cannot.
 *
 * Empty string when nothing has been measured yet, so callers can concatenate it unconditionally
 * rather than each inventing a fallback adjective.
 * @param {string} [root] @param {string} [tier] which tier to quote; defaults to the cheap one
 * @returns {string} e.g. " (~52s here last time)" or ""
 */
export function refreshCost(root, tier = "incremental") {
  const dir = root || OWN_ROOT;
  try {
    const all = JSON.parse(
      fs.readFileSync(path.join(dir, ".bearing", ".gitnexus-refresh-cost.json"), "utf8"),
    );
    const hit = all[tier] || all.incremental || all.full;
    const s = Number(hit?.seconds);
    if (!(s > 0)) return "";
    return s < 90 ? ` (~${s}s here last time)` : ` (~${Math.round(s / 60)} min here last time)`;
  } catch {
    return ""; // never measured — say nothing rather than guess
  }
}
