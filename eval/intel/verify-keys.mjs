/**
 * Re-derive the list answer keys from the fixture's TEXT alone — a second route that must agree with
 * the construction in fixture.mjs. If the generator ever writes a shape it did not mean to, the two
 * disagree and the harness test fails before any score is built on a wrong key (NS-27).
 */
import fs from "node:fs";
import path from "node:path";

/** Strip line comments and string/template literals, so a mention is not a call. */
function codeOnly(src) {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** @param {string} dir */
export function deriveFromText(dir) {
  const svcDir = path.join(dir, "src/services");
  const callers = [];
  for (const f of fs.readdirSync(svcDir).sort()) {
    const src = fs.readFileSync(path.join(svcDir, f), "utf8");
    // Only imports of OUR postEntry: the ledger module itself or its barrel — never ../legacy/.
    const fromLedger = /from "\.\.\/ledger\/(post|index)\.ts"/;
    const callees = [];
    for (const line of src.split("\n")) {
      if (!fromLedger.test(line) || /^import type/.test(line)) continue;
      const named = line.match(/import \{([^}]*)\}/);
      if (named) {
        for (const part of named[1].split(",")) {
          const m = part.trim().match(/^postEntry(?:\s+as\s+(\w+))?$/);
          if (m) callees.push(`${m[1] ?? "postEntry"}(`);
        }
      }
      const ns = line.match(/import \* as (\w+)/);
      if (ns) callees.push(`${ns[1]}.postEntry(`);
    }
    const code = codeOnly(src);
    if (callees.some((c) => code.split("\n").some((l) => !/^import /.test(l) && l.includes(c)))) {
      callers.push(`src/services/${f}`);
    }
  }

  const audit = fs.readFileSync(path.join(dir, "src/audit.ts"), "utf8");
  const excluded = JSON.parse(audit.match(/EXCLUDED = (\[[^\]]*\])/)[1]);
  const toWrap = [];
  const wrapped = [];
  const hDir = path.join(dir, "src/handlers");
  for (const f of fs.readdirSync(hDir).sort()) {
    if (f === "types.ts") continue;
    const name = f.replace(/\.ts$/, "");
    if (excluded.includes(name)) continue;
    const src = fs.readFileSync(path.join(hDir, f), "utf8");
    (/withAudit\(/.test(src) ? wrapped : toWrap).push(name);
  }
  return {
    postEntryCallers: callers.sort(),
    handlersToWrap: toWrap.sort(),
    handlersAlreadyWrapped: wrapped.sort(),
    handlersExcluded: [...excluded].sort(),
  };
}
