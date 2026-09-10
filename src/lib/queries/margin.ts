import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";

/**
 * What the sale book makes, from the lines rather than from the columns.
 *
 * Three decisions here, and each one was wrong in the first draft. They are
 * written down because the numbers they produce differ by an order of
 * magnitude, and the wrong ones look perfectly plausible.
 *
 * **1. Sales only. Rentals have no cost of goods.**
 * A rental's hardware was bought once and earns many times, so measuring one
 * order's revenue against the purchase price of the kit is not margin — it is
 * a slice of an ROI calculation, and `queries/reports.getPricing` already
 * answers that properly with payback months. In this database 20 committed
 * rentals carry a `totalCost` and 19 of those are exactly zero, which is the
 * same convention stated in data: on a rental, margin is revenue. Summing
 * rentals and sales together would report the rental book's whole revenue as
 * profit.
 *
 * **2. The active package only.**
 * `Reservation.subtotal` sums *every* package on the order, including the
 * alternative configurations that were priced and not chosen. On the largest
 * committed sale here that is $385,219 of subtotal against an active package
 * worth $198,979 — the rejected alternative is the other $186,240. Any margin
 * computed from `Reservation.subtotal` is therefore nonsense, and this is the
 * same trap `queries/dashboard.ts` documents for the fleet ranking.
 *
 * **3. `Reservation.totalMargin` is right, and is still not summed here.**
 * It reconciles exactly against the active package once you know what it is
 * made of — `sales.ts:recalculateSaleMarginTotals` writes
 * `sum(active line subtotals) − totalCost`. But it is a *stored* figure,
 * written only by the sale actions, present on 68 of 149 orders and stale the
 * moment a line changes through any other path. The lines are the source, they
 * are cheap to read, and a figure derived at read time cannot go stale.
 *
 * What this cannot answer: whether a recorded cost is the true landed cost.
 * `costBasis` is what somebody typed. There is no vendor invoice, no landed
 * cost, no freight-in allocation in this schema.
 */

/** Committed: agreed to, not merely quoted. */
const COMMITTED = [...OPEN_STATUSES, "COMPLETED"] as const;

/**
 * Lines that carry the deal.
 *
 * Top-level and on the active package. Component sub-lines are excluded for the
 * reason the fleet ranking excludes them — the parent carries the quantity and
 * the price — and no nested line on a committed sale in this database carries a
 * cost basis at all, so nothing is lost by it today. Should that change, the
 * cost would be understated and this comment is the place it will be found.
 */
const SALE_LINES: Prisma.ReservationItemWhereInput = {
  parentId: null,
  package: { isActive: true },
  reservation: {
    status: { in: [...COMMITTED] },
    reservationType: { in: ["SALE", "RENT_TO_OWN"] },
  },
};

export type SaleMargin = {
  /** Committed sale-type orders behind these lines. */
  orders: number;
  /** Priced lines on those orders' active packages. */
  lines: number;
  /** Of those, how many record a cost. */
  costed: number;
  /** Revenue on the lines that record a cost — the only ones margin is read on. */
  revenue: number;
  cost: number;
  margin: number;
  /** Margin as a share of revenue, or null when there is no revenue to divide. */
  percent: number | null;
  /** Revenue on lines with no cost recorded. Outside every figure above. */
  uncostedRevenue: number;
  /**
   * Internal costs on those orders — sub-rental, hardware, shipping the
   * business swallows. `sales.ts` folds these into `totalCost`, so they are
   * counted here too rather than quietly dropped.
   */
  internalCost: number;
};

/**
 * `cache`d: the margin tile and any later money tile in the same render pass
 * should read the book once.
 */
export const getSaleMargin = cache(async function getSaleMargin(): Promise<SaleMargin> {
  const [lines, orders] = await Promise.all([
    prisma.reservationItem.findMany({
      where: SALE_LINES,
      select: {
        reservationId: true,
        quantity: true,
        subtotal: true,
        costBasis: true,
      },
    }),
    prisma.reservation.findMany({
      where: {
        status: { in: [...COMMITTED] },
        reservationType: { in: ["SALE", "RENT_TO_OWN"] },
      },
      select: {
        id: true,
        internalShippingCost: true,
        subRentalCost: true,
        hardwareCost: true,
      },
    }),
  ]);

  let revenue = 0;
  let cost = 0;
  let costed = 0;
  let uncostedRevenue = 0;

  for (const line of lines) {
    const subtotal = Number(line.subtotal);
    // A cost of zero is a recorded cost — a bundled service, a warranty line —
    // and is not the same fact as no cost recorded at all. `null` is the
    // absence, and only the absence is excluded from the margin.
    if (line.costBasis === null) {
      uncostedRevenue += subtotal;
      continue;
    }
    costed += 1;
    revenue += subtotal;
    cost += Number(line.costBasis) * line.quantity;
  }

  const internalCost = orders.reduce(
    (sum, order) =>
      sum +
      (Number(order.internalShippingCost) || 0) +
      (Number(order.subRentalCost) || 0) +
      (Number(order.hardwareCost) || 0),
    0,
  );

  const round = (value: number) => Math.round(value * 100) / 100;
  const totalCost = cost + internalCost;
  const margin = revenue - totalCost;

  return {
    orders: orders.length,
    lines: lines.length,
    costed,
    revenue: round(revenue),
    cost: round(totalCost),
    margin: round(margin),
    percent: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null,
    uncostedRevenue: round(uncostedRevenue),
    internalCost: round(internalCost),
  };
});
