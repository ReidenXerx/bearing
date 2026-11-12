/**
 * The INVOKED round's fixture: the hard variant plus a settlement module built for a requested review.
 *
 * The hard round asked whether an agent STARTS a review panel or a fan-out on its own. It never did,
 * and never needed to — so both modules became user-invoked (#40), and NS-23 now judges them by the
 * method: once the user asks, does bearing's skill do the job better than the agent's own way? This
 * round gives both conditions the same explicit ask and scores the result.
 *
 * src/settlement/ has SIX planted bugs and FOUR decoys. A decoy is code that looks wrong and is
 * right per the docs — the shape a review panel without a refutation pass "fixes" into a bug. Every
 * bug and every decoy is checked by RUNNING the code, so "fixed" and "broken" are both behaviour,
 * never wording.
 *
 *   bugs    fx-direction      convert divides by the rate; docs/SETTLEMENT.md says rates[from][to]
 *                             is units of `to` per unit of `from`, so it multiplies
 *           release-ms        the 90-day reserve release adds seconds, not milliseconds
 *           reserve-on-gross  reserve taken on gross minus fees; the doc says on gross
 *           min-rollover      a balance under the minimum is set to 0 — the doc says it rolls over
 *           weekend-utc       the weekend check reads LOCAL getDay(); business days are UTC
 *           payout-idempotent a retried payout id pays twice — the doc says never
 *   decoys  half-even         banker's rounding, required by ADR 0007 — "fixing" it to Math.round breaks it
 *           cutoff-inclusive  `>= 17` is right: at or after 17:00 UTC goes next day
 *           carry-forward     a negative payout is clamped to 0 AND carried, not dropped
 *           fire-and-forget   `void notify().catch(log)` is deliberate: notifications never block a payout
 */

export const R1_BUGS = ["fx-direction", "release-ms", "reserve-on-gross", "min-rollover", "weekend-utc", "payout-idempotent"];
export const R1_DECOYS = ["half-even", "cutoff-inclusive", "carry-forward", "fire-and-forget"];

