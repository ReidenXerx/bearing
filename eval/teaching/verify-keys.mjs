#!/usr/bin/env node
/**
 * Re-derive every answer key from TEXT ALONE and require it to match the construction-derived key.
 *
 * Two independent routes to one answer (NS-27): `fixture.mjs` knows which page it built with which
 * flag; this script knows nothing about flags and reads the files the way a careful human with grep
 * would. If they disagree, the fixture is wrong, and every score built on it would be too. Neither
 * route touches the graph — the thing under test cannot write its own answer key.
 *
 *   node eval/teaching/verify-keys.mjs        → exit 0 when every key matches
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixture, keys } from "./fixture.mjs";

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/** @param {string} root @returns {Record<string, string[]>} */
export function deriveFromText(root) {
  const all = walk(root).filter((f) => /\.(tsx?|css|html)$/.test(f));
  const src = Object.fromEntries(all.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));
  const files = (pred) => all.filter((f) => pred(src[f], f)).sort();
  // A call that is not a method call (`x.rateFor(`) and not a definition (`rateFor(code: string) {`).
  const calls = (text, name) =>
    text.split("\n").some((l) => new RegExp(`(?<![.\\w])${name}\\(`).test(l) && !new RegExp(`^\\s*(export\\s+)?(async\\s+)?(function\\s+)?${name}\\(`).test(l));
  const rendersDataTable = (t) => {
    if (/<DataTable\b/.test(t)) return true;
    const alias = t.match(/DataTable as (\w+)/);
    return Boolean(alias && new RegExp(`<${alias[1]}\\b`).test(t));
  };
  return {
    rateForCallers: files((t) => calls(t, "rateFor") || calls(t, "quoteShipping")),
    dataTableRenderers: files((t) => rendersDataTable(t)),
    ledgerCellUsers: files((t) => /accountingHelpers\.formatLedgerCell/.test(t) || /\{\s*formatLedgerCell\s*\}\s*=\s*accountingHelpers/.test(t)),
    sessionRefreshCallers: files(
      (t) => /\.session\.refreshToken\(/.test(t) || (/\{\s*session\s*\}\s*=\s*useStores\(\)/.test(t) && /\bsession\.refreshToken\(/.test(t)),
    ),
    brandColorFiles: files((t) => /#3987e5/i.test(t)),
    ratesDependentPages: files((t, f) => f.startsWith("apps/") && ["rateFor", "quoteShipping", "cartTotal", "shippingFee"].some((n) => calls(t, n))),
    invoiceStatusWriters: files((t) => /\b(invoice|inv)\.status\s*=(?!=)/.test(t) || /\.\.\.invoice,\s*status:/.test(t)),
    formatAmountCallers: files((t, f) => f.startsWith("apps/") && /from "@acme\/core"/.test(t) && calls(t, "formatAmount")),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "teach-fixture-"));
  try {
    buildFixture(tmp);
    const byText = deriveFromText(tmp);
    const byConstruction = keys();
    let bad = 0;
    for (const [k, want] of Object.entries(byConstruction)) {
      const got = byText[k] ?? [];
      const missing = want.filter((x) => !got.includes(x));
      const extra = got.filter((x) => !want.includes(x));
      if (missing.length || extra.length) {
        bad++;
        console.log(`✗ ${k}\n    in key, not found by text: ${missing.join(", ") || "—"}\n    found by text, not in key: ${extra.join(", ") || "—"}`);
      } else {
        console.log(`✓ ${k} (${want.length})`);
      }
    }
    process.exit(bad ? 1 : 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
