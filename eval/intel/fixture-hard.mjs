/**
 * The HARD variant of the judgment-layer fixture: the base ledger-svc plus four planted situations at
 * a scale where one agent working serially should start to slip. The first round (REPORT.md) put
 * task-core, microscope and minions at the ceiling — 5/5 in both conditions — because 28 callers,
 * 24 handlers and a one-file bug fit in one agent's head. These do not, by design:
 *
 *   K2 task-core   a ten-rule export spec agreed in conversation, two unrelated jobs between it and
 *                  its use (one of them on a CONFLICTING money format), and two real compactions
 *   M3 microscope  a "finished" billing feature with four semantic bugs in four files, each of which
 *                  only shows against a doc or a domain fact; checked by RUNNING the code
 *   F2 minions     200 jobs audited against one rule grep cannot apply: 75 violators, including keys
 *                  that contain `evt.id` and are still wrong, and helpers that live in another file
 *   I2 invasive    106 handlers in seven syntactic shapes to wrap, 14 to leave alone; checked by
 *                  running every handler against the untouched originals
 *
 * Every key comes from CONSTRUCTION, never from a run of the thing under test (NS-27).
 * Deterministic: same input, same bytes.
 */

// ── F2: 200 event jobs, audited against the idempotency-key rule ─────────────────
const JOB_DOMAINS = [
  "invoice", "payout", "refund", "dispute", "transfer", "fee", "interest", "fx", "escrow", "voucher",
  "giftCard", "loyalty", "rebate", "royalty", "commission", "payroll", "expense", "tax", "chargeback", "subscription",
];
const JOB_EVENTS = ["Created", "Settled", "Reversed", "Expired", "Adjusted", "Captured", "Failed", "Retried", "Closed", "Reopened"];

// OK shapes: the key is stable across retries of one event AND unique per event.
// Violations: changes on retry (now, random, localBad, sharedBad, counter), absent (missing), or not
// per-event (account). `now` and `localBad` CONTAIN the event id — a grep for `evt.id` passes them.
const JOB_SHAPE_COUNTS = [
  ["okEventId", 35], ["okTemplate", 25], ["okLine", 15], ["okLocalHelper", 20], ["okShared", 20], ["okDecoyComment", 10],
  ["vNow", 12], ["vRandom", 10], ["vMissing", 12], ["vLocalBad", 10], ["vSharedBad", 10], ["vCounter", 11], ["vAccount", 10],
];
export const JOB_COUNT = 200;

function jobs() {
  const shapes = JOB_SHAPE_COUNTS.flatMap(([s, n]) => Array(n).fill(s));
  if (shapes.length !== JOB_COUNT) throw new Error(`job shapes sum to ${shapes.length}`);
  const names = JOB_DOMAINS.flatMap((d) => JOB_EVENTS.map((e) => `on${d[0].toUpperCase()}${d.slice(1)}${e}`));
  // 7 is coprime to 200, so i → 7i mod 200 is a permutation: shapes are spread, not grouped.
  return names.map((name, i) => ({ name, shape: shapes[(i * 7) % JOB_COUNT], i }));
}

// Filler that makes each job a realistic ~35 lines, varied so no two files read alike.
function jobPrelude(name, i) {
  const limit = [5_000_00, 10_000_00, 25_000_00, 50_000_00][i % 4];
  const ops = [
    `  const amountCents = evt.amountCents;`,
    `  const amountCents = -Math.abs(evt.amountCents);`,
    `  const amountCents = Math.round(evt.amountCents * ${1 + (i % 5) / 100});`,
    `  const amountCents = evt.amountCents - ${(i % 7) * 10};`,
  ];
  return [
    `/** ${name}: posts the ledger movement for one ${name.replace(/^on/, "")} event. */`,
    `const LIMIT_CENTS = ${limit};`,
    ``,
    `function validate(evt: LedgerEvent): void {`,
    `  if (!evt.id) throw new Error("${name}: event without id");`,
    `  if (!Number.isInteger(evt.amountCents)) throw new Error("${name}: amount must be integer cents");`,
    `  if (Math.abs(evt.amountCents) > LIMIT_CENTS) throw new Error("${name}: over the ${limit / 100} limit");`,
    `}`,
    ``,
    `function accountFor(evt: LedgerEvent): string {`,
    i % 3 === 0 ? `  return evt.accountId;` : i % 3 === 1 ? `  return \`sub:\${evt.accountId}\`;` : `  return evt.accountId.toLowerCase();`,
    `}`,
    ``,
    `export function ${name}(evt: LedgerEvent) {`,
    `  validate(evt);`,
    ops[i % ops.length],
  ];
}

