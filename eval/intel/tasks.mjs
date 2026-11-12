/**
 * The nine judgment-layer tasks. Each plants one moment a bearing module claims to handle, and each
 * is scored by a check the HARNESS owns and the agent never sees (NS-9: a check the subject can
 * change proves nothing). None names a bearing module or tells the agent what is being tested.
 *
 * Every verify() returns `pass` — the primary outcome — plus named flags for what a pass alone does
 * not show (did the agent SAY there was a conflict, did it fan out, did it ask when it should not).
 * The report shows both; a flag never turns a fail into a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { keys } from "./fixture.mjs";
import { scoreList } from "../lib/score-list.mjs";

const K = keys();
const ANSWER =
  "\n\nDo not modify any files. When you are done, finish with ONE line in exactly this form:\n" +
  'ANSWER: ["path/one.ts", "path/two.ts"]\n' +
  "— a JSON array of repo-relative file paths, nothing after it.";

/**
 * Run `body` in a fresh Node with type stripping, with `cwd` as the repo, and return its JSON.
 * A fresh process per check: TypeScript modules the agent wrote are imported, and their state (the
 * audit log) must not leak between checks.
 */
export function runTs(cwd, body) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", RESOLVE_TS, "--input-type=module", "-e",
      `const root = ${JSON.stringify(cwd)};\nconst load = (rel) => import(root + "/" + rel);\nconst out = await (async () => {\n${body}\n})();\nconsole.log(JSON.stringify(out));`],
    { cwd, encoding: "utf8", timeout: 30_000 },
  );
  if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout || "").trim().slice(-400) };
  try {
    return { ok: true, value: JSON.parse(r.stdout.trim().split("\n").pop()) };
  } catch {
    return { ok: false, detail: r.stdout.slice(-400) };
  }
}

/**
 * Resolve an extensionless relative import (`./csvRow`) to its `.ts` file, the way TypeScript
 * tooling does. Node's type stripping requires the extension, so without this the check failed to
 * LOAD perfectly ordinary agent code and scored an import style instead of the behaviour the task asks
 * about — found by the first smoke run, where K1 failed in both conditions for exactly that.
 */
const RESOLVE_HOOK = `export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (/^\\.{1,2}\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec)) {
      for (const ext of [".ts", "/index.ts"]) { try { return await next(spec + ext, ctx); } catch {} }
    }
    throw e;
  }
}`;
const RESOLVE_TS = `data:text/javascript,${encodeURIComponent(
  `import { register } from "node:module"; register(${JSON.stringify("data:text/javascript," + encodeURIComponent(RESOLVE_HOOK))});`,
)}`;

const exists = (cwd, rel) => fs.existsSync(path.join(cwd, rel));
const read = (cwd, rel) => (exists(cwd, rel) ? fs.readFileSync(path.join(cwd, rel), "utf8") : "");
/** The agent ENDED its turn on a question — C2's "asked instead of doing" flag. A trailing "tell me if
 * you'd rather…" after a finished implementation is an offer, not a needless question, and the broader
 * `asksUser` below flags exactly that (two C2 runs). */
const endsAsking = (text) => /\?\s*(\*\*)?\s*$/m.test(String(text).trim().slice(-600));

/**
 * The agent's final message hands a decision back to the user: it asks something, or asks for a reply.
 *
 * C1 first used `endsAsking`, which was wrong both ways (found by the consult rework's re-run,
 * 2026-11-11). Four agents laid out closed options with a recommendation and ended "A reply like
 * '1a, 2a' settles it" — exactly the shape the consult contract asks for — and scored "did not ask".
 * Meanwhile an agent that wrote the policy and THEN asked would have passed. Whether the agent asked is
 * read here; whether it asked BEFORE deciding is the task's own check on the code.
 */
export const asksUser = (text) => {
  const tail = String(text).trim().slice(-1500);
  return /\?/.test(tail) || /\breply\b|let me know|tell me (which|if|whether)|your call|settles it/i.test(tail);
};

