import { prisma } from "@/lib/prisma";
import { bookValue, rollUp } from "@/lib/inventory/depreciation";
import {
  IN_FLEET,
  OPEN_CHECKOUT,
  OUT_OF_FLEET,
} from "@/lib/inventory/availability";

/** Queries behind the Assets record. One per card, so each Suspends alone. */

/** How many of an asset's units the record lists before handing off to Units. */
export const UNITS_SHOWN = 40;

export async function getAssetHeader(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      assetNumber: true,
      subCategory: true,
      manufacturer: true,
      model: true,
      notes: true,
      specs: true,
      createdAt: true,
      retiredAt: true,
      retirementReason: true,
      retirementNotes: true,
      dailyRate: true,
      weeklyRate: true,
      monthlyRate: true,
      salePrice: true,
      marketPrice: true,
      marketPriceSource: true,
      marketPriceUpdatedAt: true,
      marketPriceNotes: true,
      marketRentalRate: true,
      marketRentalRateSource: true,
      marketRentalRateUpdatedAt: true,
      marketRentalRateNotes: true,
      depreciationMethod: true,
      depreciationCategory: true,
      usefulLifeMonths: true,
      salvageValue: true,
      totalQuantity: true,
      category: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      _count: { select: { units: true } },
    },
  });

  if (!asset) return null;

  // Money columns are Prisma `Decimal`. Converted here so nothing downstream —
  // least of all a client component — ever holds one.
  const number = (value: unknown) => (value === null ? null : Number(value));

  return {
    ...asset,
    dailyRate: number(asset.dailyRate),
    weeklyRate: number(asset.weeklyRate),
    monthlyRate: number(asset.monthlyRate),
    salePrice: number(asset.salePrice),
    marketPrice: number(asset.marketPrice),
    marketRentalRate: number(asset.marketRentalRate),
    salvageValue: number(asset.salvageValue),
    maker: [asset.manufacturer, asset.model].filter(Boolean).join(" ") || null,
    units: asset._count.units,
  };
}

/**
 * The fleet, counted the way the rest of Inventory counts it.
 *
 * `Asset.totalQuantity` is denormalized and includes retired and sold units, so
 * it is deliberately not used for "in fleet" — it is returned by the header and
 * shown on the Detail card as the stored figure, where a disagreement with the
 * real count is information rather than a contradiction.
 */
export async function getAssetFleet(id: string) {
  const groups = await prisma.assetUnit.groupBy({
    by: ["status"],
    where: { assetId: id },
    _count: true,
  });

  const count = (status: string) =>
    groups.find((group) => group.status === status)?._count ?? 0;

  const total = groups.reduce((sum, group) => sum + group._count, 0);
  const inFleet = groups
    .filter((group) => IN_FLEET.includes(group.status))
    .reduce((sum, group) => sum + group._count, 0);

  return {
    total,
    inFleet,
    // AVAILABLE only — the one bookable definition, lib/inventory/availability.
    free: count("AVAILABLE"),
    out: count("CHECKED_OUT"),
    reserved: count("RESERVED"),
    service: count("MAINTENANCE"),
    retired: count("RETIRED"),
    sold: count("SOLD"),
  };
}

/**
 * What this asset has earned, and what the hardware cost to get there.
 *
 * Both figures span every unit ever registered against the asset, retired and
 * sold ones included: money a unit earned before it left is still money this
 * asset earned, and the cheque the business wrote for it was still written.
 * Book value is the opposite population and lives in `getAssetDepreciation` for
 * exactly that reason — mixing the two denominators in one figure would
 * overstate what is actually owned.
 */
export async function getAssetEarnings(id: string) {
  const [lifetime, sold, priced] = await Promise.all([
    prisma.assetUnit.aggregate({
      where: { assetId: id },
      _sum: { totalRevenue: true, maintenanceCost: true, purchasePrice: true },
      _count: true,
    }),
    prisma.assetUnit.aggregate({
      where: { assetId: id, status: "SOLD" },
      _sum: { soldPrice: true },
      _count: true,
    }),
    // Purchase cost sums over the units that carry a price. Counted so the card
    // can qualify the total: $0 across three priced units and $0 across three
    // units nobody costed are the same number and completely different facts.
    prisma.assetUnit.count({
      where: { assetId: id, purchasePrice: { not: null } },
    }),
  ]);

  return {
    revenue: Number(lifetime._sum.totalRevenue ?? 0),
    maintenance: Number(lifetime._sum.maintenanceCost ?? 0),
    spend: Number(lifetime._sum.purchasePrice ?? 0),
    unitsEver: lifetime._count,
    unitsPriced: priced,
    soldProceeds: Number(sold._sum.soldPrice ?? 0),
    soldCount: sold._count,
  };
}