function jobFile({ name, shape, i }) {
  const imports = [`import { postIdempotent } from "../ledger/idempotent.ts";`, `import type { LedgerEvent } from "../ledger/keys.ts";`];
  const pre = [];
  let key;
  switch (shape) {
    case "okEventId": key = `evt.id`; break;
    case "okTemplate": key = `\`${name}:\${evt.id}\``; break;
    case "okLine": key = `\`\${evt.id}:\${evt.lineNo ?? 0}\``; break;
    case "okLocalHelper":
      pre.push(`function keyOf(e: LedgerEvent): string {`, `  return "${name}-" + e.id;`, `}`, ``);
      key = `keyOf(evt)`;
      break;
    case "okShared":
      imports.push(`import { eventKey } from "../ledger/keys.ts";`);
      key = `eventKey(evt)`;
      break;
    case "okDecoyComment":
      key = `evt.id /* never Date.now() or a random id here: a retry must reuse the key */`;
      break;
    case "vNow": key = `\`\${evt.id}-\${Date.now()}\``; break;
    case "vRandom":
      imports.push(`import { randomUUID } from "node:crypto";`);
      key = `randomUUID()`;
      break;
    case "vMissing": key = null; break;
    case "vLocalBad":
      pre.push(`function keyOf(e: LedgerEvent): string {`, `  return e.id + ":" + Math.random().toString(36).slice(2);`, `}`, ``);
      key = `keyOf(evt)`;
      break;
    case "vSharedBad":
      imports.push(`import { freshKey } from "../ledger/keys.ts";`);
      key = `freshKey()`;
      break;
    case "vCounter":
      pre.push(`let seq = 0;`, ``);
      key = `\`\${evt.accountId}-\${++seq}\``;
      break;
    case "vAccount": key = `evt.accountId`; break;
    default: throw new Error(shape);
  }
  const call = key === null
    ? `  return postIdempotent(accountFor(evt), amountCents);`
    : `  return postIdempotent(accountFor(evt), amountCents, { idempotencyKey: ${key} });`;
  return [...imports, ``, ...pre, ...jobPrelude(name, i), call, `}`, ``].join("\n");
}

// ── I2: 120 route handlers, 106 to wrap in withAudit ─────────────────────────────
const ROUTE_RESOURCES = [
  "account", "card", "customer", "dispute", "document", "invoice", "ledger", "mandate", "merchant", "note",
  "order", "payout", "plan", "price", "product", "refund", "report", "statement", "webhook",
];
const ROUTE_ACTIONS = ["Create", "Get", "List", "Update", "Delete", "Search"];
/** Excluded by policy (src/routes/policy.ts): probes the platform polls. Must stay unaudited. */
export const ROUTE_EXCLUDED = ["ping", "ready", "live", "version", "favicon", "robots"];
const ROUTE_SHAPE_COUNTS = [
  ["fnSimple", 30], ["fnEarly", 15], ["fnTryCatch", 12], ["arrowBlock", 15], ["arrowExpr", 12],
  ["nestedReturn", 12], ["withBatch", 10], ["wrapped", 8],
];
const ROUTE_TARGET_SHAPES = ["fnSimple", "fnEarly", "fnTryCatch", "arrowBlock", "arrowExpr", "nestedReturn", "withBatch"];

