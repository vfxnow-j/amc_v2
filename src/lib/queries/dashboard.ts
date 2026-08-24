import type { Prisma, ReservationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_STATUSES } from "@/lib/reservations/status";
import { OPEN_WORK_ORDER_STATUSES } from "@/lib/service/statuses";

/**
 * Queries behind the pinned Dashboard — the whole business on one screen.
 *
 * Everything here is grounded in the order book (`ReservationItem`) rather than
 * in the per-unit counters on `AssetUnit`. That is a deliberate choice, and the
 * data is why: `AssetUnit.totalRevenue` is populated on 325 of 2,616 units and
 * sums to $161k across the entire fleet, against millions actually earned. It
 * is a counter nothing reliably maintains, and ranking the fleet by it would
 * put the wrong hardware at the top of the screen with total confidence.
 *
 * The order book is the opposite: 116 orders, 250 asset-backed lines, and every
 * one written when somebody agreed to pay for something.
 */

/** Committed, not merely quoted: what was actually agreed to. */
const BOOKED_STATUSES: ReservationStatus[] = [...OPEN_STATUSES, "COMPLETED"];

/**
 * Lines that count toward demand.
 *
 * An order can hold several priced configurations and exactly one `Package`
 * carries `isActive` — 28 of the 250 asset-backed lines here sit on alternatives
 * that were priced and not chosen, across 15 orders. Counting those would let a
 * rejected option inflate an asset's ranking. Nested component lines are
 * excluded for the same reason twice over: their parent already carries the
 * quantity.
 */
const COUNTED_LINES: Prisma.ReservationItemWhereInput = {
  assetId: { not: null },
  parentId: null,
  package: { isActive: true },
  reservation: { status: { in: BOOKED_STATUSES } },
};

export type ItemRow = {
  assetId: string;
  name: string;
  category: string | null;
  /** Order lines this asset has appeared on. */
  orders: number;
  /** Units booked across those lines. */
  units: number;
  /** What those lines were priced at. */
  booked: number;
  /** Units in the fleet now, excluding retired and sold. */
  fleet: number;
};

async function decorate(
  rows: { assetId: string; orders: number; units: number; booked: number }[],
): Promise<ItemRow[]> {
  if (rows.length === 0) return [];
  const assets = await prisma.asset.findMany({
    where: { id: { in: rows.map((row) => row.assetId) } },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      _count: { select: { units: { where: { status: { notIn: ["RETIRED", "SOLD"] } } } } },
    },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  return rows.flatMap((row) => {
    const asset = byId.get(row.assetId);
    if (!asset) return [];
    return [
      {
        ...row,
        name: asset.name,
        category: asset.category?.name ?? null,
        fleet: asset._count.units,
      },
    ];
  });
}

/**
 * What the business actually rents and sells, by the money it was booked for.
 *
 * Ranked on booked value rather than line count: an asset that goes out ten
 * times at $50 is a different business from one that goes out twice at $20,000,
 * and the screen is answering "where does the money come from".
 */
export async function getTopItems(take = 6): Promise<ItemRow[]> {
  const grouped = await prisma.reservationItem.groupBy({
    by: ["assetId"],
    where: COUNTED_LINES,
    _sum: { subtotal: true, quantity: true },
    _count: { _all: true },
    orderBy: { _sum: { subtotal: "desc" } },
    take,
  });

  return decorate(
    grouped.map((row) => ({
      assetId: row.assetId as string,
      orders: row._count._all,
      units: row._sum.quantity ?? 0,
      booked: Number(row._sum.subtotal ?? 0),
    })),
  );
}

export type IdleRow = {
  assetId: string;
  name: string;
  category: string | null;
  /** Units sitting in the fleet with nothing booked against them. */
  fleet: number;
  /** What those units cost, where a purchase price was recorded. */
  capital: number;
  /** How many of the fleet have a purchase price at all. */
  priced: number;
};

/**
 * Capital that isn't working: assets with units in the fleet and not one
 * committed order line against them.
 *
 * Ranked by what the units cost, not by how many there are — ten idle cables
 * are not the problem that one idle server is. Where no purchase price was
 * recorded the row still appears, because "we own these and nobody has ever
 * rented them" is the finding, and it says how many of the units it could
 * actually price rather than treating a missing cost as zero.
 */
export async function getIdleItems(take = 6): Promise<IdleRow[]> {
  const assets = await prisma.asset.findMany({
    where: {
      units: { some: { status: { notIn: ["RETIRED", "SOLD"] } } },
      reservationItems: { none: COUNTED_LINES },
    },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      units: {
        where: { status: { notIn: ["RETIRED", "SOLD"] } },
        select: { purchasePrice: true },
      },
    },
  });

  return assets
    .map((asset) => {
      const priced = asset.units.filter((unit) => unit.purchasePrice !== null);
      return {
        assetId: asset.id,
        name: asset.name,
        category: asset.category?.name ?? null,
        fleet: asset.units.length,
        capital: priced.reduce((sum, unit) => sum + Number(unit.purchasePrice), 0),
        priced: priced.length,
      };
    })
    .sort((a, b) => b.capital - a.capital || b.fleet - a.fleet)
    .slice(0, take);
}

