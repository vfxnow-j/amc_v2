/**
 * What a unit has earned on one checkout — the figure behind "revenue earned"
 * on every asset, unit and fixed-asset screen.
 *
 * **It follows how the business bills (owner, 2026-09-17).** A customer rents
 * gear monthly, on demand: periods run from the anchor (the 1st) to month end,
 * each one bills on the anchor until the order is cancelled, and a return
 * mid-period is prorated to the day it came back — never less than a week.
 * Nothing is booked for a whole term up front. So a unit on a recurring order
 * earns its line's rate for every period it is out:
 *
 * - from the day it went out (or the order's start, if later),
 * - a prorated stub up to the first anchor, as the first invoice bills it,
 * - every whole period after that,
 * - the period it is in now in full while it is still out (billed in advance),
 * - and, once it is back, the final period prorated to the return day, with at
 *   least a week counted.
 *
 * Whatever the proration comes to, a rental earns at least one whole period
 * (owner, 2026-09-17): a short monthly rental is invoiced a full month —
 * RES-2026-00080 ran Jul 17–24 and billed $2,820 — so the week minimum governs
 * a return in a later period, never the first.
 *
 * The rate is the one its order line bills at, and a checkout is one unit of
 * that line — when the line is priced by the order's own period. A line marked
 * daily or project on a monthly order is still a monthly rate when the order
 * priced it as one (its subtotal is rate × quantity: RES-2026-00001's MacBooks
 * at $250). When the order priced it over the days instead, it is not:
 * RES-2026-00063's NAS is $600 a day, out 24 days, subtotal $14,400, and that
 * checkout charge is what it earned. Such a line, and a one-time line (a fee,
 * charged once), keeps its checkout charge.
 *
 * **Everything is net of the order's discount (owner, 2026-09-17).** A
 * percentage comes off every period; a fixed amount comes off the order once,
 * shared across its checkouts by what each earned (`applyOrderDiscount`).
 *
 * **v1 counted this differently, and v2 does not copy it.** v1 credits a
 * recurring order one checkout charge per cycle, but only on orders its
 * `isRecurring` switch marks, which leaves 21 running monthly rentals earning a
 * single charge. On its fixed-term orders the checkout charge is the whole
 * term (a 12-month order's charge is 12× the rate), so it books a year of
 * revenue the day the unit goes out. v2 derives recurrence from the order
 * (`lib/orders/recurring.ts`) and counts periods from the line rate, so a
 * year's charge is never multiplied by the months out.
 *
 * Everything that does not recur keeps its checkout charge, which already
 * covers the whole term: a one-time rental, a sale, a rent-to-own (its charge
 * is full value; installments are the financing, not the earning), and an
 * order marked not billed.
 *
 * No server-only imports, so the rule can be checked on its own.
 */
import {
  addDays,
  anchorAfter,
  anchorOnOrBefore,
  billedPeriods,
  businessDayOf,
  businessToday,
  daysBetween,
  intendedDay,
  isAnchoredCycle,
  type BillingAnchor,
} from "@/lib/billing/calendar";
import { roundMoney } from "@/lib/pricing/periods";

/** The bottom line on a return: a unit back mid-period still earns a week. */
export const MINIMUM_DAYS = 7;

/** The bottom line on a rental: it earns at least one whole period. */
export const MINIMUM_PERIODS = 1;

export type EarningCheckout = {
  status: string;
  checkoutDate: Date;
  actualReturn: Date | null;
  totalCharge: number;
  /** The rate of the order line this unit went out on, when it has one. */
  lineRate: number | null;
  /** What that rate is per: MONTHLY, WEEKLY, DAILY or PROJECT. */
  linePricingType: string | null;
  /** The line's quantity and subtotal: how the order priced the rate. */
  lineQuantity: number | null;
  lineSubtotal: number | null;
  /** A one-time line — a fee charged once, never per period. */
  lineOneTime: boolean;
  order: {
    reservationType: string;
    status: string;
    isRecurring: boolean;
    notBilled: boolean;
    billingCycleType: string;
    billingCycleDays: number | null;
    startDate: Date;
    recurrenceEndDate: Date | null;
    completedAt: Date | null;
  } | null;
};

const OUT = new Set(["ACTIVE", "OVERDUE"]);

/**
 * Periods of the rate a checkout has earned by `today` (a stored business day).
 * Zero for a checkout that does not bill by the period.
 */
