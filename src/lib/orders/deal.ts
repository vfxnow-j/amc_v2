import type { BillingCycleType, ReservationType } from "@/generated/prisma/client";

/**
 * What an order is worth as a deal, not as one invoice (owner, 2026-09-17).
 *
 * A recurring rental prices its lines at the monthly rate — RES-2026-00092 is a
 * 14-month deal that shows the client $1,160 a month. Its stored `totalMargin`
 * is that one month less the whole deal's cost, so it read as losing $1,400
 * while the deal clears five figures. Margin on a recurring order is therefore
 * read over its committed term (`Reservation.termMonths`, or `rtoTermMonths`
 * on a rent-to-own).
 *
 * With no term recorded there is no deal total to read a margin from, so this
 * says so (`dealRevenue` null) and gives the months it takes to cover the cost
 * instead, rather than guessing a length.
 *
 * Cost is taken as one-time: `totalCost` is item cost basis plus shipping,
 * sub-rental and hardware, none of which recur per period in this schema.
 */

export type DealInput = {
  type: ReservationType;
  cycleType: BillingCycleType;
  isRecurring: boolean;
  /** Pre-discount, pre-tax line subtotal — one period on a recurring order. */
  subtotal: number;
  discountAmount: number;
  totalCost: number | null;
  termMonths: number | null;
  rtoTermMonths?: number | null;
};

export type Deal = {
  recurring: boolean;
  /** Revenue per month after discount, on a recurring order. */
  perMonth: number | null;
  /** Committed months, when recorded. */
  months: number | null;
  /** The whole deal after discount, or null on a recurring order with no term. */
  dealRevenue: number | null;
  cost: number | null;
  /** Deal revenue less cost; null when either is unknown. */
  margin: number | null;
  /** Months of revenue it takes to cover the cost, on a recurring order. */
  paybackMonths: number | null;
};

/** Periods in a month, for the cycles that recur on a fixed length. */
function periodsPerMonth(cycle: BillingCycleType): number | null {
  switch (cycle) {
    case "MONTHLY":
      return 1;
    case "WEEKLY":
      return 52 / 12;
    case "BI_WEEKLY":
      return 26 / 12;
    case "DAILY":
      return 365 / 12;
    default:
      return null;
  }
}

export function dealFor(input: DealInput): Deal {
  const period = Math.max(0, input.subtotal - input.discountAmount);
  const cost = input.totalCost;
  const perPeriod = periodsPerMonth(input.cycleType);
  const recurring = input.isRecurring && input.cycleType !== "ONE_TIME" && perPeriod !== null;

  if (!recurring) {
    return {
      recurring: false,
      perMonth: null,
      months: null,
      dealRevenue: period,
      cost,
      margin: cost === null ? null : period - cost,
      paybackMonths: null,
    };
  }

  const perMonth = period * perPeriod;
  const months = (input.type === "RENT_TO_OWN" ? input.rtoTermMonths : input.termMonths) ?? input.termMonths ?? null;
  const dealRevenue = months && months > 0 ? perMonth * months : null;
  return {
    recurring: true,
    perMonth,
    months: months && months > 0 ? months : null,
    dealRevenue,
    cost,
    margin: dealRevenue === null || cost === null ? null : dealRevenue - cost,
    paybackMonths: cost && cost > 0 && perMonth > 0 ? cost / perMonth : null,
  };
}
