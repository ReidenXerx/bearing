import { cents } from "./money.ts";
import { applyRate } from "./rates.ts";
import { clamp } from "./limits.ts";

export class InvoiceService {
  lines: { qty: number; unitCents: number }[];
  constructor(lines: { qty: number; unitCents: number }[]) {
    this.lines = lines;
  }

  total(): number {
    return cents(this.lines.reduce((s, l) => s + l.qty * l.unitCents, 0));
  }

  /** The total after a percentage discount. */
  discounted(percent: number): number {
    return cents(applyRate(this.total(), -percent));
  }

  /** A partial refund, never more than the total. */
  refund(amountCents: number): number {
    return clamp(amountCents, 0, this.total());
  }
}