export function earnedPeriods(
  c: EarningCheckout,
  anchor: BillingAnchor,
  today: Date = businessToday(),
): number {
  const order = c.order;
  if (!order) return 0;

  const outDay = businessDayOf(new Date(c.checkoutDate));
  let start = new Date(Math.max(outDay.getTime(), intendedDay(order.startDate).getTime()));

  // The last day it was earning, when that is behind us: back in, or the order
  // stopped under it. A unit still out with nothing stopping it runs on.
  const stops: number[] = [];
  if (c.actualReturn) stops.push(businessDayOf(new Date(c.actualReturn)).getTime());
  if (order.recurrenceEndDate) stops.push(intendedDay(order.recurrenceEndDate).getTime());
  if (order.status === "COMPLETED" && order.completedAt) {
    stops.push(businessDayOf(new Date(order.completedAt)).getTime());
  }
  const stop = stops.length ? Math.min(...stops) : null;
  const stillOut = OUT.has(c.status) && (stop === null || stop >= today.getTime());
  const lastDay = stillOut ? null : new Date(stop ?? today.getTime());

  const cycle = order.billingCycleType;
  if (isAnchoredCycle(cycle)) {
    if (lastDay === null) {
      // Out now: everything up to the next anchor has been billed, the period
      // it is in included. Out ahead of its start: the first invoice.
      const from = start.getTime() > today.getTime() ? start : today;
      return billedPeriods(start, anchorAfter(from, cycle, anchor), cycle, anchor);
    }
    // Back before the order's start date: it was still out, from the day it
    // left. Back before it left is a record kept out of order: the week.
    if (lastDay.getTime() < start.getTime()) start = outDay;
    if (lastDay.getTime() < start.getTime()) start = lastDay;
    const endExclusive = addDays(lastDay, 1);
    let periods = billedPeriods(start, endExclusive, cycle, anchor);
    // The week minimum, on the period it came back in.
    const periodStart = anchorOnOrBefore(lastDay, cycle, anchor);
    const periodDays = daysBetween(periodStart, anchorAfter(periodStart, cycle, anchor));
    const from = start.getTime() > periodStart.getTime() ? start : periodStart;
    const daysIn = daysBetween(from, endExclusive);
    if (daysIn < MINIMUM_DAYS && periodDays > 0) {
      periods += (Math.min(MINIMUM_DAYS, periodDays) - daysIn) / periodDays;
    }
    return periods;
  }

  // A custom cycle keeps its own length: days out over the cycle's days, the
  // one it is in counted in full while out, never under a week.
  const cycleDays = Math.max(1, order.billingCycleDays || 30);
  const until = lastDay ?? today;
  const days = Math.max(MINIMUM_DAYS, daysBetween(start, addDays(until, 1)));
  const periods = days / cycleDays;
  return lastDay === null ? Math.ceil(periods - 1e-9) : periods;
}

/** Whether a checkout's line bills its rate once per billing period. */
function ratePerPeriod(c: EarningCheckout, cycle: string): boolean {
  if (c.lineOneTime) return false;
  const pricingType = c.linePricingType;
  if (!pricingType) return true;
  // A custom cycle is priced like a month.
  if (pricingType === (cycle === "WEEKLY" ? "WEEKLY" : "MONTHLY")) return true;
  // Labelled otherwise, but priced by the order as one rate per unit.
  const rate = c.lineRate ?? 0;
  const qty = c.lineQuantity ?? 1;
  return rate > 0 && c.lineSubtotal !== null && Math.abs(c.lineSubtotal - rate * qty) < 0.01;
}

/** Revenue one checkout has earned for its unit. */
export function earnedRevenue(
  c: EarningCheckout,
  anchor: BillingAnchor,
  today: Date = businessToday(),
): number {
  const order = c.order;
  const charge = c.totalCharge || 0;
  if (
    !order ||
    !order.isRecurring ||
    order.notBilled ||
    order.reservationType === "RENT_TO_OWN"
  ) {
    return charge;
  }
  if (!ratePerPeriod(c, order.billingCycleType)) return charge;
  // The line's rate is what each period bills. A checkout with no priced line
  // behind it falls back to its own charge, taken as one period.
  const rate = c.lineRate && c.lineRate > 0 ? c.lineRate : charge;
  if (rate <= 0) return 0;
  return roundMoney(rate * Math.max(MINIMUM_PERIODS, earnedPeriods(c, anchor, today)));
}

export type OrderDiscount = { type: string | null; value: number };

/**
 * An order's checkouts net of its discount, given what each earned before it.
 * A percentage comes off each; a fixed amount comes off once, capped at what
 * the order earned, and shared by each checkout's part of that.
 */
export function applyOrderDiscount(gross: number[], discount: OrderDiscount): number[] {
  const value = discount.value || 0;
  if (value <= 0) return gross;
  if (discount.type === "PERCENTAGE") {
    const keep = 1 - Math.min(100, value) / 100;
    return gross.map((g) => roundMoney(g * keep));
  }
  if (discount.type === "FIXED") {
    const total = gross.reduce((a, g) => a + g, 0);
    if (total <= 0) return gross;
    const off = Math.min(value, total);
    return gross.map((g) => roundMoney(g - (off * g) / total));
  }
  return gross;
}
