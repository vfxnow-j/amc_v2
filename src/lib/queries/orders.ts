import type { Prisma, ReservationType } from "@/generated/prisma/client";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { ORDER_TYPES } from "@/lib/orders/types";
import { prisma } from "@/lib/prisma";
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
 * checkout to its order's type and recognises sales at completion, so
 * RENT_TO_OWN and CLOUD only show earnings where the order is recurring or was
 * checked out. A type reading zero earned with orders open means the money
 * hasn't been recognised yet, not that the type is idle — which is exactly why
 * both figures are shown.
 */

export type TypeRevenue = {
  type: ReservationType;
  /** Accrual-basis revenue recognised inside the window. */
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

  const [earned, ...open] = await Promise.all([
    getEarnedRevenue(from, now),
    ...ORDER_TYPES.map((type) =>
      prisma.reservation.aggregate({
        where: openOfType(type),
        _sum: { total: true },
        _count: true,
      }),
    ),
  ]);

  const types = ORDER_TYPES.map((type, index) => ({
    type,
    earned: earned.byType[type] ?? 0,
    booked: Number(open[index]._sum.total ?? 0),
    openCount: open[index]._count,
  }));

  return {
    types,
    earnedTotal: types.reduce((sum, row) => sum + row.earned, 0),
    window: WINDOW_LABEL[range],
  };
}
