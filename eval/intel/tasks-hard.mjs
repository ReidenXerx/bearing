/**
 * The hard round: four tasks for the modules the first round could not measure (REPORT.md — task-core,
 * microscope and minions were 5/5 in both conditions). Same rules as tasks.mjs: each is scored by a
 * check the harness owns, never shown to the agent, and none names a bearing module. They run on the
 * "hard" fixture variant (fixture-hard.mjs), in a slot of their own.
 *
 * Where a task has parts, `found` counts them, so a round that does not reach a full pass still shows
 * which condition got further — pass/fail alone is what made the first round's ceiling uninformative.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTs } from "./tasks.mjs";
import { buildFixture } from "./fixture.mjs";
import { hardKeys, K2_SPEC, M3_BUGS } from "./fixture-hard.mjs";
import { scoreList } from "../lib/score-list.mjs";

const H = hardKeys();
const ANSWER =
  "\n\nDo not modify any files. When you are done, finish with ONE line in exactly this form:\n" +
  'ANSWER: ["path/one.ts", "path/two.ts"]\n' +
  "— a JSON array of repo-relative file paths, nothing after it.";

// ── K2 ──────────────────────────────────────────────────────────────────────────
const K2_ENTRIES = [
  { id: "e3", date: "2026-03-15T08:00:00Z", amountCents: -500, currency: "EUR", memo: "refund" },
  { id: "e1", date: "2026-03-14T23:30:00Z", amountCents: 1250, currency: "EUR", memo: 'Coffee, "large"' },
  { id: "e2", date: "2026-03-14T09:00:00Z", amountCents: 500, currency: "JPY", memo: "line1\nline2" },
  { id: "e5", date: "2026-03-15T07:00:00Z", amountCents: 1250, currency: "BHD", memo: "x" },
  { id: "e4", date: "2026-03-13T10:00:00Z", amountCents: 100, currency: "XYZ", memo: "skip me" },
];
const K2_WANT =
  "﻿entry_id;booked_on;amount;currency;direction;memo\r\n" +
  'e1;14.03.2026;12,50;EUR;C;"Coffee, ""large"""\r\n' +
  'e2;14.03.2026;500;JPY;C;"line1 line2"\r\n' +
  'e3;15.03.2026;5,00;EUR;D;"refund"\r\n' +
  'e5;15.03.2026;1,250;BHD;C;"x"\r\n';

/** Which of the ten agreed rules the output broke — the detail a bare mismatch would hide. */
export function k2Lost(got) {
  const lost = [];
  const body = got.replace(/^﻿/, "");
  const lines = body.split("\r\n");
  if (!got.startsWith("﻿")) lost.push("BOM");
  if (lines[0] !== "entry_id;booked_on;amount;currency;direction;memo") lost.push("header/delimiter");
  if (!/14\.03\.2026/.test(got) || /15\.03\.2026;12,50/.test(got)) lost.push("UTC date as DD.MM.YYYY");
  if (!/;12,50;EUR/.test(got) || !/;500;JPY/.test(got) || !/;1,250;BHD/.test(got) || !/;5,00;EUR/.test(got)) lost.push("amount: absolute, minor digits, comma");
  if (!/;EUR;D;/.test(got) || !/;JPY;C;/.test(got)) lost.push("direction C/D");
  if (!got.includes('"Coffee, ""large"""') || !got.includes('"line1 line2"')) lost.push("memo quoting/line breaks");
  const ids = lines.slice(1).map((l) => l.split(";")[0]).filter(Boolean);
  if (ids.filter((i) => i !== "e4").join(",") !== "e1,e2,e3,e5") lost.push("sort by day, then id"); // e4 is the skip rule's
  if (/XYZ|skip me/.test(got)) lost.push("skip unknown currency");
  if (!got.endsWith("\r\n") || /[^\r]\n/.test(got)) lost.push("CRLF on every line");
  return lost;
}

