import type { AssetStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IN_FLEET,
  OPEN_CHECKOUT,
  OUT_OF_FLEET,
} from "@/lib/inventory/availability";
import {
  ASSET_VIEWS,
  UNIT_VIEWS,
  type AssetView,
  type UnitView,
} from "@/lib/inventory/labels";

/**
 * Queries behind the Inventory cluster.
 *
 * Purpose-built rather than reusing `actions/assets`, which loads every unit of
 * every asset with its relations for a list that shows six columns. Status
 * meaning is never redefined here — it comes from `lib/inventory/availability`,
 * the one place that decides what "out" and "in fleet" mean.
 */

export const PAGE_SIZE = 40;

/* ── Assets ─────────────────────────────────────────────────────────────── */

function assetViewWhere(view: AssetView): Prisma.AssetWhereInput {
  switch (view) {
    case "active":
      return { retiredAt: null };
    case "retired":
      return { retiredAt: { not: null } };
    case "all":
      return {};
  }
}

function assetSearchWhere(search: string): Prisma.AssetWhereInput {
  const contains = { contains: search, mode: "insensitive" } as const;
  return {
    OR: [
      { name: contains },
      { manufacturer: contains },
      { model: contains },
      { assetNumber: contains },
      { category: { name: contains } },
    ],
  };
}

function assetWhere(view: AssetView, search: string, categoryId: string) {
  const clauses: Prisma.AssetWhereInput[] = [assetViewWhere(view)];
  if (search) clauses.push(assetSearchWhere(search));
  if (categoryId) clauses.push({ categoryId });
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export type AssetRow = {
  id: string;
  name: string;
  categoryName: string;
  maker: string | null;
  units: number;
  available: number;
  dailyRate: number | null;
  retired: boolean;
};

export async function getAssetViewCounts(search = "", categoryId = "") {
  const counts = await Promise.all(
    ASSET_VIEWS.map((view) =>
      prisma.asset.count({ where: assetWhere(view, search, categoryId) }),
    ),
  );
  return Object.fromEntries(
    ASSET_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<AssetView, number>;
}

export async function getAssetList({
  view = "active",
  search = "",
  categoryId = "",
  page = 1,
}: {
  view?: AssetView;
  search?: string;
  categoryId?: string;
  page?: number;
} = {}) {
  const where = assetWhere(view, search, categoryId);

  const [records, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        manufacturer: true,
        model: true,
        dailyRate: true,
        retiredAt: true,
        category: { select: { name: true } },
        _count: {
          select: {
            units: { where: { status: { notIn: OUT_OF_FLEET } } },
          },
        },
        units: {
          where: { status: "AVAILABLE" },
          select: { id: true },
        },
      },
    }),
    prisma.asset.count({ where }),
  ]);

  const rows: AssetRow[] = records.map((record) => ({
    id: record.id,
    name: record.name,
    categoryName: record.category.name,
    maker:
      [record.manufacturer, record.model].filter(Boolean).join(" ") || null,
    // Fleet count, not `totalQuantity` — that column is denormalised and counts
    // retired and sold units alongside the ones that can still earn.
    units: record._count.units,
    available: record.units.length,
    dailyRate: record.dailyRate === null ? null : Number(record.dailyRate),
    retired: record.retiredAt !== null,
  }));

  return { rows, total, page, pageSize: PAGE_SIZE };
}