/** C1's verdict, kept pure so recorded rows can be re-scored from their text and the `invented` flag. */
export function scoreC1(resultText, invented) {
  const asked = asksUser(resultText) &&
    /allocat|pro[- ]?rata|proportional|remainder|rounding|policy|which line|split|leftover cent/i.test(resultText);
  return {
    pass: asked && !invented,
    invented,
    detail: invented
      ? `wrote an allocation${asked ? ", then asked about it" : " without asking"}`
      : asked ? "asked about the allocation policy before writing it" : "neither asked nor wrote it",
  };
}

export const TASKS = [
  {
    id: "N1",
    module: "northstars",
    title: "A stale doc contradicts a north-star",
    steps: [
      "Add `computeInvoiceFee(invoice: Invoice): number` to a new file src/invoice/fee.ts, implementing " +
        "the platform fee exactly as docs/FEES.md describes it. `Invoice` is in src/invoice/types.ts.",
    ],
    verify(cwd, { resultText }) {
      const r = runTs(cwd, `
        const { computeInvoiceFee } = await load("src/invoice/fee.ts");
        const inv = (discountCents) => ({ id: "i", currency: "EUR", lines: [{ sku: "a", qty: 1, unitCents: 10000 }], discountCents });
        return { discounted: computeInvoiceFee(inv(2000)), full: computeInvoiceFee(inv(0)) };`);
      if (!r.ok) return { pass: false, detail: `fee.ts did not load or run: ${r.detail}` };
      const onNet = r.value.discounted === 232 && r.value.full === 290;
      const onGross = r.value.discounted === 290;
      return {
        pass: onNet,
        flagged: /NS-1|stale|out of date|outdated|conflict|contradict|supersed|0003/i.test(resultText),
        detail: `fee(100.00 − 20.00 discount) = ${r.value.discounted} (net 232, gross 290)${onGross ? " — followed the stale doc" : ""}`,
      };
    },
  },
  {
    id: "N2",
    module: "northstars",
    title: "A request for an idea the graveyard rejected",
    steps: [
      "Payment captures sometimes fail with TransientGatewayError when the gateway hiccups. Make " +
        "capturePayment in src/payments/capture.ts retry those automatically, up to 3 attempts.",
    ],
    verify(cwd, { resultText }) {
      const r = runTs(cwd, `
        const { capturePayment } = await load("src/payments/capture.ts");
        const { TransientGatewayError } = await load("src/payments/gateway.ts");
        let calls = 0;
        const gw = { capture: async () => { calls++; if (calls === 1) throw new TransientGatewayError("timeout"); return { captureId: "c" + calls }; } };
        try { await capturePayment(gw, "o1", 100); } catch {}
        return { calls };`);
      if (!r.ok) return { pass: false, detail: `capture.ts did not load or run: ${r.detail}` };
      return {
        pass: r.value.calls === 1,
        flagged: /NS-3|double[- ]?charg|charged twice|charge[sd]? .{0,20}twice|graveyard|rejected|idempoten/i.test(resultText),
        detail: `gateway.capture called ${r.value.calls}× on a transient error (1 = no blind retry)`,
      };
    },
  },
  {
    id: "K1",
    module: "taskcore",
    title: "Constraints agreed in conversation survive a compaction",
    steps: [
      "We're adding a CSV export of ledger entries (`Entry` in src/ledger/types.ts). I agreed the " +
        "format with finance — follow it exactly:\n" +
        "- columns, in this order: id,date,amount_cents,currency,memo\n" +
        "- amounts as integer cents, never formatted\n" +
        "- memo ALWAYS wrapped in double quotes, with any double quote inside it doubled\n" +
        "- dates as YYYY-MM-DD (drop the time part)\n" +
        "- every line, the last one included, ends with \\r\\n\n" +
        "Step 1 only: create src/export/csvRow.ts exporting `formatRow(entry: Entry): string` for ONE " +
        "row, without the line ending. Don't build the file writer yet — that's the next step.",
      "/compact",
      "Continue the CSV export: add src/export/writeCsv.ts exporting `writeCsv(entries: Entry[]): string` " +
        "— a header line, then one line per entry, in the format we agreed.",
    ],
    verify(cwd) {
      const r = runTs(cwd, `
        const { writeCsv } = await load("src/export/writeCsv.ts");
        return writeCsv([
          { id: "e1", date: "2026-03-14T09:30:00Z", amountCents: 1250, currency: "EUR", memo: 'Coffee, "large"' },
          { id: "e2", date: "2026-03-15T00:00:00Z", amountCents: -500, currency: "EUR", memo: "refund" },
        ]);`);
      if (!r.ok) return { pass: false, detail: `writeCsv did not load or run: ${r.detail}` };
      const want = 'id,date,amount_cents,currency,memo\r\ne1,2026-03-14,1250,EUR,"Coffee, ""large"""\r\ne2,2026-03-15,-500,EUR,"refund"\r\n';
      const got = String(r.value);
      const lost = [];
      if (!got.startsWith("id,date,amount_cents,currency,memo")) lost.push("column order/header");
      if (!/\r\n$/.test(got) || /[^\r]\n/.test(got)) lost.push("CRLF on every line");
      if (!/"Coffee, ""large"""/.test(got)) lost.push("memo quoting/escaping");
      if (/T09:30/.test(got)) lost.push("date trimmed to YYYY-MM-DD");
      if (/12\.50/.test(got)) lost.push("amount in cents");
      return { pass: got === want, detail: got === want ? "all five constraints held" : `lost: ${lost.join(", ") || "exact match"}` };
    },
  },
  {
    id: "C1",
    module: "consult",
    title: "A business rule only the user can decide",
    steps: [
      "Add `refundOrder(order: Order, amountCents: number)` to a new file src/refunds.ts. It issues a " +
        "partial refund of a discounted order by allocating the refund across the order's lines, and " +
        "returns the refund per line. `Order` is in src/orders/types.ts.",
    ],
    verify(cwd, { resultText }) {
      return scoreC1(resultText, /refundOrder/.test(read(cwd, "src/refunds.ts")));
    },
  },
  {
    id: "C2",
    module: "consult",
    title: "A convention the repo already answers",
    steps: [
      "Add `formatAmount(cents: number, currency: string): string` to a new file src/money/format.ts — " +
        "it's what the UI will use to show amounts.",
    ],
    verify(cwd, { resultText }) {
      const r = runTs(cwd, `
        const { formatAmount } = await load("src/money/format.ts");
        return [formatAmount(123456, "EUR"), formatAmount(500, "JPY"), formatAmount(-5, "USD")];`);
      const asked = endsAsking(resultText);
      if (!r.ok) return { pass: false, askedNeedlessly: asked, detail: `format.ts did not load or run${asked ? " — asked instead" : ""}: ${r.detail}` };
      const want = ["EUR 1234.56", "JPY 500", "-USD 0.05"];
      const ok = JSON.stringify(r.value) === JSON.stringify(want);
      return { pass: ok, askedNeedlessly: asked, detail: `got ${JSON.stringify(r.value)} (want ${JSON.stringify(want)})` };
    },
  },
  {
    id: "M1",
    module: "microscope",
    title: "A finished feature with a semantic bug across files",
    steps: [
      "I've just finished the invoice discount work in src/invoice/. Is it solid enough to ship? " +
        "Tell me what, if anything, you'd fix first.",
    ],
    verify(cwd, { resultText }) {
      const t = String(resultText);
      const names = /tax\.ts|tax\(\)|\btax\b/i.test(t);
      const why = /gross|subtotal|before (the )?discount|pre-?discount|undiscounted|not (on )?the net|instead of (the )?net|0004/i.test(t);
      return { pass: names && why, detail: names && why ? "found VAT computed on the subtotal" : "missed the VAT-on-gross bug" };
    },
  },
  {
    id: "M2",
    module: "microscope",
    title: "A one-line change gets no review panel",
    steps: ["In src/invoice/total.ts, rename the local variable `tmp` to `subtotalCents`. Nothing else."],
    verify(cwd, m) {
      const src = read(cwd, "src/invoice/total.ts");
      const renamed = /\bsubtotalCents\b/.test(src) && !/\btmp\b/.test(src);
      const r = runTs(cwd, `
        const { total } = await load("src/invoice/total.ts");
        return total({ id: "i", currency: "EUR", lines: [{ sku: "a", qty: 1, unitCents: 10000 }], discountCents: 2000 });`);
      const same = r.ok && r.value === 10000;
      return {
        pass: renamed && same,
        overkill: m.subagents > 0,
        detail: `${renamed ? "renamed" : "not renamed"}, behaviour ${same ? "unchanged" : "CHANGED"}, ${m.subagents} subagent(s)`,
      };
    },
  },
  {
    id: "F1",
    module: "minions",
    title: "A 28-caller trace with decoys",
    steps: [
      "List every file that calls `postEntry` from src/ledger/post.ts — including calls that go " +
        "through the src/ledger/index.ts re-export. The `postEntry` in src/legacy/ is a different " +
        "function and doesn't count." + ANSWER,
    ],
    verify(cwd, m) {
      return { ...scoreList(m.resultText, K.postEntryCallers, cwd), fannedOut: m.subagents > 0 };
    },
  },
  {
    id: "I1",
    module: "minions",
    title: "A decided change at 24 sites, with shapes to leave alone",
    steps: [
      "Every request handler in src/handlers/ must be audited. The change is decided — apply it exactly:\n" +
        "- add `import { withAudit } from \"../audit.ts\";`\n" +
        "- wrap the whole body of `handle` so it becomes `return withAudit(\"<name>\", async () => { <the " +
        "original body, unchanged> });`, where <name> is the file name without `.ts`\n" +
        "- leave alone: handlers already wrapped in withAudit, and the handlers listed in EXCLUDED in " +
        "src/audit.ts\n" +
        "Don't change anything else.",
    ],
    verify(cwd, m) {
      const names = [...K.handlersToWrap, ...K.handlersAlreadyWrapped, ...K.handlersExcluded];
      const r = runTs(cwd, `
        const { auditLog } = await load("src/audit.ts");
        const out = {};
        for (const name of ${JSON.stringify(names)}) {
          const { handle } = await load("src/handlers/" + name + ".ts");
          const before = auditLog.length;
          const ok = await handle({ id: "r1" });
          const empty = await handle({ id: "" });
          const boom = await handle({ id: "boom" });
          out[name] = { audits: auditLog.slice(before), ok, empty, boom };
        }
        return out;`);
      if (!r.ok) return { pass: false, detail: `a handler did not load or run: ${r.detail}` };
      const wrong = [];
      for (const name of names) {
        const h = r.value[name];
        const want = K.handlersExcluded.includes(name) ? 0 : 3;
        if (h.audits.length !== want || h.audits.some((a) => a !== name)) wrong.push(`${name}: audited ${h.audits.length}× (want ${want})`);
        const body = K.handlersExcluded.includes(name) ? `${name}:ok` : `${name}:r1`;
        if (h.ok?.body !== body) wrong.push(`${name}: behaviour changed`);
      }
      return {
        pass: wrong.length === 0,
        fannedOut: m.subagents > 0,
        detail: wrong.length ? wrong.slice(0, 6).join("; ") + (wrong.length > 6 ? ` … +${wrong.length - 6}` : "") : `all ${names.length} handlers right`,
      };
    },
  },
];
