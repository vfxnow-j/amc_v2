import type { MaintenanceStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_CHECKOUT } from "@/lib/inventory/availability";
import { ARCHIVE_STATUSES, QUOTE_STATUSES } from "@/lib/reservations/status";
import { effectiveShipDate } from "@/lib/orders/shipping";
import { holidayOnLocal, type Holiday } from "@/lib/calendar/holidays";
import { clientContact, clientLabel } from "@/lib/clients/label";
import { businessToday } from "@/lib/billing/calendar";

/** Queries behind the Operate cluster and the Service center's maintenance log. */

export const PAGE_SIZE = 40;

/* ── Mobile scan ────────────────────────────────────────────────────────── */

/**
 * Resolve one scanned code to a unit.
 *
 * Matches barcode first and serial second, both exactly: a scanner emits the
 * whole code, and a fuzzy match here would resolve to the wrong unit — which on
 * this screen means telling somebody the wrong thing about hardware in their
 * hands.
 */
export async function findUnitByCode(code: string) {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const unit = await prisma.assetUnit.findFirst({
    where: { OR: [{ barcode: trimmed }, { serialNumber: trimmed }] },
    select: {
      id: true,
      barcode: true,
      serialNumber: true,
      status: true,
      condition: true,
      notes: true,
      asset: { select: { name: true, manufacturer: true, model: true } },
      location: { select: { name: true } },
      checkouts: {
        where: OPEN_CHECKOUT,
        orderBy: { checkoutDate: "desc" },
        take: 1,
        select: {
          checkoutDate: true,
          expectedReturn: true,
          client: { select: { name: true } },
          reservation: { select: { id: true, reservationNumber: true } },
        },
      },
      workOrders: {
        where: { status: { notIn: ["CLOSED_PASS", "CLOSED_SCRAP", "CLOSED_PARTED"] } },
        orderBy: { openedAt: "desc" },
        take: 1,
        select: { id: true, number: true, status: true, fault: true },
      },
    },
  });

  if (!unit) return null;

  const open = unit.checkouts[0] ?? null;
  return {
    id: unit.id,
    barcode: unit.barcode,
    serialNumber: unit.serialNumber,
    status: unit.status,
    condition: unit.condition,
    assetName: unit.asset.name,
    maker: [unit.asset.manufacturer, unit.asset.model].filter(Boolean).join(" ") || null,
    locationName: unit.location?.name ?? null,
    holder: open?.client.name ?? null,
    orderId: open?.reservation?.id ?? null,
    orderNumber: open?.reservation?.reservationNumber ?? null,
    outSince: open?.checkoutDate ?? null,
    dueBack: open?.expectedReturn ?? null,
    workOrder: unit.workOrders[0] ?? null,
  };
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

export type CalendarOrder = {
  id: string;
  reservationNumber: string;
  /** The company when recorded, else the client name (lib/clients/label). */
  clientName: string;
  /** The contact, when the label is a company — shown on hover. */
  contactName: string | null;
  /** Still at quote stage — the dates are proposed, not committed. */
  prospect: boolean;
  /** Ship entries: already shipped (history), or past the date and not shipped. */
  shipped?: boolean;
  late?: boolean;
};

export type CalendarDay = {
  date: Date;
  inMonth: boolean;
  going: CalendarOrder[];
  coming: CalendarOrder[];
  /** Quotes whose pricing stops being honored on this day. */
  expiring: CalendarOrder[];
  /** Orders that have to ship on this day to arrive for their start. */
  shipping: CalendarOrder[];
  /** A US holiday observed on this day. */
  holiday: Holiday | null;
};

/**
 * A month of movements, bucketed by day.
 *
 * Recurring orders are excluded from the "coming back" side: their `endDate` is
 * a billing-period boundary, not a return date, and counting them as returns
 * read 214 units overdue instead of 35 when the Overview made the same mistake.
 * They still appear on their start date, which is a real event. The same goes
 * for rent-to-own and cloud: only rentals have a return to show. A sale shows
 * neither — it has no term, only an order date — and appears on the calendar
 * solely as its quote expiry.
 *
 * Quote-stage orders still appear on their start and end dates, flagged
 * `prospect`, because a proposed movement is worth seeing — but it must not
 * read the same as a committed one. Their `quoteExpiresAt` is a third kind of
 * event: not a movement at all, and it used to be indistinguishable from a
 * return when the only thing a quote could show was its end date. Only
 * quote-stage orders carry one; an approved order's old expiry is history.
 */
export async function getCalendarMonth(year: number, month: number) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  // The grid runs Sunday-to-Saturday around the month, so the query has to
  // cover the leading and trailing days too.
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()) + 1);

  const inGrid = { gte: gridStart, lt: gridEnd };
  const select = {
    id: true,
    reservationNumber: true,
    status: true,
    startDate: true,
    endDate: true,
    quoteExpiresAt: true,
    client: { select: { name: true, companyName: true } },
  } as const;

  const [starting, ending, expiring] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        status: { notIn: ARCHIVE_STATUSES },
        startDate: inGrid,
        // A sale has no term, so no movement to show: only its quote expiry,
        // which is the prompt to follow up (owner, 2026-09-16).
        reservationType: { not: "SALE" },
      },
      select,
    }),
    prisma.reservation.findMany({
      where: {
        status: { notIn: ARCHIVE_STATUSES },
        endDate: inGrid,
        isRecurring: false,
        // Only a rental comes back. A sale's endDate is a v1 default of start
        // plus 30 days, rent-to-own ends in ownership, and cloud ships nothing
        // — showing any of them as a return put inbound arrows on draft sales.
        reservationType: "RENTAL",
      },
      select,
    }),
    prisma.reservation.findMany({
      where: { status: { in: QUOTE_STATUSES }, quoteExpiresAt: inGrid },
      select,
    }),
  ]);

  // Ship dates fall before the start, by up to a couple of weeks for standard
  // freight over a weekend, so the start window reaches past the grid. The
  // exact day is worked out per order and filtered back into the grid below.
  const shipWindowEnd = new Date(gridEnd);
  shipWindowEnd.setDate(shipWindowEnd.getDate() + 16);
  const shippable = await prisma.reservation.findMany({
    where: {
      status: { notIn: ["CANCELLED", "LOST"] },
      OR: [
        { shipDate: inGrid },
        { shipDate: null, shipSpeed: { not: null }, startDate: { gte: gridStart, lt: shipWindowEnd } },
      ],
    },
    select: { ...select, shipSpeed: true, shipDate: true },
  });

  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  function bucket(
    orders: typeof starting,
    dateOf: (order: (typeof starting)[number]) => Date | null,
  ) {
    const byDay = new Map<string, CalendarOrder[]>();
    for (const order of orders) {
      const date = dateOf(order);
      if (!date) continue;
      const list = byDay.get(key(date)) ?? [];
      list.push({
        id: order.id,
        reservationNumber: order.reservationNumber,
        clientName: clientLabel(order.client),
        contactName: clientContact(order.client),
        prospect: QUOTE_STATUSES.includes(order.status),
      });
      byDay.set(key(date), list);
    }
    return byDay;
  }

  const goingByDay = bucket(starting, (order) => order.startDate);
  const comingByDay = bucket(ending, (order) => order.endDate);
  const expiringByDay = bucket(expiring, (order) => order.quoteExpiresAt);

  const today = businessToday();
  const shippingByDay = new Map<string, CalendarOrder[]>();
  for (const order of shippable) {
    const ship = effectiveShipDate(order);
    if (!ship || ship.date < gridStart || ship.date >= gridEnd) continue;
    const shipped = ["SHIPPED", "ACTIVE", "COMPLETED"].includes(order.status);
    const list = shippingByDay.get(key(ship.date)) ?? [];
    list.push({
      id: order.id,
      reservationNumber: order.reservationNumber,
      clientName: clientLabel(order.client),
        contactName: clientContact(order.client),
      prospect: QUOTE_STATUSES.includes(order.status),
      shipped,
      late: !shipped && ship.date < today,
    });
    shippingByDay.set(key(ship.date), list);
  }

  const days: CalendarDay[] = [];
  for (
    let cursor = new Date(gridStart);
    cursor < gridEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const date = new Date(cursor);
    days.push({
      date,
      inMonth: date.getMonth() === month,
      going: goingByDay.get(key(date)) ?? [],
      coming: comingByDay.get(key(date)) ?? [],
      expiring: expiringByDay.get(key(date)) ?? [],
      shipping: shippingByDay.get(key(date)) ?? [],
      holiday: holidayOnLocal(date),
    });
  }

  return { days, monthStart };
}