// ── M3 ──────────────────────────────────────────────────────────────────────────
/** One probe per planted bug, each in its own process so a broken file cannot hide the others. */
const M3_PROBES = {
  "period-boundary": `
    const { inPeriod } = await load("src/billing/period.ts");
    return inPeriod("2026-04-01T00:00:00Z", 2026, 3) === false && inPeriod("2026-04-01T00:00:00Z", 2026, 4) === true
      && inPeriod("2026-03-31T23:59:59Z", 2026, 3) === true && inPeriod("2026-03-01T00:00:00Z", 2026, 3) === true;`,
  "fee-rounding": `
    const { invoiceFee } = await load("src/billing/fee.ts");
    const inv = (lines, discountCents) => ({ id: "i", currency: "EUR", lines, discountCents });
    const l = (unitCents) => ({ sku: "s", qty: 1, unitCents });
    return invoiceFee(inv([l(50), l(50), l(50)], 0)) === 4      // 2.9% of 150 = 4.35 → 4, not 1+1+1
      && invoiceFee(inv([l(10000)], 2000)) === 232                // the ordinary case still holds
      && invoiceFee(inv([l(1000)], 2000)) === 0;                  // net clamps at zero, so the fee does too`,
  "minor-digits": `
    const { statementAmount } = await load("src/billing/display.ts");
    return statementAmount(500, "JPY") === "JPY 500" && statementAmount(1250, "BHD") === "BHD 1.250"
      && statementAmount(123456, "EUR") === "EUR 1234.56" && statementAmount(-5, "USD") === "-USD 0.05";`,
  "webhook-redelivery": `
    const { onPaymentSucceeded } = await load("src/billing/webhook.ts");
    const store = { paid: new Set(), posted: [] };
    const evt = { id: "evt_1", invoiceId: "inv_1", amountCents: 1000 };
    onPaymentSucceeded(evt, store);
    onPaymentSucceeded({ ...evt }, store);                         // the gateway redelivers
    onPaymentSucceeded({ id: "evt_2", invoiceId: "inv_2", amountCents: 500 }, store);
    return store.posted.length === 2 && store.paid.has("inv_1") && store.paid.has("inv_2");`,
};
export function m3Fixed(cwd) {
  return Object.fromEntries(M3_BUGS.map((b) => {
    const r = runTs(cwd, M3_PROBES[b]);
    return [b, r.ok && r.value === true];
  }));
}

// ── I2 ──────────────────────────────────────────────────────────────────────────
const ROUTE_NAMES = Object.keys(H.routeShapes).sort();
const I2_PROBE = `
  const { auditLog } = await load("src/audit.ts");
  const out = {};
  for (const name of ${JSON.stringify(ROUTE_NAMES)}) {
    const m = await load("src/routes/" + name + ".ts");
    const before = auditLog.length;
    const res = [await m.handle({ id: "r1" }), await m.handle({ id: "" }), await m.handle({ id: "boom" })];
    const audits = auditLog.slice(before);
    let batch = null;
    if (typeof m.handleBatch === "function") {
      const b0 = auditLog.length;
      const bodies = await m.handleBatch([{ id: "b1" }, { id: "b2" }]);
      batch = { bodies, audits: auditLog.slice(b0) };
    }
    out[name] = { res, audits, batch };
  }
  return out;`;
let pristineI2 = null;
/** The untouched routes' behaviour, probed from a fresh build of the fixture — never from the agent's tree. */
function i2Baseline() {
  if (pristineI2) return pristineI2;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "intel-i2-"));
  try {
    buildFixture(d, "hard");
    const r = runTs(d, I2_PROBE);
    if (!r.ok) throw new Error(`the pristine routes did not run: ${r.detail}`);
    pristineI2 = r.value;
    return pristineI2;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}
export function i2Wrong(cwd) {
  const base = i2Baseline();
  const r = runTs(cwd, I2_PROBE);
  if (!r.ok) return { loaded: false, wrong: [`a route did not load or run: ${r.detail}`] };
  const wrong = [];
  for (const name of ROUTE_NAMES) {
    const got = r.value[name];
    const want = base[name];
    const target = H.routesToWrap.includes(name);
    const wantAudits = target ? 3 : want.audits.length;
    if (got.audits.length !== wantAudits || got.audits.some((a) => a !== name)) wrong.push(`${name}: audited ${got.audits.length}× (want ${wantAudits})`);
    if (JSON.stringify(got.res) !== JSON.stringify(want.res)) wrong.push(`${name}: behaviour changed`);
    if (want.batch) {
      // handleBatch is audited through each handle call, so 2 — a wrapped handleBatch makes it 3.
      if (!got.batch) wrong.push(`${name}: handleBatch removed`);
      else {
        if (got.batch.audits.length !== 2) wrong.push(`${name}: handleBatch audited ${got.batch.audits.length}× (want 2)`);
        if (JSON.stringify(got.batch.bodies) !== JSON.stringify(want.batch.bodies)) wrong.push(`${name}: handleBatch behaviour changed`);
      }
    }
  }
  return { loaded: true, wrong };
}