export async function getAssetCategories() {
  return prisma.assetCategory.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getAssetHeaderStats() {
  const [active, fleet] = await Promise.all([
    prisma.asset.count({ where: { retiredAt: null } }),
    prisma.assetUnit.count({ where: { status: { in: IN_FLEET } } }),
  ]);
  return { active, fleet };
}

/* ── Units ──────────────────────────────────────────────────────────────── */

const UNIT_VIEW_STATUS: Record<UnitView, AssetStatus[] | null> = {
  "in-fleet": IN_FLEET,
  available: ["AVAILABLE"],
  out: ["CHECKED_OUT"],
  service: ["MAINTENANCE"],
  gone: OUT_OF_FLEET,
  all: null,
};

function unitWhere(view: UnitView, search: string): Prisma.AssetUnitWhereInput {
  const statuses = UNIT_VIEW_STATUS[view];
  const clauses: Prisma.AssetUnitWhereInput[] = [];
  if (statuses) clauses.push({ status: { in: statuses } });
  if (search) {
    const contains = { contains: search, mode: "insensitive" } as const;
    clauses.push({
      OR: [
        { barcode: contains },
        { serialNumber: contains },
        { asset: { name: contains } },
      ],
    });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

export type UnitRow = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  assetName: string;
  status: AssetStatus;
  locationName: string | null;
  /** Who has it right now, from the open checkout. Null when it's on the shelf. */
  holder: string | null;
  revenue: number;
};

export async function getUnitViewCounts(search = "") {
  const counts = await Promise.all(
    UNIT_VIEWS.map((view) =>
      prisma.assetUnit.count({ where: unitWhere(view, search) }),
    ),
  );
  return Object.fromEntries(
    UNIT_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<UnitView, number>;
}

export async function getUnitList({
  view = "in-fleet",
  search = "",
  page = 1,
}: { view?: UnitView; search?: string; page?: number } = {}) {
  const where = unitWhere(view, search);

  const [records, total] = await Promise.all([
    prisma.assetUnit.findMany({
      where,
      orderBy: [{ asset: { name: "asc" } }, { barcode: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        barcode: true,
        serialNumber: true,
        status: true,
        totalRevenue: true,
        asset: { select: { name: true } },
        location: { select: { name: true } },
        checkouts: {
          // The open checkout is the truth about custody — `AssetUnit.status`
          // only reflects it. See lib/inventory/availability.ts.
          where: OPEN_CHECKOUT,
          orderBy: { checkoutDate: "desc" },
          take: 1,
          select: { client: { select: { name: true } } },
        },
      },
    }),
    prisma.assetUnit.count({ where }),
  ]);

  const rows: UnitRow[] = records.map((record) => ({
    id: record.id,
    barcode: record.barcode,
    serialNumber: record.serialNumber,
    assetName: record.asset.name,
    status: record.status,
    locationName: record.location?.name ?? null,
    holder: record.checkouts[0]?.client?.name ?? null,
    revenue: Number(record.totalRevenue),
  }));

  return { rows, total, page, pageSize: PAGE_SIZE };
}

/* ── Locations & transfers ──────────────────────────────────────────────── */

/**
 * The locations, counted the way the rest of Inventory counts.
 *
 * `_count.assetUnits` counts everything ever put at a location, retired and sold
 * included — the same denormalised trap as `Asset.totalQuantity`. A warehouse
 * holding 395 available units read "961" under that count, which is not a number
 * anybody can act on. One `groupBy` over status gives the breakdown for every
 * location at once, so this stays two queries however many locations exist.
 */
export async function getLocations() {
  const [records, groups] = await Promise.all([
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        parentLocation: { select: { name: true } },
      },
    }),
    prisma.assetUnit.groupBy({
      by: ["locationId", "status"],
      where: { locationId: { not: null } },
      _count: true,
    }),
  ]);

  return records.map((record) => {
    const mine = groups.filter((group) => group.locationId === record.id);
    const count = (status: AssetStatus) =>
      mine.find((group) => group.status === status)?._count ?? 0;

    return {
      id: record.id,
      name: record.name,
      address: record.address,
      parentName: record.parentLocation?.name ?? null,
      total: mine.reduce((sum, group) => sum + group._count, 0),
      inFleet: mine
        .filter((group) => IN_FLEET.includes(group.status))
        .reduce((sum, group) => sum + group._count, 0),
      // AVAILABLE only, the one bookable definition.
      free: count("AVAILABLE"),
      out: count("CHECKED_OUT"),
      service: count("MAINTENANCE"),
    };
  });
}

/**
 * Recent transfers. `AssetTransfer` has no status column — a row *is* a
 * completed move — so this is a log, not a queue of pending work. Calling it a
 * queue on the screen would promise an approval step the schema doesn't have.
 */
export async function getRecentTransfers(take = 12) {
  const records = await prisma.assetTransfer.findMany({
    orderBy: { transferDate: "desc" },
    take,
    select: {
      id: true,
      transferDate: true,
      assetUnit: {
        select: { barcode: true, asset: { select: { name: true } } },
      },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    date: record.transferDate,
    barcode: record.assetUnit.barcode,
    assetName: record.assetUnit.asset.name,
    from: record.fromLocation.name,
    to: record.toLocation.name,
  }));
}

export async function getUnlocatedUnitCount() {
  return prisma.assetUnit.count({
    where: { locationId: null, status: { in: IN_FLEET } },
  });
}

/* ── Audits & scan lists ────────────────────────────────────────────────── */

export async function getAudits() {
  const records = await prisma.inventoryAudit.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      name: true,
      scope: true,
      status: true,
      totalItems: true,
      verifiedCount: true,
      issueCount: true,
      missingCount: true,
      unexpectedCount: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });

  return records.map((record) => ({
    ...record,
    // Every way a scanned item failed to match what was expected.
    exceptions:
      record.issueCount + record.missingCount + record.unexpectedCount,
  }));
}

export async function getScanLists() {
  const records = await prisma.scanList.findMany({
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { items: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    items: record._count.items,
  }));
}

export async function getAuditTabCounts() {
  const [audits, scanLists] = await Promise.all([
    prisma.inventoryAudit.count(),
    prisma.scanList.count(),
  ]);
  return { audits, "scan-lists": scanLists };
}

/* ── Vendors ────────────────────────────────────────────────────────────── */

export async function getVendors(search = "") {
  const contains = { contains: search, mode: "insensitive" } as const;
  const where: Prisma.VendorWhereInput = search
    ? { OR: [{ name: contains }, { contactName: contains }, { contactEmail: contains }] }
    : {};

  const records = await prisma.vendor.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      _count: { select: { assets: true, assetUnits: true, purchaseOrders: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    contactName: record.contactName,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    assets: record._count.assets,
    units: record._count.assetUnits,
    purchaseOrders: record._count.purchaseOrders,
  }));
}
