/**
 * The figure a quote surface is allowed to show, before anything is saved.
 *
 * It has no arithmetic of its own, and that is the entire point. A dialog that
 * needs a number is one line of `rate * quantity` away from inventing a second
 * pricing rule, and the app has been there: RES-2026-00089 showed $11,980.29 on
 * screen and $8,800.00 on the PDF the client actually received, because two
 * surfaces each did their own sum. So this composes the two functions the
 * server already commits through — `computeReservationFinancials` for the money
 * and `calculatePeriods` for the term — and nothing else. Change how an order
 * is priced and every quote surface moves with it, because there is nowhere
 * else for them to get a number.
 *
 * Both imports are deliberately free of server-only code (`pricing/periods.ts`
 * says so in its own header), so a client component calling this lands on the
 * exact figure the server will persist rather than an approximation of it.
 *
 * What it deliberately does not return is a *total*. Tax comes off the location
 * of the first unit, which `createReservation` looks up while it writes, and
 * shipping is not known until somebody chooses a method — neither is knowable
 * in a dialog. Hence `SUBTOTAL_LABEL`: the number is honest about being partial,
 * and the taxed total is read back from the order once it exists.
 */

import {
  computeReservationFinancials,
  type FinancialItem,
  type FinancialOrder,
} from "@/lib/pricing/financials";
import { calculatePeriods } from "@/lib/pricing/periods";

/** The only caption this figure may carry. Never "Total". */
export const SUBTOTAL_LABEL = "Subtotal — before tax and shipping";

export type QuoteEstimate = {
  /** Each line's amount across the term, in the order the lines were given. */
  lineAmounts: number[];
  /** Billing periods each line's term covers. Fractional: a 6-week rental of a monthly item is 1.36. */
  linePeriods: number[];
  /** The lines summed. Before tax, before shipping, before any discount. */
  subtotal: number;
};

export function estimateQuote(
  order: FinancialOrder,
  lines: FinancialItem[],
): QuoteEstimate {
  const financials = computeReservationFinancials({ order, items: lines });
  return {
    lineAmounts: financials.itemAmounts,
    linePeriods: lines.map((line) =>
      line.isOneTime
        ? 1
        : calculatePeriods(
            order.startDate,
            order.endDate,
            line.pricingType,
            order.isRecurring ?? false,
          ),
    ),
    subtotal: financials.itemsSubtotal,
  };
}