function routes() {
  const shapes = ROUTE_SHAPE_COUNTS.flatMap(([s, n]) => Array(n).fill(s));
  const names = ROUTE_RESOURCES.flatMap((r) => ROUTE_ACTIONS.map((a) => `${r}${a}`));
  if (shapes.length !== names.length) throw new Error(`route shapes ${shapes.length} vs names ${names.length}`);
  // 11 is coprime to 114.
  const generated = names.map((name, i) => ({ name, shape: shapes[(i * 11) % names.length] }));
  return [...generated, ...ROUTE_EXCLUDED.map((name) => ({ name, shape: "excluded" }))];
}

function routeFile({ name, shape }) {
  const head = `import type { Req, Res } from "../handlers/types.ts";\n`;
  const ok = `{ status: 200, body: \`${name}:\${req.id}\` }`;
  switch (shape) {
    case "fnSimple":
      return `${head}\nexport async function handle(req: Req): Promise<Res> {\n  return ${ok};\n}\n`;
    case "fnEarly":
      return `${head}\nexport async function handle(req: Req): Promise<Res> {\n  if (!req.id) {\n    return { status: 400, body: "missing id" };\n  }\n  return ${ok};\n}\n`;
    case "fnTryCatch":
      return `${head}\nexport async function handle(req: Req): Promise<Res> {\n  try {\n    if (req.id === "boom") throw new Error("boom");\n    return ${ok};\n  } catch {\n    return { status: 500, body: "error" };\n  }\n}\n`;
    case "arrowBlock":
      return `${head}\nexport const handle = async (req: Req): Promise<Res> => {\n  if (!req.id) return { status: 400, body: "missing id" };\n  return ${ok};\n};\n`;
    case "arrowExpr":
      return `${head}\nexport const handle = async (req: Req): Promise<Res> => (${ok});\n`;
    case "nestedReturn":
      return `${head}\nexport async function handle(req: Req): Promise<Res> {\n  const parts = req.id.split("-").map((p) => {\n    return p.toUpperCase();\n  });\n  return { status: 200, body: \`${name}:\${parts.join("-")}\` };\n}\n`;
    case "withBatch":
      return `${head}\nexport async function handle(req: Req): Promise<Res> {\n  return ${ok};\n}\n\n/** Batch endpoint: audited through each \`handle\` call, never as a whole. */\nexport async function handleBatch(reqs: Req[]): Promise<Res[]> {\n  return Promise.all(reqs.map((r) => handle(r)));\n}\n`;
    case "wrapped":
      return `${head}import { withAudit } from "../audit.ts";\n\nexport async function handle(req: Req): Promise<Res> {\n  return withAudit("${name}", async () => {\n    return ${ok};\n  });\n}\n`;
    case "excluded":
      return `${head}\n// Polled by the platform; excluded from auditing (ROUTE_EXCLUDED in ./policy.ts).\nexport async function handle(req: Req): Promise<Res> {\n  return { status: 200, body: "${name}:ok" };\n}\n`;
    default:
      throw new Error(shape);
  }
}

// ── M3: the billing feature, four planted bugs ──────────────────────────────────
// A period.ts   end of the month is INCLUSIVE: an invoice at 00:00 on the 1st lands in two months
// B fee.ts      fee rounded per line, then the discount's fee subtracted — ADR 0003 says 2.9% of the
//               NET, rounded once
// C display.ts  always two decimals — docs/STYLE.md says the currency's own minor digits
// D webhook.ts  a redelivered event posts the payment twice — docs/WEBHOOKS.md: at-least-once
export const M3_BUGS = ["period-boundary", "fee-rounding", "minor-digits", "webhook-redelivery"];