/** The invoked variant's own files — added on top of the hard variant's. */
export function invokedFiles() {
  const files = [];
  const add = (rel, content) => files.push([rel, content]);

  add("docs/SETTLEMENT.md", `# Settlement — how merchant payouts work

All amounts are integer minor units (cents). Times and calendar days are **UTC**.

## Currency conversion
\`rates[from][to]\` is how many units of \`to\` one unit of \`from\` buys. Converting \`cents\` from
\`from\` to \`to\` gives \`cents × rates[from][to]\`, rounded **half to even** — the acquirer's contract
requires banker's rounding (docs/decisions/0007-rounding.md).

## Rolling reserve
10% of each payout's **gross** amount is held back as a reserve and released **90 days** after the
payout date.

## Payout amount
payout = gross − fees − reserve − carry, where carry is a shortfall from an earlier payout. If the
result is negative, the payout is 0 and the shortfall becomes the new carry — it is never written off.

## Minimum payout
A payout under 1000 cents is not sent: the amount **rolls over** to the next payout
(\`rolloverCents\`). It is never dropped.

## Schedule
A payout requested **at or after 17:00 UTC** is scheduled for the next day; earlier, for the same
day. Either way, a Saturday or Sunday (UTC) moves it to the following Monday.

## Retries
A payout request may be retried. The same \`payoutId\` must never pay twice: a retry returns the
payout already made.

## Notifications
A payout notification must never block or fail a payout. Send it fire-and-forget and log a failure.
`);
  add("docs/decisions/0007-rounding.md", `# 0007 — Banker's rounding for FX\n\nStatus: accepted, 2026-02-11.\n\nOur acquirer settles FX with round-half-to-even, and reconciliation broke every time we rounded\nhalf up: a few cents a day, never the same few. \`roundHalfEven\` in src/settlement/fx.ts is the only\nrounding FX may use.\n`);

  add("src/settlement/types.ts", `export type Rates = Record<string, Record<string, number>>;

export interface PayoutInput {
  payoutId: string;
  merchantId: string;
  grossCents: number;
  feeCents: number;
  /** Shortfall carried from an earlier payout. */
  carryCents: number;
  /** ISO 8601, UTC. */
  requestedAt: string;
}

export interface Payout {
  payoutId: string;
  merchantId: string;
  payoutCents: number;
  reserveCents: number;
  reserveReleaseAt: string;
  carryCents: number;
  rolloverCents: number;
  /** YYYY-MM-DD, UTC. */
  scheduledFor: string;
}

export interface PayoutStore {
  /** Every payout actually sent, in order. */
  ledger: Payout[];
  log: string[];
}
`);
  add("src/settlement/fx.ts", `import type { Rates } from "./types.ts";

/** Round half to even (banker's rounding) — the acquirer requires it (docs/decisions/0007-rounding.md). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Convert minor units between currencies (docs/SETTLEMENT.md). */
export function convert(cents: number, from: string, to: string, rates: Rates): number {
  if (from === to) return cents;
  const rate = rates[from]?.[to];
  if (rate === undefined) throw new Error(\`no rate \${from}->\${to}\`);
  return roundHalfEven(cents / rate);
}
`);
  add("src/settlement/reserve.ts", `const DAY_MS = 24 * 60 * 60;

/** Reserve held back, in basis points of the gross: 10%. */
export const RESERVE_BPS = 1000;
export const RESERVE_DAYS = 90;

export function reserveFor(cents: number): number {
  return Math.round((cents * RESERVE_BPS) / 10_000);
}

/** When a reserve taken on \`payoutDate\` is released. */
export function releaseAt(payoutDate: string): string {
  return new Date(Date.parse(payoutDate) + RESERVE_DAYS * DAY_MS).toISOString();
}
`);
  add("src/settlement/schedule.ts", `export const CUTOFF_HOUR_UTC = 17;

/** The day (YYYY-MM-DD, UTC) a payout requested at \`requestedAt\` is sent. */
export function nextPayoutDate(requestedAt: string): string {
  const d = new Date(requestedAt);
  if (d.getUTCHours() >= CUTOFF_HOUR_UTC) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
`);
  add("src/settlement/notify.ts", `/** Every notification sent, in order. */
export const sent: string[] = [];

export async function notify(merchantId: string, message: string): Promise<void> {
  if (merchantId.startsWith("smtp-down")) throw new Error("smtp down");
  sent.push(\`\${merchantId}: \${message}\`);
}
`);
  add("src/settlement/payout.ts", `import type { Payout, PayoutInput, PayoutStore } from "./types.ts";
import { reserveFor, releaseAt } from "./reserve.ts";
import { nextPayoutDate } from "./schedule.ts";
import { notify } from "./notify.ts";

export const MIN_PAYOUT_CENTS = 1000;

/** What a payout request comes to (docs/SETTLEMENT.md). Pure: sends nothing. */
export function computePayout(p: PayoutInput): Payout {
  const reserveCents = reserveFor(p.grossCents - p.feeCents);
  let amount = p.grossCents - p.feeCents - reserveCents - p.carryCents;
  let carryCents = 0;
  if (amount < 0) {
    carryCents = -amount;
    amount = 0;
  }
  if (amount < MIN_PAYOUT_CENTS) amount = 0;
  const scheduledFor = nextPayoutDate(p.requestedAt);
  return {
    payoutId: p.payoutId,
    merchantId: p.merchantId,
    payoutCents: amount,
    reserveCents,
    reserveReleaseAt: releaseAt(\`\${scheduledFor}T00:00:00.000Z\`),
    carryCents,
    rolloverCents: 0,
    scheduledFor,
  };
}

/** Send a payout: record it in the ledger and notify the merchant. */
export function runPayout(p: PayoutInput, store: PayoutStore): Payout {
  const payout = computePayout(p);
  store.ledger.push(payout);
  void notify(p.merchantId, \`payout \${payout.payoutCents} on \${payout.scheduledFor}\`).catch((e) =>
    store.log.push(\`notify failed for \${p.payoutId}: \${String(e)}\`),
  );
  return payout;
}
`);
  add("src/settlement/index.ts", `export { computePayout, runPayout, MIN_PAYOUT_CENTS } from "./payout.ts";\nexport { convert, roundHalfEven } from "./fx.ts";\nexport { nextPayoutDate } from "./schedule.ts";\nexport type { Payout, PayoutInput, PayoutStore, Rates } from "./types.ts";\n`);
  return files;
}

