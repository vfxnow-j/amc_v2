import { cache } from "react";
import type { Prisma, ReservationType } from "@/generated/prisma/client";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { ORDER_TYPES } from "@/lib/orders/types";
import { prisma } from "@/lib/prisma";
import { orderValues, sumOrderValue } from "./order-value";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import { windowFor, type Range } from "@/lib/queries/range";

/**
 * The per-type strip across the top of Operate → Orders: where the money is
 * coming from, split the way the orders themselves are split.
 *
 * Two figures per type, because they answer different questions and conflating
 * them is how a revenue number becomes a lie:
 *
 * - **earned** — accrual-basis revenue in the selected window, straight from
 *   `lib/analytics/earned-revenue`. Not invoiced revenue: recurring billing
 *   stalls and invoices sit in DRAFT, so an invoice-based figure understates
 *   what the business actually earned. This is the "revenue stream" figure.
 * - **booked** — the value of orders of this type that are open right now.
 *   Future money, not earned money. It is on the card because a type can be
 *   quiet this month and still be carrying the pipeline.
 *
 * The caveat worth knowing before quoting these: `byType` attributes a rental
 * checkout to its order's type and recognizes sales at completion, so
 * RENT_TO_OWN and CLOUD only show earnings where the order is recurring or was
 * checked out. A type reading zero earned with orders open means the money
 * hasn't been recognized yet, not that the type is idle — which is exactly why
 * both figures are shown.
 */

export type TypeRevenue = {
  type: ReservationType;
  /** Accrual-basis revenue recognized inside the window. */
  earned: number;
  /** Value of orders of this type that are open now. */
  booked: number;
  /** How many those are. */
  openCount: number;
};

export type OrderRevenue = {
  types: TypeRevenue[];
  /** The four `earned` figures summed — the same total the Overview shows. */
  earnedTotal: number;
  /** "this month" / "this week" / "today", for the strip's caption. */
  window: string;
};

const WINDOW_LABEL: Record<Range, string> = {
  today: "today",
  week: "this week",
  month: "this month",
};

export async function getRevenueByType(
  range: Range = "month",
  now = new Date(),
): Promise<OrderRevenue> {
  const { from } = windowFor(range, now);

  const openOfType = (type: ReservationType): Prisma.ReservationWhereInput => ({
    reservationType: type,
    status: { in: OPEN_STATUSES },
  });

  // Booked is valued from the approved package rather than the stored total —
  // see `queries/order-value` for the two ways that column is wrong.
  const [earned, ...open] = await Promise.all([
    getEarnedRevenue(from, now),
    ...ORDER_TYPES.map((type) => sumOrderValue(openOfType(type))),
  ]);

  const types = ORDER_TYPES.map((type, index) => ({
    type,
    earned: earned.byType[type] ?? 0,
    booked: open[index].total,
    openCount: open[index].count,
  }));

  return {
    types,
    earnedTotal: types.reduce((sum, row) => sum + row.earned, 0),
    window: WINDOW_LABEL[range],
  };
}

// ---------------------------------------------------------------------------
// The billing book
// ---------------------------------------------------------------------------

export type BillingBook = {
  /** Active orders that bill again on a cycle. */
  recurring: {
    count: number;
    /** The order value carried by them. Not per-cycle — see the note below. */
    value: number;
    /** Billing on or before the next seven days. */
    dueSoon: number;
    /** Recurring, active, and with no next billing date — the run skips these. */
    stalled: number;
  };
  /** Committed orders that bill once. */
  oneTime: {
    count: number;
    value: number;
    /** Of those, how many have had nothing raised against them yet. */
    uninvoiced: number;
    uninvoicedValue: number;
  };
  /** Committed orders deliberately never invoiced. */
  notBilled: { count: number; value: number };
};

/**
 * Recurring against one-time, across the committed book.
 *
 * The question this answers is the one the type cards cannot: of everything
 * live, how much bills again by itself and how much has to be raised by hand.
 * They are different businesses — one is a subscription book that keeps
 * earning while nobody touches it, the other is a queue of invoices somebody
 * has to remember.
 *
 * Two limits, stated rather than smoothed over:
 *
 * - **`value` is the order's total, not a per-cycle figure.** A recurring
 *   order's `total` is what the whole term is worth, and no column holds "what
 *   one cycle costs" — `runBillingCycle` derives it from the lines at billing
 *   time. Summing totals and calling it MRR would be a fabricated number of
 *   exactly the kind the loanAmount trap produced, so it is labelled as
 *   contract value and left alone.
 * - **`stalled` is a real fault, not a rounding**. `runBillingCycle` filters on
 *   `nextBillingDate: { lte: now }`, so a recurring order with a null date is
 *   never picked up and never bills. It is counted because nothing else counts
 *   it.
 */
/**
 * Wrapped in React `cache()` so one render pass runs it at most once. The
 * dashboard is a grid of independently-suspended tiles now, and more than one
 * of them can read the same figures — without this, placing both runs the same
 * query twice inside a single request. `queries/reports.ts` wraps its own for
 * the same reason.
 */
export const getBillingBook = cache(async function getBillingBook(now = new Date()): Promise<BillingBook> {
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 7);

  const committed: Prisma.ReservationWhereInput = {
    status: { in: OPEN_STATUSES },
  };
  const recurring: Prisma.ReservationWhereInput = {
    ...committed,
    notBilled: false,
    isRecurring: true,
    billingCycleType: { not: "ONE_TIME" },
  };
  const oneTime: Prisma.ReservationWhereInput = {
    ...committed,
    notBilled: false,
    OR: [{ billingCycleType: "ONE_TIME" }, { isRecurring: false }],
  };

  const [recurringAgg, dueSoon, stalled, oneTimeAgg, oneTimeRows, invoiced, notBilledAgg] =
    await Promise.all([
      sumOrderValue(recurring),
      prisma.reservation.count({
        where: { ...recurring, nextBillingDate: { lte: soon, not: null } },
      }),
      prisma.reservation.count({ where: { ...recurring, nextBillingDate: null } }),
      sumOrderValue(oneTime),
      orderValues(oneTime),
      prisma.invoice.groupBy({
        by: ["reservationId"],
        where: {
          reservationId: { not: null },
          status: { notIn: ["VOID", "CANCELLED"] },
        },
        _count: true,
      }),
      sumOrderValue({ ...committed, notBilled: true }),
    ]);

  const hasInvoice = new Set(invoiced.map((row) => row.reservationId));
  const bare = oneTimeRows.filter((row) => !hasInvoice.has(row.id));

  return {
    recurring: {
      count: recurringAgg.count,
      value: recurringAgg.total,
      dueSoon,
      stalled,
    },
    oneTime: {
      count: oneTimeAgg.count,
      value: oneTimeAgg.total,
      uninvoiced: bare.length,
      uninvoicedValue: bare.reduce((sum, row) => sum + row.total, 0),
    },
    notBilled: {
      count: notBilledAgg.count,
      value: notBilledAgg.total,
    },
  };
});
