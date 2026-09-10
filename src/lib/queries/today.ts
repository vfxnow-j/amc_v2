import { cache } from "react";
import { endOfDay, startOfDay } from "date-fns";
import type { Prisma, ReservationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Queries behind Operate → Today's movements.
 *
 * The screen is a queue, not a scanner: it says what needs hands, and every row
 * opens the order, where the units, the rates and the sign-off already live.
 * So everything here is read-only.
 *
 * "Today" is really "by now" in both directions — an order three weeks past its
 * ship date needs hands more urgently than one shipping this afternoon, and a
 * screen that showed only today's date would hide it.
 */

/** An order that hasn't reached its end state. */
const RUNNING_ORDER = {
  status: { notIn: ["COMPLETED", "CANCELLED", "LOST"] },
} satisfies Prisma.ReservationWhereInput;

/** Approved but not yet fully handed over. */
const PENDING_HANDOVER: ReservationStatus[] = [
  "APPROVED",
  "PREPARING",
  "SHIPPED",
];

function daysBetween(from: Date, to: Date) {
  return Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export type OutgoingRow = {
  reservationId: string;
  reservationNumber: string;
  clientName: string;
  projectName: string | null;
  /** Units still to pull: quantity ordered minus what's been checked out. */
  units: number;
  start: Date;
  status: ReservationStatus;
  /** 0 when it ships today; positive when the ship date has passed. */
  daysLate: number;
};

export type Outgoing = {
  rows: OutgoingRow[];
  /** Orders due out by now with units still to pull. */
  total: number;
  /** Of those, how many are past their ship date. */
  late: number;
  /** Due out later, deliberately not listed — the footer has to say so. */
  upcoming: number;
  /** Units still to pull across every listed order. */
  units: number;
};

/**
 * Orders that should be out of the door. Recurring orders are included: unlike
 * a return date, a recurring order's *start* is a real handover, and its units
 * have to be pulled exactly once.
 *
 * Outstanding units are computed from the line counts rather than by counting
 * `ReservationItemUnit` rows, because a line can be ordered without units
 * assigned yet — those are precisely the ones nobody has touched.
 */
/**
 * Wrapped in React `cache()` so one render pass runs it at most once. The
 * dashboard is a grid of independently-suspended tiles now, and more than one
 * of them can read the same figures — without this, placing both runs the same
 * query twice inside a single request. `queries/reports.ts` wraps its own for
 * the same reason.
 */
export const getOutgoing = cache(async function getOutgoing(
  now = new Date(),
  take = 12,
): Promise<Outgoing> {
  // Bounded by status, and a business only ever has so many orders mid-handover
  // at once — the outstanding sum needs the lines, so it's done here rather
  // than in SQL.
  const orders = await prisma.reservation.findMany({
    where: { status: { in: PENDING_HANDOVER } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      reservationNumber: true,
      startDate: true,
      status: true,
      projectName: true,
      client: { select: { name: true } },
      items: {
        // Asset-backed top-level lines only. Component sub-items are pricing
        // rows, and service or cloud lines have nothing to pull.
        where: { assetId: { not: null }, parentId: null },
        select: { quantity: true, checkedOutCount: true },
      },
    },
  });

  const cutoff = endOfDay(now);
  const outstanding = orders
    .map((order) => ({
      order,
      units: order.items.reduce(
        (sum, item) => sum + Math.max(0, item.quantity - item.checkedOutCount),
        0,
      ),
    }))
    .filter((entry) => entry.units > 0);

  const due = outstanding.filter((entry) => entry.order.startDate <= cutoff);
  const upcoming = outstanding.length - due.length;

  const rows: OutgoingRow[] = due.map(({ order, units }) => ({
    reservationId: order.id,
    reservationNumber: order.reservationNumber,
    clientName: order.client.name,
    projectName: order.projectName,
    units,
    start: order.startDate,
    status: order.status,
    daysLate: Math.max(0, daysBetween(order.startDate, now)),
  }));

  return {
    rows: rows.slice(0, take),
    total: rows.length,
    late: rows.filter((row) => row.daysLate > 0).length,
    upcoming,
    units: rows.reduce((sum, row) => sum + row.units, 0),
  };
});

export type IncomingRow = {
  reservationId: string;
  reservationNumber: string;
  clientName: string;
  projectName: string | null;
  /** Units still out on this order. */
  units: number;
  due: Date;
  daysLate: number;
};

export type Incoming = {
  rows: IncomingRow[];
  total: number;
  late: number;
  units: number;
  lateUnits: number;
};

/**
 * Orders with units due back. Recurring orders are excluded, and that exclusion
 * is the difference between a useful screen and a useless one: their `endDate`
 * is the end of the current billing period, not a return date, so a rolling
 * monthly contract reads as months overdue. In this data it is 35 units due
 * back rather than 213.
 */
export async function getIncoming(
  now = new Date(),
  take = 12,
): Promise<Incoming> {
  const where: Prisma.ReservationItemUnitWhereInput = {
    checkedOutAt: { not: null },
    checkedInAt: null,
    reservationItem: {
      reservation: {
        ...RUNNING_ORDER,
        isRecurring: false,
        endDate: { lte: endOfDay(now) },
      },
    },
  };

  const units = await prisma.reservationItemUnit.findMany({
    where,
    select: {
      id: true,
      reservationItem: {
        select: {
          reservation: {
            select: {
              id: true,
              reservationNumber: true,
              endDate: true,
              projectName: true,
              client: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Grouped in memory rather than with groupBy: the rows carry the client and
  // order number, which a grouped aggregate would need a second query to fetch.
  const byOrder = new Map<string, IncomingRow>();
  for (const unit of units) {
    const order = unit.reservationItem.reservation;
    const existing = byOrder.get(order.id);
    if (existing) {
      existing.units += 1;
      continue;
    }
    byOrder.set(order.id, {
      reservationId: order.id,
      reservationNumber: order.reservationNumber,
      clientName: order.client.name,
      projectName: order.projectName,
      units: 1,
      due: order.endDate,
      daysLate: Math.max(0, daysBetween(order.endDate, now)),
    });
  }

  // Latest first: the most overdue order is the one to chase.
  const rows = [...byOrder.values()].sort(
    (a, b) => b.daysLate - a.daysLate || a.due.getTime() - b.due.getTime(),
  );

  return {
    rows: rows.slice(0, take),
    total: rows.length,
    late: rows.filter((row) => row.daysLate > 0).length,
    units: units.length,
    lateUnits: rows
      .filter((row) => row.daysLate > 0)
      .reduce((sum, row) => sum + row.units, 0),
  };
}

/** The header card's one-line context blurb. */
export async function getTodayStats(now = new Date()) {
  const [outgoing, incoming] = await Promise.all([
    getOutgoing(now, 0),
    getIncoming(now, 0),
  ]);
  return {
    toPull: outgoing.units,
    toReceive: incoming.units,
    lateOut: outgoing.late,
    lateIn: incoming.late,
  };
}