function billingFiles(add) {
  add("docs/WEBHOOKS.md", `# Webhooks\n\nThe payment gateway delivers every webhook **at least once**. A redelivery carries the same event\n\`id\` as the original, sometimes minutes later, sometimes after we already answered 200.\n`);
  add("docs/BILLING.md", `# Billing statements\n\nA monthly statement lists the invoices issued in that calendar month (UTC), each with its net\namount, its platform fee and its VAT, formatted for display per docs/STYLE.md. Payments arrive by\nwebhook (docs/WEBHOOKS.md) and are posted to the ledger.\n`);
  add("src/billing/types.ts", `import type { Invoice } from "../invoice/types.ts";\n\nexport interface BilledInvoice extends Invoice {\n  /** ISO 8601, UTC. */\n  issuedAt: string;\n}\n\nexport interface StatementLine {\n  invoiceId: string;\n  net: string;\n  fee: string;\n}\n`);
  add("src/billing/period.ts", `/** Is an invoice issued at \`issuedAt\` part of the statement for \`year\`-\`month\` (1-12, UTC)? */\nexport function inPeriod(issuedAt: string, year: number, month: number): boolean {\n  const start = Date.UTC(year, month - 1, 1);\n  const end = Date.UTC(year, month, 1);\n  const t = Date.parse(issuedAt);\n  return t >= start && t <= end;\n}\n`);
  add("src/billing/fee.ts", `import type { Invoice } from "../invoice/types.ts";\nimport { platformFee } from "../fees.ts";\n\n/** The platform fee on one invoice (docs/decisions/0003-fees.md). */\nexport function invoiceFee(inv: Invoice): number {\n  const lineFees = inv.lines.reduce((s, l) => s + platformFee(l.qty * l.unitCents), 0);\n  return lineFees - platformFee(inv.discountCents);\n}\n`);
  add("src/billing/display.ts", `/** A money amount for the statement, per docs/STYLE.md. */\nexport function statementAmount(cents: number, currency: string): string {\n  const sign = cents < 0 ? "-" : "";\n  return \`\${sign}\${currency} \${(Math.abs(cents) / 100).toFixed(2)}\`;\n}\n`);
  add("src/billing/webhook.ts", `import { postEntry } from "../ledger/post.ts";\nimport type { PostResult } from "../ledger/post.ts";\n\nexport interface PaymentEvent {\n  /** The gateway's event id. */\n  id: string;\n  invoiceId: string;\n  amountCents: number;\n}\n\nexport interface BillingStore {\n  paid: Set<string>;\n  posted: PostResult[];\n}\n\n/** Gateway webhook: the invoice was paid. Marks it paid and posts the payment to the ledger. */\nexport function onPaymentSucceeded(evt: PaymentEvent, store: BillingStore): PostResult {\n  store.paid.add(evt.invoiceId);\n  const r = postEntry(\`inv:\${evt.invoiceId}\`, evt.amountCents, "payment");\n  store.posted.push(r);\n  return r;\n}\n`);
  add("src/billing/statement.ts", `import type { BilledInvoice, StatementLine } from "./types.ts";\nimport { inPeriod } from "./period.ts";\nimport { invoiceFee } from "./fee.ts";\nimport { statementAmount } from "./display.ts";\nimport { netAmount } from "../invoice/total.ts";\n\n/** The statement lines for one month, in issue order. */\nexport function statement(invoices: BilledInvoice[], year: number, month: number): StatementLine[] {\n  return invoices\n    .filter((inv) => inPeriod(inv.issuedAt, year, month))\n    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))\n    .map((inv) => ({\n      invoiceId: inv.id,\n      net: statementAmount(netAmount(inv), inv.currency),\n      fee: statementAmount(invoiceFee(inv), inv.currency),\n    }));\n}\n`);
  add("src/billing/index.ts", `export { statement } from "./statement.ts";\nexport { onPaymentSucceeded } from "./webhook.ts";\nexport type { BilledInvoice, StatementLine } from "./types.ts";\n`);
}

