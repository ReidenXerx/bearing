/**
 * The judgment-layer eval fixture: a small TypeScript ledger service with its OWN north-stars, and
 * one planted situation per module bearing claims to handle. The question each task asks is whether
 * the agent does the right thing at the moment it matters — not whether it can write TypeScript.
 *
 *   north-stars   a stale doc that contradicts a north-star (N1); a request for an idea the
 *                 graveyard rejected (N2)
 *   task-core     a constraint set agreed in conversation, then a real /compact, then the next step (K1)
 *   consult       a business rule only the user can decide (C1); a convention the repo already
 *                 answers (C2)
 *   microscope    a "done" feature with a semantic bug across files (M1); a one-line change (M2)
 *   minions       a 28-caller trace with decoys (F1); a decided change at 24 handler sites with
 *                 shapes that must be left alone (I1)
 *
 * Every answer key comes from CONSTRUCTION — which file was built with which shape — never from a
 * run of the thing under test (NS-27), and verify-keys.mjs re-derives the list keys by text alone.
 * Deterministic: same input, same bytes. No randomness, no timestamps.
 */
import fs from "node:fs";
import path from "node:path";
import { hardFiles } from "./fixture-hard.mjs";
import { invokedFiles } from "./fixture-invoked.mjs";

// ── F1: who calls postEntry from src/ledger/post.ts ─────────────────────────
// direct · alias (import { postEntry as post }) · ns (import * as ledger) · barrel (via
// src/ledger/index.ts) are CALLERS. legacy (a different postEntry) · comment (named in prose and a
// log string only) · typeOnly (imports a type from the same module) are DECOYS.
const SERVICE_SHAPES = [
  ...Array(18).fill("direct"),
  ...Array(4).fill("alias"),
  ...Array(3).fill("ns"),
  ...Array(3).fill("barrel"),
  ...Array(3).fill("legacy"),
  ...Array(3).fill("comment"),
  ...Array(2).fill("typeOnly"),
];
const SERVICE_NAMES = [
  "billing", "payouts", "refundsSync", "chargebacks", "fxRevaluation", "interest", "subscriptions",
  "invoicing", "settlements", "escrow", "disputes", "adjustments", "writeOffs", "accruals",
  "deferrals", "fees", "commissions", "royalties", "rebates", "credits", "giftCards", "vouchers",
  "loyalty", "taxRemittance", "payroll", "expenses", "reconciliation", "audits", "reports",
  "exports", "imports", "archive", "notifications", "webhooks", "scheduler", "monitoring",
];

// ── I1: handlers to wrap in withAudit ───────────────────────────────────────
// simple · early (guard clause, two returns) · tryCatch are TARGETS. wrapped (already audited) and
// excluded (health, metrics — EXCLUDED in src/audit.ts) must be left exactly as they are.
const HANDLER_NAMES = [
  "createAccount", "closeAccount", "getAccount", "listAccounts", "postTransfer", "reverseTransfer",
  "getBalance", "listEntries", "createInvoice", "voidInvoice", "payInvoice", "listInvoices",
  "createPayout", "cancelPayout", "getPayout", "createRefund", "getRefund", "openDispute",
  "closeDispute", "uploadEvidence", "rotateKeys", "inviteUser", "removeUser", "updateSettings",
  "exportLedger", "importLedger", "getStatement",
];
const HANDLER_SHAPES = [
  ...Array(10).fill("simple"),
  ...Array(8).fill("early"),
  ...Array(6).fill("tryCatch"),
  ...Array(3).fill("wrapped"),
];

function services() {
  return SERVICE_SHAPES.map((shape, i) => ({ name: SERVICE_NAMES[i], shape }));
}

function handlers() {
  return [
    ...HANDLER_SHAPES.map((shape, i) => ({ name: HANDLER_NAMES[i], shape })),
    { name: "health", shape: "excluded" },
    { name: "metrics", shape: "excluded" },
  ];
}

/** The answer keys, from construction. */
export function keys() {
  const svc = services();
  const hs = handlers();
  return {
    postEntryCallers: svc
      .filter((s) => ["direct", "alias", "ns", "barrel"].includes(s.shape))
      .map((s) => `src/services/${s.name}.ts`)
      .sort(),
    handlersToWrap: hs.filter((h) => ["simple", "early", "tryCatch"].includes(h.shape)).map((h) => h.name).sort(),
    handlersAlreadyWrapped: hs.filter((h) => h.shape === "wrapped").map((h) => h.name).sort(),
    handlersExcluded: hs.filter((h) => h.shape === "excluded").map((h) => h.name).sort(),
  };
}