export type MaintenanceSummary = {
  /** Work orders that are open in any state. */
  openWorkOrders: number;
  /** Units the fleet cannot book because they are in service. */
  unitsInService: number;
  /** Work orders sitting at an RMA, waiting on somebody else. */
  atRma: number;
  /** Service coverage lapsing inside 90 days. */
  coverageExpiring: number;
  /** The oldest few open work orders — what has been waiting longest. */
  oldest: {
    id: string;
    number: string;
    fault: string;
    barcode: string;
    assetName: string;
    openedAt: Date;
  }[];
};

/**
 * Reuses the service center's own definition rather than re-listing the states.
 * The first draft of this file listed them by hand and invented `IN_PROGRESS`,
 * which is not a member — the enum is `IN_TEST`. One definition per concept.
 */
const OPEN_WORK_ORDERS: Prisma.WorkOrderWhereInput = {
  status: { in: OPEN_WORK_ORDER_STATUSES },
};

/**
 * What is broken, being fixed, or about to fall out of cover.
 *
 * Ordered oldest-first rather than newest: a work order opened this morning is
 * not the one that needs attention, and the reason to put maintenance on a
 * dashboard at all is the thing that has been sitting for six weeks.
 */
export async function getMaintenanceSummary(
  now = new Date(),
): Promise<MaintenanceSummary> {
  const soon = new Date(now.getTime() + 90 * 86_400_000);

  const [openWorkOrders, unitsInService, atRma, coverageExpiring, oldest] =
    await Promise.all([
      prisma.workOrder.count({ where: OPEN_WORK_ORDERS }),
      prisma.assetUnit.count({ where: { status: "MAINTENANCE" } }),
      prisma.workOrder.count({ where: { status: "RMA" } }),
      prisma.serviceCoverage.count({
        where: { endDate: { gte: now, lte: soon } },
      }),
      prisma.workOrder.findMany({
        where: OPEN_WORK_ORDERS,
        orderBy: { openedAt: "asc" },
        take: 4,
        select: {
          id: true,
          number: true,
          fault: true,
          openedAt: true,
          assetUnit: {
            select: { barcode: true, asset: { select: { name: true } } },
          },
        },
      }),
    ]);

  return {
    openWorkOrders,
    unitsInService,
    atRma,
    coverageExpiring,
    oldest: oldest.map((row) => ({
      id: row.id,
      number: row.number,
      fault: row.fault,
      barcode: row.assetUnit.barcode,
      assetName: row.assetUnit.asset.name,
      openedAt: row.openedAt,
    })),
  };
}
