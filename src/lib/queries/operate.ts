import type { MaintenanceStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_CHECKOUT } from "@/lib/inventory/availability";
import { ARCHIVE_STATUSES } from "@/lib/reservations/status";

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
        where: { status: { notIn: ["CLOSED_PASS", "CLOSED_SCRAP"] } },
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

export type CalendarDay = {
  date: Date;
  inMonth: boolean;
  going: { id: string; reservationNumber: string; clientName: string }[];
  coming: { id: string; reservationNumber: string; clientName: string }[];
};

/**
 * A month of movements, bucketed by day.
 *
 * Recurring orders are excluded from the "coming back" side: their `endDate` is
 * a billing-period boundary, not a return date, and counting them as returns
 * read 214 units overdue instead of 35 when the Overview made the same mistake.
 * They still appear on their start date, which is a real event.
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

  const [starting, ending] = await Promise.all([
    prisma.reservation.findMany({
      where: { status: { notIn: ARCHIVE_STATUSES }, startDate: inGrid },
      select: {
        id: true,
        reservationNumber: true,
        startDate: true,
        client: { select: { name: true } },
      },
    }),
    prisma.reservation.findMany({
      where: {
        status: { notIn: ARCHIVE_STATUSES },
        endDate: inGrid,
        isRecurring: false,
      },
      select: {
        id: true,
        reservationNumber: true,
        endDate: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  const goingByDay = new Map<string, CalendarDay["going"]>();
  for (const order of starting) {
    const list = goingByDay.get(key(order.startDate)) ?? [];
    list.push({
      id: order.id,
      reservationNumber: order.reservationNumber,
      clientName: order.client.name,
    });
    goingByDay.set(key(order.startDate), list);
  }

  const comingByDay = new Map<string, CalendarDay["coming"]>();
  for (const order of ending) {
    const list = comingByDay.get(key(order.endDate)) ?? [];
    list.push({
      id: order.id,
      reservationNumber: order.reservationNumber,
      clientName: order.client.name,
    });
    comingByDay.set(key(order.endDate), list);
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
    });
  }

  return { days, monthStart };
}

/* ── Packages ───────────────────────────────────────────────────────────── */

/**
 * Packages are per-order shipping groups, not reusable kit templates.
 *
 * Worth stating because the rail label invites the other reading: `Package`
 * hangs off a single `Reservation` and groups that order's lines for delivery,
 * with its own delivery and return cost. There is no bundle catalog in the
 * schema, and this screen does not imply one.
 */
export async function getPackages({ page = 1 }: { page?: number } = {}) {
  const [records, total] = await Promise.all([
    prisma.package.findMany({
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        deliveryCost: true,
        returnCost: true,
        reservation: {
          select: {
            id: true,
            reservationNumber: true,
            status: true,
            client: { select: { name: true } },
          },
        },
        _count: { select: { items: true } },
      },
    }),
    prisma.package.count(),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      name: record.name,
      description: record.description,
      isActive: record.isActive,
      deliveryCost:
        record.deliveryCost === null ? null : Number(record.deliveryCost),
      returnCost: record.returnCost === null ? null : Number(record.returnCost),
      orderId: record.reservation.id,
      orderNumber: record.reservation.reservationNumber,
      orderStatus: record.reservation.status,
      clientName: record.reservation.client.name,
      items: record._count.items,
    })),
  };
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