export const HARD_TASKS = [
  {
    id: "K2",
    module: "taskcore",
    fixture: "hard",
    title: "A ten-rule spec survives two compactions and two unrelated jobs",
    steps: [
      "We're adding a statement export for our EU finance team: a CSV of ledger entries (`Entry` in " +
        "src/ledger/types.ts). I agreed the format with them this morning — follow it exactly:\n" +
        K2_SPEC.map((r) => `- ${r}`).join("\n") + "\n\n" +
        "Step 1 only: create src/export/euAmount.ts exporting `euAmount(cents: number, currency: string): string` — " +
        "the amount column alone. Don't build the export itself yet; we'll come back to it.",
      "Something unrelated came up. `applyPercentDiscount` in src/invoice/discount.ts must reject a percent " +
        "outside 0–100 with a RangeError. Make that change, add tests for it in test/discount.test.ts, and run the suite.",
      "/compact",
      "One more unrelated job: add src/money/parse.ts exporting `parseAmount(text: string): { cents: number; currency: string }` — " +
        "the inverse of the UI money format in docs/STYLE.md. Throw on anything malformed. Add tests and run them.",
      "/compact",
      "Back to the statement export from the start of our session: write src/export/statement.ts exporting " +
        "`statementCsv(entries: Entry[]): string`, following the format I agreed with finance exactly.",
    ],
    verify(cwd) {
      const r = runTs(cwd, `
        const { statementCsv } = await load("src/export/statement.ts");
        return statementCsv(${JSON.stringify(K2_ENTRIES)});`);
      if (!r.ok) return { pass: false, found: 0, detail: `statementCsv did not load or run: ${r.detail}` };
      const got = String(r.value);
      const lost = k2Lost(got);
      const pass = got === K2_WANT;
      return {
        pass,
        found: K2_SPEC.length - lost.length,
        detail: pass ? "all ten rules held" : `lost: ${lost.join(", ") || "exact match only"}`,
      };
    },
  },
  {
    id: "M3",
    module: "microscope",
    fixture: "hard",
    title: "A finished billing feature with four semantic bugs",
    steps: [
      "I've finished the billing-statements feature in src/billing/ — period selection, the invoice fee, " +
        "statement amounts and the payment webhook. Review it and fix whatever is wrong before I ship it. " +
        "Keep the exported function signatures and types as they are.",
    ],
    verify(cwd, m) {
      const fixed = m3Fixed(cwd);
      const n = Object.values(fixed).filter(Boolean).length;
      return {
        pass: n === M3_BUGS.length,
        found: n,
        fannedOut: m.subagents > 0,
        detail: M3_BUGS.map((b) => `${b} ${fixed[b] ? "fixed" : "NOT fixed"}`).join(", "),
      };
    },
  },
  {
    id: "F2",
    module: "minions",
    fixture: "hard",
    title: "200 jobs audited against a rule grep cannot apply",
    steps: [
      "Audit every job in src/jobs/ against the rule in docs/IDEMPOTENCY.md. List every job file whose " +
        "`postIdempotent` call breaks the rule." + ANSWER,
    ],
    verify(cwd, m) {
      const s = scoreList(m.resultText, H.jobViolators, cwd);
      return { ...s, found: Math.round((s.recall ?? 0) * H.jobViolators.length), fannedOut: m.subagents > 0 };
    },
  },
  {
    id: "I2",
    module: "minions",
    fixture: "hard",
    title: "A decided change at 106 sites in seven shapes, 14 to leave alone",
    steps: [
      "Every route handler in src/routes/ must be audited. The change is decided — apply it exactly:\n" +
        "- in each route file, import `withAudit` from \"../audit.ts\"\n" +
        "- wrap the whole body of the exported `handle` so every call runs through " +
        "`withAudit(\"<name>\", async () => <the original body's result>)`, where <name> is the file name " +
        "without `.ts`. Behaviour must not change.\n" +
        "- leave alone: routes already wrapped in withAudit, the routes listed in ROUTE_EXCLUDED in " +
        "src/routes/policy.ts, and any `handleBatch` export (it is audited through `handle`)\n" +
        "Don't change anything else.",
    ],
    verify(cwd, m) {
      const { loaded, wrong } = i2Wrong(cwd);
      const badRoutes = new Set(wrong.map((w) => w.split(":")[0]));
      return {
        pass: wrong.length === 0,
        found: loaded ? H.routesToWrap.filter((n) => !badRoutes.has(n)).length : 0,
        fannedOut: m.subagents > 0,
        detail: wrong.length ? wrong.slice(0, 6).join("; ") + (wrong.length > 6 ? ` … +${wrong.length - 6}` : "") : `all ${ROUTE_NAMES.length} routes right`,
      };
    },
  },
];
