import { prisma } from "@/lib/prisma";
import { IN_FLEET } from "@/lib/inventory/availability";

/** Queries behind the Vendors record. One per card, so each Suspends alone. */

export async function getVendorHeader(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      address: true,
      notes: true,
      createdAt: true,
      _count: {
        select: { assets: true, assetUnits: true, purchaseOrders: true },
      },
    },
  });

  if (!vendor) return null;

  return {
    ...vendor,
    assets: vendor._count.assets,
    units: vendor._count.assetUnits,
    purchaseOrders: vendor._count.purchaseOrders,
  };
}

/**
 * What has been bought from this vendor, and how much of it still earns.
 *
 * Spend is the sum of `AssetUnit.purchasePrice` over units attributed to the
 * vendor, which is not the same as the total of their purchase orders: a PO
 * carries freight, fees and tax, and units imported from v1 predate any PO at
 * all. Both are shown, labeled as what they are, rather than one figure that
 * silently means whichever the query happened to reach.
 */
export async function getVendorSupply(id: string) {
  const [units, priced, fleet, spend, poTotal, assets] = await Promise.all([
    prisma.assetUnit.count({ where: { vendorId: id } }),
    prisma.assetUnit.count({
      where: { vendorId: id, purchasePrice: { not: null } },
    }),
    prisma.assetUnit.count({
      where: { vendorId: id, status: { in: IN_FLEET } },
    }),
    prisma.assetUnit.aggregate({
      where: { vendorId: id },
      _sum: { purchasePrice: true, totalRevenue: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { vendorId: id },
      _sum: { total: true },
      _count: true,
    }),
    prisma.asset.count({ where: { vendorId: id } }),
  ]);

  return {
    units,
    assets,
    unitsPriced: priced,
    inFleet: fleet,
    spend: Number(spend._sum.purchasePrice ?? 0),
    revenue: Number(spend._sum.totalRevenue ?? 0),
    poTotal: Number(poTotal._sum.total ?? 0),
    poCount: poTotal._count,
  };
}

/** The asset types this vendor supplies, biggest fleet first. */
export async function getVendorAssets(id: string, take = 14) {
  const [records, total] = await Promise.all([
    prisma.asset.findMany({
      where: { vendorId: id },
      orderBy: [{ name: "asc" }],
      take,
      select: {
        id: true,
        name: true,
        retiredAt: true,
        category: { select: { name: true } },
        _count: {
          select: { units: { where: { status: { in: IN_FLEET } } } },
        },
      },
    }),
    prisma.asset.count({ where: { vendorId: id } }),
  ]);

  return {
    total,
    rows: records.map((record) => ({
      id: record.id,
      name: record.name,
      categoryName: record.category.name,
      retired: record.retiredAt !== null,
      // Fleet, not `totalQuantity` — the same count the Assets list uses.
      units: record._count.units,
    })),
  };
}

/**
 * Purchase orders raised against this vendor.
 *
 * Rows hand off to the Purchase orders list filtered to the PO number rather
 * than to a record, because the PO record is Stage 5 work that hasn't been
 * built — a link to a 404 is worse than a link that lands on the row.
 */
export async function getVendorPurchaseOrders(id: string, take = 12) {
  const [records, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { vendorId: id },
      orderBy: { orderDate: "desc" },
      take,
      select: {
        id: true,
        poNumber: true,
        status: true,
        orderDate: true,
        receivedDate: true,
        total: true,
      },
    }),
    prisma.purchaseOrder.count({ where: { vendorId: id } }),
  ]);

  return {
    total,
    rows: records.map((record) => ({
      ...record,
      total: Number(record.total),
    })),
  };
}

/** The most recent units received from this vendor, newest purchase first. */
export async function getVendorUnits(id: string, take = 12) {
  const records = await prisma.assetUnit.findMany({
    where: { vendorId: id },
    orderBy: [{ purchaseDate: "desc" }, { barcode: "asc" }],
    take,
    select: {
      id: true,
      barcode: true,
      status: true,
      purchaseDate: true,
      purchasePrice: true,
      asset: { select: { name: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    barcode: record.barcode,
    status: record.status,
    purchaseDate: record.purchaseDate,
    purchasePrice:
      record.purchasePrice === null ? null : Number(record.purchasePrice),
    assetName: record.asset.name,
  }));
}
