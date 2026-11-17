import { cents } from "./money.ts";
<<<<<<< HEAD
import { applyRate } from "./rates.ts";
||||||| 8f3ef95
=======
import { clamp } from "./limits.ts";
>>>>>>> feature/refunds

export class InvoiceService {
  lines: { qty: number; unitCents: number }[];
  constructor(lines: { qty: number; unitCents: number }[]) {
    this.lines = lines;
  }

  total(): number {
    return cents(this.lines.reduce((s, l) => s + l.qty * l.unitCents, 0));
  }
<<<<<<< HEAD

  /** The total after a percentage discount. */
  discounted(percent: number): number {
    return cents(applyRate(this.total(), -percent));
  }
||||||| 8f3ef95
=======

  /** A partial refund, never more than the total. */
  refund(amountCents: number): number {
    return clamp(amountCents, 0, this.total());
  }
>>>>>>> feature/refunds
}