/**
 * One probe per bug and per decoy, each run in its own process. A bug probe returns true once the
 * bug is FIXED; a decoy probe returns true while the decoy still behaves as documented.
 */
const IN = (o = {}) => JSON.stringify({ payoutId: "p1", merchantId: "m1", grossCents: 10000, feeCents: 300, carryCents: 0, requestedAt: "2026-03-04T10:00:00Z", ...o });
export const R1_PROBES = {
  "fx-direction": `
    const { convert } = await load("src/settlement/fx.ts");
    return convert(1000, "EUR", "USD", { EUR: { USD: 1.1 } }) === 1100 && convert(1000, "USD", "EUR", { USD: { EUR: 0.9 } }) === 900;`,
  "release-ms": `
    const { releaseAt } = await load("src/settlement/reserve.ts");
    return releaseAt("2026-01-01T00:00:00.000Z") === "2026-04-01T00:00:00.000Z";`,
  "reserve-on-gross": `
    const { computePayout } = await load("src/settlement/payout.ts");
    const p = computePayout(${IN()});
    return p.reserveCents === 1000 && p.payoutCents === 8700;`,
  "min-rollover": `
    const { computePayout } = await load("src/settlement/payout.ts");
    const p = computePayout(${IN({ grossCents: 1000, feeCents: 0 })});
    return p.payoutCents === 0 && p.rolloverCents === 900;`,
  "weekend-utc": `
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14: a Friday noon in UTC is already Saturday locally
    const { nextPayoutDate } = await load("src/settlement/schedule.ts");
    return nextPayoutDate("2026-03-06T12:00:00Z") === "2026-03-06" && nextPayoutDate("2026-03-07T12:00:00Z") === "2026-03-09";`,
  "payout-idempotent": `
    const { runPayout } = await load("src/settlement/payout.ts");
    const store = { ledger: [], log: [] };
    const a = runPayout(${IN()}, store);
    const b = runPayout(${IN()}, store);
    runPayout(${IN({ payoutId: "p2" })}, store);
    return store.ledger.length === 2 && b.payoutCents === a.payoutCents;`,
  "half-even": `
    const { roundHalfEven, convert } = await load("src/settlement/fx.ts");
    // Independent of the fx-direction bug: with rates 0.5 and 2, ONE of the two calls lands on 12.5
    // whichever way convert applies the rate. Half-even gives 12 there; half-up gives 13.
    const r = (x) => convert(25, "EUR", "GBP", { EUR: { GBP: x } });
    const got = [r(0.5), r(2)];
    return roundHalfEven(2.5) === 2 && roundHalfEven(3.5) === 4 && roundHalfEven(2.6) === 3
      && got.includes(12) && !got.includes(13);`,
  "cutoff-inclusive": `
    process.env.TZ = "UTC"; // the decoy is the cutoff, not the weekend bug
    const { nextPayoutDate } = await load("src/settlement/schedule.ts");
    return nextPayoutDate("2026-03-04T17:00:00Z") === "2026-03-05" && nextPayoutDate("2026-03-04T16:59:59Z") === "2026-03-04";`,
  "carry-forward": `
    const { computePayout } = await load("src/settlement/payout.ts");
    // No fee, so the reserve is the same whichever base the reserve-on-gross fix picks.
    const p = computePayout(${IN({ grossCents: 1000, feeCents: 0, carryCents: 2000 })});
    return p.payoutCents === 0 && p.carryCents === 1100;`,
  "fire-and-forget": `
    const { runPayout } = await load("src/settlement/payout.ts");
    const store = { ledger: [], log: [] };
    let threw = false, r;
    try { r = runPayout(${IN({ merchantId: "smtp-down-1" })}, store); } catch { threw = true; }
    await new Promise((res) => setTimeout(res, 20));
    return !threw && !(r instanceof Promise) && store.ledger.length === 1 && store.log.length === 1;`,
};
