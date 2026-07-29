import { endOfDay, startOfDay, startOfMonth, subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getEarnedRevenue } from "@/lib/analytics/earned-revenue";
import { percentChange } from "@/lib/analytics/statistics";

/**
 * Queries behind Insight → Overview.
 *
 * Read-only and session-free on purpose: v2 has no auth yet, so these sit
 * alongside `lib/analytics` rather than inside it. When the login flow is
 * ported, the shell layout gates the route and the insights call below moves
 * from `getInsightsInternal()` to the auth-checked `getInsights()`.
 */

/** A unit is out when it has been checked out and not yet checked back in. */
const ON_RENT = { checkedOutAt: { not: null }, checkedInAt: null } as const;

export type Kpis = {
  /**
   * No delta: utilisation is derived from current unit state, and nothing in
   * the schema snapshots it over time, so "+2.1 pts" from the reference can't
   * be computed honestly. It needs a daily rollup before that pill means
   * anything.
   */
  utilisation: { percent: number };
  /** Month to date, against the same slice of last month. */
  revenue: { earnedMtd: number; changeOnLastMonth: number | null };
  units: { onRent: number; total: number };
  overdue: { units: number };
};

export async function getKpis(now = new Date()): Promise<Kpis> {
  const monthStart = startOfMonth(now);
  const previousMonthStart = startOfMonth(subMonths(now, 1));

  const [rentableUnits, onRent, overdue, earned] = await Promise.all([
    // Retired and sold units aren't capacity, so they can't dilute utilisation.
    prisma.assetUnit.count({
      where: { status: { notIn: ["RETIRED", "SOLD"] } },
    }),
    prisma.reservationItemUnit.count({ where: ON_RENT }),
    prisma.reservationItemUnit.count({
      where: {
        ...ON_RENT,
        reservationItem: { reservation: { endDate: { lt: startOfDay(now) } } },
      },
    }),
    getEarnedRevenue(monthStart, now),
  ]);

  // Compares the same slice of the previous month, so a reading taken on the
  // 3rd isn't measured against a full month.
  const previousEarned = await getEarnedRevenue(
    previousMonthStart,
    subMonths(now, 1),
  );

  return {
    utilisation: {
      percent: rentableUnits === 0 ? 0 : (onRent / rentableUnits) * 100,
    },
    revenue: {
      earnedMtd: earned.total,
      changeOnLastMonth:
        previousEarned.total > 0
          ? percentChange(previousEarned.total, earned.total)
          : null,
    },
    units: { onRent, total: rentableUnits },
    overdue: { units: overdue },
  };
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
  const where = {
    ...ON_RENT,
    reservationItem: { reservation: { endDate: { lte: endOfDay(now) } } },
  };

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
    prisma.reservationItemUnit.count({
      where: {
        ...ON_RENT,
        reservationItem: { reservation: { endDate: { lt: startOfDay(now) } } },
      },
    }),
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