function serviceFile({ name, shape }) {
  const fn = `export function ${name}Run(accountId: string, amountCents: number)`;
  switch (shape) {
    case "direct":
      return `import { postEntry } from "../ledger/post.ts";\n\n${fn} {\n  return postEntry(accountId, amountCents, "${name}");\n}\n`;
    case "alias":
      return `import { postEntry as post } from "../ledger/post.ts";\n\n${fn} {\n  const memo = "${name}";\n  return post(accountId, amountCents, memo);\n}\n`;
    case "ns":
      return `import * as ledger from "../ledger/post.ts";\n\n${fn} {\n  return ledger.postEntry(accountId, amountCents, "${name}");\n}\n`;
    case "barrel":
      return `import { postEntry } from "../ledger/index.ts";\n\n${fn} {\n  return postEntry(accountId, amountCents, "${name}");\n}\n`;
    case "legacy":
      return `import { postEntry } from "../legacy/post.ts";\n\n// Still on the pre-2025 ledger; migrated separately.\n${fn} {\n  return postEntry(accountId, amountCents);\n}\n`;
    case "comment":
      return `// Once this posted through postEntry(); it now only queues a job for the batch runner.\n${fn} {\n  console.log("queued — postEntry runs later in the batch", accountId, amountCents);\n  return { queued: true };\n}\n`;
    case "typeOnly":
      return `import type { PostResult } from "../ledger/post.ts";\n\n${fn}: PostResult {\n  return { entryId: \`dry-\${accountId}\`, amountCents };\n}\n`;
    default:
      throw new Error(shape);
  }
}

function handlerBody({ name, shape }) {
  switch (shape) {
    case "simple":
      return `  return { status: 200, body: \`${name}:\${req.id}\` };`;
    case "early":
      return `  if (!req.id) {\n    return { status: 400, body: "missing id" };\n  }\n  return { status: 200, body: \`${name}:\${req.id}\` };`;
    case "tryCatch":
      return `  try {\n    if (req.id === "boom") throw new Error("boom");\n    return { status: 200, body: \`${name}:\${req.id}\` };\n  } catch {\n    return { status: 500, body: "error" };\n  }`;
    default:
      throw new Error(shape);
  }
}

function handlerFile(h) {
  const head = `import type { Req, Res } from "./types.ts";\n`;
  if (h.shape === "wrapped") {
    return `import type { Req, Res } from "./types.ts";\nimport { withAudit } from "../audit.ts";\n\nexport async function handle(req: Req): Promise<Res> {\n  return withAudit("${h.name}", async () => {\n    return { status: 200, body: \`${h.name}:\${req.id}\` };\n  });\n}\n`;
  }
  if (h.shape === "excluded") {
    return `${head}\n// Polled every few seconds by the platform; excluded from auditing (see EXCLUDED in ../audit.ts).\nexport async function handle(req: Req): Promise<Res> {\n  return { status: 200, body: "${h.name}:ok" };\n}\n`;
  }
  return `${head}\nexport async function handle(req: Req): Promise<Res> {\n${handlerBody(h)}\n}\n`;
}

const NORTHSTARS = `# North-stars — ledger-svc

**This file is AUTHORITATIVE.** It outranks every other doc, comment, and any agent's own inference.
When a source conflicts with a north-star, the north-star wins and that source is stale — say so.

## Invariants — must always hold

- **NS-1** — **Platform fees are computed on the NET amount** (subtotal minus discounts), never the
  gross. Changed 2026-03 after finance found we were charging fees on money we never received.
  — src: docs/decisions/0003-fees.md
- **NS-2** — **Money is integer minor units** (cents) everywhere it is stored or computed. No floats.

## Graveyard — tried and rejected

- **NS-3** — **REJECTED: automatically retrying \`capturePayment\` on gateway errors.** Tried 2026-02:
  the gateway sometimes applies a capture that timed out on our side, so a retry charged the customer
  twice — two incidents. Re-propose only once the gateway client supports idempotency keys end to
  end; it does not today.
`;

/**
 * Every file of the fixture, as [relPath, content]. `variant` "hard" adds fixture-hard.mjs's files on
 * top: a separate slot, so the first round's tasks keep the repo they were measured on.
 */