// ── K2: the statement export the conversation agrees ─────────────────────────────
export const K2_SPEC = [
  "the file starts with a UTF-8 byte-order mark (\\uFEFF)",
  "fields are separated by `;`",
  "the header is exactly: entry_id;booked_on;amount;currency;direction;memo",
  "booked_on is the entry's UTC date as DD.MM.YYYY",
  "amount is the ABSOLUTE value in major units with exactly the currency's minor digits (MINOR_DIGITS in src/money/currencies.ts) and a COMMA as the decimal separator — EUR 1250 → 12,50 · JPY 500 → 500 · BHD 1250 → 1,250",
  "direction is C when amountCents ≥ 0, D when it is negative",
  "memo is wrapped in double quotes, any double quote inside it doubled, and any line break in it replaced by one space",
  "rows are sorted by booked_on (the day) ascending, then by entry_id ascending",
  "an entry whose currency is not in MINOR_DIGITS is skipped, not an error",
  "every line, the last one included, ends with \\r\\n",
];

/** The hard variant's own files — added to the base fixture's. */
export function hardFiles() {
  const files = [];
  const add = (rel, content) => files.push([rel, content]);

  add("docs/IDEMPOTENCY.md", `# Idempotent ledger posts\n\nEvent jobs (\`src/jobs/\`) post to the ledger with \`postIdempotent\`. The ledger drops a second post\nwith a key it has already seen, so a retried job cannot double-post — **if** the key is right.\n\n**The rule:** every \`postIdempotent\` call in a job passes an \`idempotencyKey\` that is\n\n1. **the same on every retry of the same event** — derived from the event's \`id\`, never from the\n   clock, a random source, or a counter; and\n2. **unique per event** — two different events must never share a key.\n\nA job that omits the key breaks the rule.\n`);
  add("src/ledger/keys.ts", `import { randomUUID } from "node:crypto";\n\nexport interface LedgerEvent {\n  id: string;\n  accountId: string;\n  amountCents: number;\n  lineNo?: number;\n}\n\n/** Stable per event: the same event always yields the same key. */\nexport const eventKey = (e: LedgerEvent): string => \`evt:\${e.id}\`;\n\n/** A fresh key on every call — for one-off manual postings, never for event-driven jobs. */\nexport const freshKey = (): string => randomUUID();\n`);
  add("src/ledger/idempotent.ts", `export interface PostOptions {\n  idempotencyKey?: string;\n}\n\nconst seen = new Set<string>();\nlet seq = 0;\n\n/** Post to the ledger; a repeated idempotencyKey is dropped. */\nexport function postIdempotent(accountId: string, amountCents: number, opts: PostOptions = {}): { entryId: string; duplicate: boolean } {\n  if (opts.idempotencyKey !== undefined && seen.has(opts.idempotencyKey)) return { entryId: "", duplicate: true };\n  if (opts.idempotencyKey !== undefined) seen.add(opts.idempotencyKey);\n  seq += 1;\n  return { entryId: \`\${accountId}-\${seq}\`, duplicate: false };\n}\n`);
  for (const j of jobs()) add(`src/jobs/${j.name}.ts`, jobFile(j));

  add("src/routes/policy.ts", `/** Routes excluded from auditing: probes the platform polls every few seconds. */\nexport const ROUTE_EXCLUDED = ${JSON.stringify(ROUTE_EXCLUDED)};\n`);
  for (const r of routes()) add(`src/routes/${r.name}.ts`, routeFile(r));

  billingFiles(add);
  return files;
}

/** The answer keys for the hard tasks, from construction. */
export function hardKeys() {
  const js = jobs();
  const rs = routes();
  return {
    jobViolators: js.filter((j) => j.shape.startsWith("v")).map((j) => `src/jobs/${j.name}.ts`).sort(),
    jobsOk: js.filter((j) => j.shape.startsWith("ok")).map((j) => `src/jobs/${j.name}.ts`).sort(),
    routesToWrap: rs.filter((r) => ROUTE_TARGET_SHAPES.includes(r.shape)).map((r) => r.name).sort(),
    routesWithBatch: rs.filter((r) => r.shape === "withBatch").map((r) => r.name).sort(),
    routesAlreadyWrapped: rs.filter((r) => r.shape === "wrapped").map((r) => r.name).sort(),
    routesExcluded: [...ROUTE_EXCLUDED].sort(),
    routeShapes: Object.fromEntries(rs.map((r) => [r.name, r.shape])),
  };
}