/**
 * Book value across the units still owned.
 *
 * In-fleet only: a sold unit is no longer an asset on the books, and a retired
 * one has been written off by a decision rather than by a schedule. The roll-up
 * keeps the unpriced units countable instead of treating them as zero — see
 * `lib/inventory/depreciation`.
 */
export async function getAssetDepreciation(id: string) {
  const [units, asset] = await Promise.all([
    prisma.assetUnit.findMany({
      where: { assetId: id, status: { in: IN_FLEET } },
      select: { purchasePrice: true, purchaseDate: true, receivedDate: true },
    }),
    prisma.asset.findUnique({
      where: { id },
      select: {
        depreciationMethod: true,
        usefulLifeMonths: true,
        salvageValue: true,
      },
    }),
  ]);

  if (!asset) return { depreciation: null, fleetCount: units.length };

  const schedule = {
    method: asset.depreciationMethod,
    usefulLifeMonths: asset.usefulLifeMonths,
    salvageValue:
      asset.salvageValue === null ? null : Number(asset.salvageValue),
  };

  const depreciation = rollUp(
    units.map((unit) =>
      bookValue(
        {
          purchasePrice:
            unit.purchasePrice === null ? null : Number(unit.purchasePrice),
          purchaseDate: unit.purchaseDate,
          receivedDate: unit.receivedDate,
        },
        schedule,
      ),
    ),
  );

  return { depreciation, fleetCount: units.length };
}

export type AssetUnitRow = {
  id: string;
  barcode: string;
  serialNumber: string | null;
  status: string;
  locationName: string | null;
  holder: string | null;
  orderId: string | null;
  revenue: number;
};

const UNIT_SELECT = {
  id: true,
  barcode: true,
  serialNumber: true,
  status: true,
  totalRevenue: true,
  location: { select: { name: true } },
  checkouts: {
    // Custody comes from the open checkout, never from the status column.
    where: OPEN_CHECKOUT,
    orderBy: { checkoutDate: "desc" },
    take: 1,
    select: {
      client: { select: { name: true } },
      reservation: { select: { id: true } },
    },
  },
} as const;

/**
 * The asset's units, in fleet before gone.
 *
 * Two queries rather than `orderBy: status`, because Prisma sorts an enum by
 * its declaration order and `AssetStatus` declares RETIRED between MAINTENANCE
 * and RESERVED — which would file retired hardware above units that are still
 * earning. An asset with 141 units shows the first {@link UNITS_SHOWN}; the card
 * says so and hands off to the Units list, which already filters by asset name.
 */
export async function getAssetUnits(id: string, take = UNITS_SHOWN) {
  const [fleet, total, gone] = await Promise.all([
    prisma.assetUnit.findMany({
      where: { assetId: id, status: { in: IN_FLEET } },
      orderBy: { barcode: "asc" },
      take,
      select: UNIT_SELECT,
    }),
    prisma.assetUnit.count({ where: { assetId: id } }),
    prisma.assetUnit.count({
      where: { assetId: id, status: { in: OUT_OF_FLEET } },
    }),
  ]);

  // Only reach for retired and sold units when the fleet doesn't fill the card.
  const rest =
    fleet.length < take
      ? await prisma.assetUnit.findMany({
          where: { assetId: id, status: { in: OUT_OF_FLEET } },
          orderBy: { barcode: "asc" },
          take: take - fleet.length,
          select: UNIT_SELECT,
        })
      : [];

  const rows: AssetUnitRow[] = [...fleet, ...rest].map((record) => ({
    id: record.id,
    barcode: record.barcode,
    serialNumber: record.serialNumber,
    status: record.status,
    locationName: record.location?.name ?? null,
    holder: record.checkouts[0]?.client.name ?? null,
    orderId: record.checkouts[0]?.reservation?.id ?? null,
    revenue: Number(record.totalRevenue),
  }));

  return { rows, total, gone };
}
