import { startOfDay } from "date-fns";
import type { Prisma, ReservationStatus, ReservationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ARCHIVE_STATUSES,
  OPEN_STATUSES,
  QUOTE_STATUSES,
} from "@/lib/reservations/status";
import { VIEWS, type View } from "@/lib/reservations/views";
import { typeForFilter, type TypeFilter } from "@/lib/orders/types";

/**
 * Queries behind Operate → Orders, the hub the whole app orbits.
 *
 * Purpose-built rather than reusing `actions/reservations.getReservations`,
 * which loads every line and every line's asset and category for every order,
 * has no pagination, and silently excludes sales. The hub needs seven columns
 * and a page of rows.
 *
 * Two independent axes, and they compose: `view` is where the order is in its
 * life (open, out now, quotes, archive) and `type` is what kind of order it is
 * (rental, sale, rent-to-own, cloud). Every count, page and total below honours
 * both, so "quotes" and "sales" never disagree about the same order.
 *
 * The model is still called `Reservation` — renaming it is a database migration
 * across 47 files, not a rename — but nothing the user reads says so.
 */

/** Units checked out on this order and not yet back. */
const UNITS_OUT: Prisma.ReservationItemUnitWhereInput = {
  checkedOutAt: { not: null },
  checkedInAt: null,
};

function viewWhere(view: View): Prisma.ReservationWhereInput {
  switch (view) {
    case "open":
      return { status: { in: OPEN_STATUSES } };
    case "out-now":
      // Physically out, whatever the paperwork says. This is what v1's
      // /dashboard/checkouts list was for.
      return {
        status: { notIn: ARCHIVE_STATUSES },
        items: { some: { units: { some: UNITS_OUT } } },
      };
    case "quotes":
      return { status: { in: QUOTE_STATUSES } };
    case "archive":
      return { status: { in: ARCHIVE_STATUSES } };
    case "all":
      return {};
  }
}

function typeWhere(type: TypeFilter): Prisma.ReservationWhereInput {
  const member = typeForFilter(type);
  return member ? { reservationType: member } : {};
}

function searchWhere(search: string): Prisma.ReservationWhereInput {
  const contains = { contains: search, mode: "insensitive" } as const;
  return {
    OR: [
      { reservationNumber: contains },
      { projectName: contains },
      { projectCode: contains },
      { client: { name: contains } },
      { client: { companyName: contains } },
    ],
  };
}

/**
 * The whole filter, assembled once. The counts, the page of rows and the
 * totals all come through here — a tab that counted on a different clause from
 * the table underneath it is exactly the drift the app's "a record and its list
 * must never disagree" rule exists to prevent.
 */
function listWhere(
  view: View,
  type: TypeFilter,
  search: string,
): Prisma.ReservationWhereInput {
  const clauses = [viewWhere(view), typeWhere(type)];
  if (search) clauses.push(searchWhere(search));
  return { AND: clauses };
}

export type ReservationRow = {
  id: string;
  reservationNumber: string;
  type: ReservationType;
  clientName: string;
  projectName: string | null;
  start: Date;
  end: Date;
  status: ReservationStatus;
  isRecurring: boolean;
  /** Units ordered across asset-backed lines. */
  unitsOrdered: number;
  /** Units currently out. */
  unitsOut: number;
  value: number;
  /**
   * Past its return date with units still out. Recurring orders can't be late
   * this way — their endDate is a billing period end, not a return date.
   */
  isLate: boolean;
};

export type ReservationList = {
  rows: ReservationRow[];
  total: number;
  page: number;
  pageSize: number;
};

export const PAGE_SIZE = 40;

/**
 * Row counts per tab. Separate from the list query so the tabs can render in
 * the header card while the table is still streaming — they answer "where is
 * there work", which shouldn't wait on a page of rows.
 */
export async function getViewCounts(
  search = "",
  type: TypeFilter = "all",
): Promise<Record<View, number>> {
  const counts = await Promise.all(
    VIEWS.map((view) =>
      prisma.reservation.count({ where: listWhere(view, type, search) }),
    ),
  );
  return Object.fromEntries(
    VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<View, number>;
}

export async function getReservationList({
  view = "open",
  type = "all",
  search = "",
  page = 1,
  now = new Date(),
}: {
  view?: View;
  type?: TypeFilter;
  search?: string;
  page?: number;
  now?: Date;
} = {}): Promise<ReservationList> {
  const where = listWhere(view, type, search);

  const [records, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      // Most recent window first: the hub is a working list, not an archive.
      orderBy: [{ startDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reservationNumber: true,
        reservationType: true,
        startDate: true,
        endDate: true,
        status: true,
        isRecurring: true,
        projectName: true,
        total: true,
        client: { select: { name: true } },
        items: {
          where: { assetId: { not: null }, parentId: null },
          select: {
            quantity: true,
            _count: { select: { units: { where: UNITS_OUT } } },
          },
        },
      },
    }),
    prisma.reservation.count({ where }),
  ]);

  const dayStart = startOfDay(now);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => {
      const unitsOut = record.items.reduce(
        (sum, item) => sum + item._count.units,
        0,
      );
      return {
        id: record.id,
        reservationNumber: record.reservationNumber,
        type: record.reservationType,
        clientName: record.client.name,
        projectName: record.projectName,
        start: record.startDate,
        end: record.endDate,
        status: record.status,
        isRecurring: record.isRecurring,
        unitsOrdered: record.items.reduce((sum, item) => sum + item.quantity, 0),
        unitsOut,
        value: Number(record.total),
        isLate:
          !record.isRecurring && unitsOut > 0 && record.endDate < dayStart,
      };
    }),
  };
}

/** The header card's one-line context blurb. */
export async function getReservationHeaderStats() {
  const [open, booked] = await Promise.all([
    prisma.reservation.count({ where: { status: { in: OPEN_STATUSES } } }),
    prisma.reservation.aggregate({
      _sum: { total: true },
      where: { status: { in: OPEN_STATUSES } },
    }),
  ]);
  return { open, booked: Number(booked._sum.total ?? 0) };
}
