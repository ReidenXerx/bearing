/**
 * Refuse to run with a DIAGNOSIS rather than a stack trace when the kit is half-there.
 *
 * Every entry point under `scripts/` reaches into `.bearing/lib` on its first line. With that
 * directory missing, all of them died on an unhandled ERR_MODULE_NOT_FOUND — including `doctor`,
 * `health` and `verify`, which are precisely the commands someone runs BECAUSE the install looks
 * wrong, and `bearing-ci.mjs`, where it becomes a failed build that explains nothing.
 *
 * This lives in `scripts/lib/` and not `.bearing/lib/` deliberately: a check for a missing
 * directory cannot be imported from the directory that is missing.
 *
 * Fails LOUD, unlike the hooks. A hook that cannot compute a verdict must stay silent and let the
 * call through (NS-5) — a command the user typed asked a question, and the answer has to name the
 * problem and the fix (NS-6).
 */
import fs from "node:fs";
import path from "node:path";

/** Files every entry point needs. Missing one means the rest is not worth attempting. */
const ESSENTIAL = [".bearing/lib/gitnexus-cmd.mjs", ".bearing/lib/session-primer.mjs"];

/**
 * @param {string} root repo root
 * @param {{exit?: boolean}} [opts] exit:false returns the message instead of exiting (for tests)
 * @returns {string|null} the diagnosis when incomplete, null when fine
 */
export function assertKitInstalled(root, opts = {}) {
  const missing = ESSENTIAL.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (!missing.length) return null;

  const msg =
    `\n✗ This bearing install is incomplete — ${missing.join(", ")} ` +
    `${missing.length > 1 ? "are" : "is"} missing.\n\n` +
    "  Nothing here can run without it: the agent commands, hooks and guards all read from\n" +
    "  .bearing/lib. This usually means a partial uninstall, an update that stopped part-way,\n" +
    "  or a `git clean` in a repo where bearing is deliberately untracked (stealth).\n\n" +
    `  Repair it:  npx bearing update ${root}\n`;

  if (opts.exit === false) return msg;
  console.error(msg);
  process.exit(1);
}
