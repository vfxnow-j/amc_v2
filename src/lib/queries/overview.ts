import { endOfDay, startOfDay } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { getInsightsInternal, type Insight } from "@/lib/analytics/insights";
import { percentChange } from "@/lib/analytics/statistics";
import { windowFor, type Range } from "@/lib/queries/range";

/**
 * Queries behind Insight → Overview.
 *
 * Read-only and session-free on purpose: v2 has no auth yet, so these sit
 * alongside `lib/analytics` rather than inside it. When the login flow is
 * ported, the shell layout gates the route and `getDecisions` moves from
 * `getInsightsInternal()` to the auth-checked `getInsights()`.
 */

const RUNNING_ORDER = {
  status: { notIn: ["COMPLETED", "CANCELLED", "LOST"] },
} satisfies Prisma.ReservationWhereInput;

/**
 * A unit is out when it has been checked out, not yet checked back in, and its
 * order is still running. The status filter matters: a handful of units sit on
 * COMPLETED orders without a check-in, and counting those inflates "on rent".
 */
const ON_RENT: Prisma.ReservationItemUnitWhereInput = {
  checkedOutAt: { not: null },
  checkedInAt: null,
  reservationItem: { reservation: RUNNING_ORDER },
};

/**
 * Recurring orders are excluded from anything "due": their endDate is the end
 * of the current billing period, not a return date, so a rolling monthly
 * contract reads as months overdue and swamps the real returns. In this data
 * that is the difference between 213 overdue units and 35.
 */
function dueBackWhere(
  reservation: Prisma.ReservationWhereInput,
): Prisma.ReservationItemUnitWhereInput {
  return {
    checkedOutAt: { not: null },
    checkedInAt: null,
    reservationItem: {
      reservation: { ...RUNNING_ORDER, isRecurring: false, ...reservation },
    },
  };
}

function overdueWhere(now: Date) {
  return dueBackWhere({ endDate: { lt: startOfDay(now) } });
}

/**
 * A percentage only survives if both windows have enough in them to compare.
 * Beyond this the number is arithmetically true and practically meaningless,
 * so the card says what the money is made of instead.
 */
const MAX_MEANINGFUL_CHANGE = 300;

function comparableChange(previous: number, current: number): number | null {
  if (previous <= 0) return null;
  const change = percentChange(previous, current);
  return Math.abs(change) > MAX_MEANINGFUL_CHANGE ? null : change;
}

export type Kpis = {
  /**
   * No delta: utilisation is derived from current unit state, and nothing in
   * the schema snapshots it over time, so "+2.1 pts" from the reference can't
   * be computed honestly. It needs a daily rollup before that pill means
   * anything.
   */
  utilisation: { percent: number };
  /** Earned in the selected window, against the same slice of the previous one. */
  revenue: {
    earned: number;
    /**
     * Null when the comparison would mislead. Recurring cycles accrue in lumps
     * at period boundaries, so a short window that happens to contain one reads
     * as +4600% against a window that didn't — true arithmetic, useless signal.
     */
    change: number | null;
    /** "last month" / "last week" / "yesterday" — the pill has to say so. */
    comparedTo: string;
    /** Falls back to composition when a comparison isn't worth showing. */
    recurring: number;
  };
  units: { onRent: number; total: number };
  overdue: { units: number };
};

export async function getKpis(
  range: Range = "month",
  now = new Date(),
): Promise<Kpis> {
  const period = windowFor(range, now);

  const [rentableUnits, onRent, overdue, earned] = await Promise.all([
    // Retired and sold units aren't capacity, so they can't dilute utilisation.
    prisma.assetUnit.count({
      where: { status: { notIn: ["RETIRED", "SOLD"] } },
    }),
    prisma.reservationItemUnit.count({ where: ON_RENT }),
    prisma.reservationItemUnit.count({
      where: overdueWhere(now),
    }),
    getEarnedRevenue(period.from, now),
  ]);

  // Compares the same slice of the previous period, so a reading taken on the
  // 3rd isn't measured against a full month.
  const previousEarned = await getEarnedRevenue(
    period.previousFrom,
    period.previousTo,
  );

  return {
    utilisation: {
      percent: rentableUnits === 0 ? 0 : (onRent / rentableUnits) * 100,
    },
    revenue: {
      earned: earned.total,
      change: comparableChange(previousEarned.total, earned.total),
      comparedTo: period.comparedTo,
      recurring: earned.recurring,
    },
    units: { onRent, total: rentableUnits },
    overdue: { units: overdue },
  };
}

/** The header card's one-line context blurb. */
export async function getHeaderStats() {
  const [openOrders, booked] = await Promise.all([
    prisma.reservation.count({
      where: { status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] } },
    }),
    prisma.reservation.aggregate({
      _sum: { total: true },
      where: { status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] } },
    }),
  ]);

  return { openOrders, booked: Number(booked._sum.total ?? 0) };
}

/**
 * The "Needs a decision" card. `getInsightsInternal` is the session-free
 * variant; swap to `getInsights()` once the route is behind auth.
 */
export async function getDecisions(take = 2): Promise<Insight[]> {
  const insights = await getInsightsInternal();
  const rank = { high: 0, medium: 1, low: 2 };
  return insights
    .filter((insight) => insight.category !== "system")
    .sort((a, b) => rank[a.priority] - rank[b.priority])
    .slice(0, take);
}

export type DueBackRow = {
  id: string;
  unitLabel: string;
  assetName: string;
  clientName: string;
  due: Date;
  isLate: boolean;
  reservationId: string;
};

/**
 * Units due back today or already overdue, soonest first — the warehouse
 * lead's "what needs hands today" list.
 */
export async function getDueBack(
  now = new Date(),
  take = 14,
): Promise<{ rows: DueBackRow[]; total: number; late: number }> {
  const where = dueBackWhere({ endDate: { lte: endOfDay(now) } });

  const [records, total, late] = await Promise.all([
    prisma.reservationItemUnit.findMany({
      where,
      take,
      orderBy: { reservationItem: { reservation: { endDate: "asc" } } },
      select: {
        id: true,
        assetUnit: {
          select: {
            barcode: true,
            serialNumber: true,
            asset: { select: { name: true } },
          },
        },
        reservationItem: {
          select: {
            reservation: {
              select: {
                id: true,
                endDate: true,
                client: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.reservationItemUnit.count({ where }),
    prisma.reservationItemUnit.count({ where: overdueWhere(now) }),
  ]);

  const dayStart = startOfDay(now);

  return {
    total,
    late,
    rows: records.map((record) => {
      const reservation = record.reservationItem.reservation;
      return {
        id: record.id,
        unitLabel: record.assetUnit.serialNumber ?? record.assetUnit.barcode,
        assetName: record.assetUnit.asset.name,
        clientName: reservation.client.name,
        due: reservation.endDate,
        isLate: reservation.endDate < dayStart,
        reservationId: reservation.id,
      };
    }),
  };
}