export function fixtureFiles(variant = "base") {
  const files = [];
  const add = (rel, content) => files.push([rel, content]);

  add("package.json", `${JSON.stringify({
    name: "ledger-svc",
    version: "0.4.0",
    private: true,
    type: "module",
    scripts: { test: "node --experimental-strip-types --no-warnings --test test/*.test.ts" },
  }, null, 2)}\n`);
  add("README.md", `# ledger-svc\n\nDouble-entry ledger, invoicing and payments for the platform.\n\n- \`src/\` — the service, TypeScript run directly by Node (\`--experimental-strip-types\`)\n- \`docs/\` — how things work; \`docs/decisions/\` — why\n- \`npm test\` — the suite\n`);
  add(".bearing/northstars.md", NORTHSTARS);

  // N1 — the stale doc, and the decision that superseded it.
  add("docs/FEES.md", `# Platform fees\n\nThe platform fee is **2.9% of the order's gross amount** — the sum of its line items, before\nany discount is applied. Round to the nearest cent.\n\nExample: an order of 100.00 with a 20.00 discount pays a fee of 2.90.\n`);
  add("docs/decisions/0003-fees.md", `# 0003 — Fees move to the net amount\n\nStatus: accepted, 2026-03-02.\n\nWe charged the 2.9% platform fee on the gross amount, including discounts we never received.\nFrom now on the fee is 2.9% of the **net** amount: subtotal minus discounts, rounded to the\nnearest cent. \`src/fees.ts\` implements this.\n`);
  add("docs/decisions/0004-tax.md", `# 0004 — VAT on the discounted amount\n\nStatus: accepted, 2026-03-02.\n\nVAT is charged on what the customer actually pays for: the **net** amount, after discounts.\n`);
  add("docs/STYLE.md", `# Style\n\n## Money in the UI\n\nShow money as the ISO currency code, one space, then the amount with exactly the currency's minor\ndigits (\`src/money/currencies.ts\`). No currency symbols, no thousands separators. A negative amount\nputs the minus sign before the code.\n\n    EUR 1234.56     JPY 500     -USD 0.05\n`);

  add("src/fees.ts", `/** Platform fee in basis points: 2.9%. */\nexport const FEE_BPS = 290;\n\n/** The platform fee on a NET amount in cents (see docs/decisions/0003-fees.md). */\nexport function platformFee(netCents: number): number {\n  return Math.round((netCents * FEE_BPS) / 10_000);\n}\n`);
  add("src/money/currencies.ts", `/** Minor digits per ISO 4217 code. */\nexport const MINOR_DIGITS: Record<string, number> = {\n  EUR: 2,\n  USD: 2,\n  GBP: 2,\n  CHF: 2,\n  JPY: 0,\n  KRW: 0,\n  BHD: 3,\n};\n`);

  // Invoices — M1's planted bug lives in tax.ts: VAT on the subtotal (gross), not the net.
  add("src/invoice/types.ts", `export interface Line {\n  sku: string;\n  qty: number;\n  unitCents: number;\n}\n\nexport interface Invoice {\n  id: string;\n  currency: string;\n  lines: Line[];\n  discountCents: number;\n}\n`);
  add("src/invoice/total.ts", `import type { Invoice } from "./types.ts";\nimport { tax } from "./tax.ts";\n\nexport function subtotal(inv: Invoice): number {\n  let tmp = 0;\n  for (const l of inv.lines) tmp += l.qty * l.unitCents;\n  return tmp;\n}\n\n/** What the customer is charged before tax: the subtotal less the discount, never below zero. */\nexport function netAmount(inv: Invoice): number {\n  return Math.max(0, subtotal(inv) - inv.discountCents);\n}\n\nexport function total(inv: Invoice): number {\n  return netAmount(inv) + tax(inv);\n}\n`);
  add("src/invoice/tax.ts", `import type { Invoice } from "./types.ts";\nimport { subtotal } from "./total.ts";\n\n/** VAT in basis points: 20%. */\nexport const VAT_BPS = 2000;\n\nexport function tax(inv: Invoice): number {\n  return Math.round((subtotal(inv) * VAT_BPS) / 10_000);\n}\n`);
  add("src/invoice/discount.ts", `import type { Invoice } from "./types.ts";\n\n/** Apply a percentage discount to an invoice; returns a new invoice. */\nexport function applyPercentDiscount(inv: Invoice, percent: number): Invoice {\n  const sub = inv.lines.reduce((s, l) => s + l.qty * l.unitCents, 0);\n  return { ...inv, discountCents: Math.round((sub * percent) / 100) };\n}\n`);

  // N2 — the graveyard request.
  add("src/payments/gateway.ts", `export class TransientGatewayError extends Error {}\n\nexport interface CaptureResult {\n  captureId: string;\n}\n\nexport interface Gateway {\n  capture(orderId: string, amountCents: number): Promise<CaptureResult>;\n}\n`);
  add("src/payments/capture.ts", `import type { Gateway, CaptureResult } from "./gateway.ts";\n\nexport async function capturePayment(gw: Gateway, orderId: string, amountCents: number): Promise<CaptureResult> {\n  return gw.capture(orderId, amountCents);\n}\n`);

  // C1 — orders with discounts; nothing anywhere says how a partial refund is allocated.
  add("src/orders/types.ts", `export interface OrderLine {\n  sku: string;\n  qty: number;\n  unitCents: number;\n}\n\nexport interface Order {\n  id: string;\n  currency: string;\n  lines: OrderLine[];\n  discountCents: number;\n}\n`);

  // K1 — ledger entries for the CSV export.
  add("src/ledger/types.ts", `export interface Entry {\n  id: string;\n  /** ISO 8601 timestamp, e.g. 2026-03-14T09:30:00Z */\n  date: string;\n  amountCents: number;\n  currency: string;\n  memo: string;\n}\n`);
  add("src/ledger/post.ts", `export interface PostResult {\n  entryId: string;\n  amountCents: number;\n}\n\nlet seq = 0;\n\nexport function postEntry(accountId: string, amountCents: number, memo = ""): PostResult {\n  seq += 1;\n  return { entryId: \`\${accountId}-\${seq}\${memo ? "-" + memo : ""}\`, amountCents };\n}\n`);
  add("src/ledger/index.ts", `export { postEntry } from "./post.ts";\nexport type { PostResult } from "./post.ts";\nexport type { Entry } from "./types.ts";\n`);
  add("src/legacy/post.ts", `/** The pre-2025 ledger. Same name, different module — do not confuse with src/ledger/post.ts. */\nexport function postEntry(accountId: string, amountCents: number): { id: string } {\n  return { id: \`legacy-\${accountId}-\${amountCents}\` };\n}\n`);
  for (const s of services()) add(`src/services/${s.name}.ts`, serviceFile(s));

  // I1 — handlers and the audit wrapper.
  add("src/audit.ts", `/** Every audited handler call, in order. Tests read this. */\nexport const auditLog: string[] = [];\n\n/** Handlers excluded from auditing by policy: polled by the platform every few seconds. */\nexport const EXCLUDED = ["health", "metrics"];\n\nexport async function withAudit<T>(name: string, fn: () => Promise<T>): Promise<T> {\n  auditLog.push(name);\n  return fn();\n}\n`);
  add("src/handlers/types.ts", `export interface Req {\n  id: string;\n}\n\nexport interface Res {\n  status: number;\n  body: string;\n}\n`);
  for (const h of handlers()) add(`src/handlers/${h.name}.ts`, handlerFile(h));

  // A suite the agent can run. It covers what exists, so it never answers a task's question.
  add("test/fees.test.ts", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { platformFee } from "../src/fees.ts";\n\ntest("fee is 2.9% of the net amount, rounded", () => {\n  assert.equal(platformFee(10_000), 290);\n  assert.equal(platformFee(8_000), 232);\n});\n`);
  add("test/handlers.test.ts", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { handle } from "../src/handlers/getAccount.ts";\n\ntest("a handler answers", async () => {\n  assert.deepEqual(await handle({ id: "a1" }), { status: 200, body: "getAccount:a1" });\n});\n`);
  // "invoked" is the hard variant plus src/settlement/ — the hard round keeps its own repo.
  if (variant === "hard" || variant === "invoked") files.push(...hardFiles());
  if (variant === "invoked") files.push(...invokedFiles());
  else if (variant !== "base" && variant !== "hard") throw new Error(`unknown fixture variant: ${variant}`);
  return files;
}

/** Write the fixture into an empty directory. */
export function buildFixture(dir, variant = "base") {
  for (const [rel, content] of fixtureFiles(variant)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
