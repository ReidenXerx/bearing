/**
 * Is this `.e2e/` file the project's own edit, or a version bearing shipped?
 *
 * The harness is finished by the project: `session.js` by design, and in practice core and tools too
 * — five real installs held 21 edits (one rewrote 411 lines of `core/http.js`). Update overwrote and
 * uninstall deleted every one of them, because "previously ours" was the only test (NS-1). A file is
 * the project's when its content matches no version bearing ever published (lib/e2e-known-hashes.json,
 * built from git history by scripts/gen-e2e-hashes.mjs). Unknown → treat as theirs: a kept stale file
 * costs a `.bearing-new` beside it; an overwritten edit is gone.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

let KNOWN = null;
function known() {
  if (KNOWN) return KNOWN;
  try {
    // The override exists for the test suite, which needs an "older bearing version" it can write.
    const file = process.env.BEARING_E2E_KNOWN_HASHES ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "e2e-known-hashes.json");
    KNOWN = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    KNOWN = {};
  }
  return KNOWN;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * @param {string} absTarget
 * @param {string} rel a path like `.e2e/core/http.js`
 * @returns {boolean} true when the file exists and is not any version bearing shipped
 */
export function e2eEditedByUser(absTarget, rel) {
  if (!rel.startsWith(".e2e/")) return false;
  const abs = path.join(absTarget, rel);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return false;
  }
  return !(known()[rel] ?? []).includes(sha256(buf));
}