/* ── Services ───────────────────────────────────────────────────────────── */

export async function getServices() {
  const records = await prisma.service.findMany({
    // Grouped by kind, then named. The catalogue reads as three short lists
    // rather than one alphabetical one, which is the whole point of the column.
    orderBy: [{ kind: "asc" }, { active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      defaultRate: true,
      unit: true,
      kind: true,
      active: true,
      _count: { select: { items: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    defaultRate: Number(record.defaultRate),
    unit: record.unit,
    kind: record.kind,
    active: record.active,
    timesOrdered: record._count.items,
  }));
}

/* ── Maintenance log ────────────────────────────────────────────────────── */

const MAINTENANCE_VIEW_STATUS: Record<string, MaintenanceStatus[] | null> = {
  open: ["SCHEDULED", "IN_PROGRESS"],
  completed: ["COMPLETED"],
  all: null,
};

export async function getMaintenanceRecords({
  view = "open",
  page = 1,
}: { view?: string; page?: number } = {}) {
  const statuses = MAINTENANCE_VIEW_STATUS[view] ?? null;
  const where: Prisma.MaintenanceRecordWhereInput = statuses
    ? { status: { in: statuses } }
    : {};

  const [records, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        type: true,
        status: true,
        description: true,
        scheduledDate: true,
        completionDate: true,
        totalCost: true,
        performedBy: true,
        createdAt: true,
        assetUnit: {
          select: { id: true, barcode: true, asset: { select: { name: true } } },
        },
      },
    }),
    prisma.maintenanceRecord.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      type: record.type,
      status: record.status,
      description: record.description,
      when: record.completionDate ?? record.scheduledDate ?? record.createdAt,
      cost: record.totalCost === null ? null : Number(record.totalCost),
      performedBy: record.performedBy,
      barcode: record.assetUnit.barcode,
      assetName: record.assetUnit.asset.name,
    })),
  };
}

export async function getMaintenanceCounts() {
  const [open, completed, all] = await Promise.all([
    prisma.maintenanceRecord.count({
      where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    }),
    prisma.maintenanceRecord.count({ where: { status: "COMPLETED" } }),
    prisma.maintenanceRecord.count(),
  ]);
  return { open, completed, all };
}
