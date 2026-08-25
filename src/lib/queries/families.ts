import type { AssetStatus } from "@/generated/prisma/client";
import { BOOKABLE, IN_FLEET, OUT_OF_FLEET } from "@/lib/inventory/availability";
import { suggestFamilies, type FamilySuggestion } from "@/lib/inventory/families";
import { prisma } from "@/lib/prisma";

/**
 * Queries behind Inventory → Assets, where an asset is now the family and the
 * priced product type beneath it is a model.
 *
 * Every stock figure here is counted with the same `IN_FLEET` / `BOOKABLE`
 * definitions the model list and the order builder use. That is the whole point
 * of rolling up rather than storing: a family cannot disagree with the models
 * inside it, because it is only ever their sum. `Asset.totalQuantity` is
 * deliberately not used — it is denormalized and counts retired and sold units
 * alongside the ones that can still earn.
 */

export type StockRollup = {
  /** Units that could still earn: available, out, in service or reserved. */
  fleet: number;
  /** Free to promise right now. */
  available: number;
  out: number;
  service: number;
  reserved: number;
  /** Retired and sold. Not fleet, but worth saying rather than hiding. */
  gone: number;
};

export type RateRange = { min: number; max: number } | null;

export type ModelRow = {
  id: string;
  name: string;
  categoryName: string;
  /**
   * This model's own make and part number, which is the batch it was bought as
   * — "PNY Technologies, Inc. VCG509032TFXPB1-O". Null on most, and different
   * from the family's manufacturer whenever two purchases came from different
   * partners.
   */
  maker: string | null;
  retired: boolean;
  dailyRate: number | null;
  monthlyRate: number | null;
  stock: StockRollup;
};

export type FamilyRow = {
  id: string;
  name: string;
  manufacturer: string | null;
  /** Usually one; a family spanning two is worth seeing rather than flattening. */
  categoryNames: string[];
  models: number;
  retiredModels: number;
  stock: StockRollup;
  daily: RateRange;
  monthly: RateRange;
};

const EMPTY: StockRollup = {
  fleet: 0,
  available: 0,
  out: 0,
  service: 0,
  reserved: 0,
  gone: 0,
};

function add(into: StockRollup, status: AssetStatus, n: number): void {
  if (OUT_OF_FLEET.includes(status)) into.gone += n;
  if (IN_FLEET.includes(status)) into.fleet += n;
  if (BOOKABLE.includes(status)) into.available += n;
  if (status === "CHECKED_OUT") into.out += n;
  if (status === "MAINTENANCE") into.service += n;
  if (status === "RESERVED") into.reserved += n;
}

/**
 * Unit counts per model, in one grouped query rather than a nested include.
 *
 * The alternative loads every unit row to tally it in JS — 2,616 of them — for
 * six numbers. This returns one row per model per status.
 */
async function stockByAsset(
  assetIds: string[],
): Promise<Map<string, StockRollup>> {
  const out = new Map<string, StockRollup>();
  if (assetIds.length === 0) return out;

  const grouped = await prisma.assetUnit.groupBy({
    by: ["assetId", "status"],
    where: { assetId: { in: assetIds } },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const current = out.get(row.assetId) ?? { ...EMPTY };
    add(current, row.status, row._count._all);
    out.set(row.assetId, current);
  }
  return out;
}

function sum(rollups: StockRollup[]): StockRollup {
  return rollups.reduce<StockRollup>(
    (total, one) => ({
      fleet: total.fleet + one.fleet,
      available: total.available + one.available,
      out: total.out + one.out,
      service: total.service + one.service,
      reserved: total.reserved + one.reserved,
      gone: total.gone + one.gone,
    }),
    { ...EMPTY },
  );
}

function range(values: (number | null)[]): RateRange {
  const priced = values.filter((v): v is number => v !== null && v > 0);
  if (priced.length === 0) return null;
  return { min: Math.min(...priced), max: Math.max(...priced) };
}

export const PAGE_SIZE = 40;

export async function getFamilyList({
  search = "",
  page = 1,
}: { search?: string; page?: number } = {}) {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { manufacturer: { contains: search, mode: "insensitive" as const } },
          {
            assets: {
              some: { name: { contains: search, mode: "insensitive" as const } },
            },
          },
        ],
      }
    : {};

  const [families, total] = await Promise.all([
    prisma.assetFamily.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        manufacturer: true,
        assets: {
          select: {
            id: true,
            retiredAt: true,
            dailyRate: true,
            monthlyRate: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    prisma.assetFamily.count({ where }),
  ]);

  const stock = await stockByAsset(
    families.flatMap((family) => family.assets.map((asset) => asset.id)),
  );

  const rows: FamilyRow[] = families.map((family) => ({
    id: family.id,
    name: family.name,
    manufacturer: family.manufacturer,
    categoryNames: [
      ...new Set(family.assets.map((asset) => asset.category.name)),
    ].sort(),
    models: family.assets.length,
    retiredModels: family.assets.filter((asset) => asset.retiredAt !== null)
      .length,
    stock: sum(family.assets.map((asset) => stock.get(asset.id) ?? { ...EMPTY })),
    daily: range(
      family.assets.map((asset) =>
        asset.dailyRate === null ? null : Number(asset.dailyRate),
      ),
    ),
    monthly: range(
      family.assets.map((asset) =>
        asset.monthlyRate === null ? null : Number(asset.monthlyRate),
      ),
    ),
  }));

  return { rows, total, page, pageSize: PAGE_SIZE };
}

export type FamilyRecord = {
  id: string;
  name: string;
  manufacturer: string | null;
  description: string | null;
  notes: string | null;
  /** Makes recorded on the models themselves, where they differ from each other. */
  modelMakers: string[];
  categoryNames: string[];
  stock: StockRollup;
  daily: RateRange;
  monthly: RateRange;
  models: ModelRow[];
};

export async function getFamily(id: string): Promise<FamilyRecord | null> {
  const family = await prisma.assetFamily.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      description: true,
      notes: true,
      assets: {
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          retiredAt: true,
          dailyRate: true,
          monthlyRate: true,
          manufacturer: true,
          model: true,
          category: { select: { name: true } },
        },
      },
    },
  });
  if (!family) return null;

  const stock = await stockByAsset(family.assets.map((asset) => asset.id));

  const models: ModelRow[] = family.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    categoryName: asset.category.name,
    maker:
      [asset.manufacturer, asset.model].filter(Boolean).join(" ") || null,
    retired: asset.retiredAt !== null,
    dailyRate: asset.dailyRate === null ? null : Number(asset.dailyRate),
    monthlyRate: asset.monthlyRate === null ? null : Number(asset.monthlyRate),
    stock: stock.get(asset.id) ?? { ...EMPTY },
  }));

  return {
    id: family.id,
    name: family.name,
    manufacturer: family.manufacturer,
    description: family.description,
    notes: family.notes,
    modelMakers: [
      ...new Set(
        family.assets
          .map((asset) => asset.manufacturer)
          .filter((maker): maker is string => Boolean(maker)),
      ),
    ].sort(),
    categoryNames: [...new Set(models.map((m) => m.categoryName))].sort(),
    stock: sum(models.map((m) => m.stock)),
    daily: range(models.map((m) => m.dailyRate)),
    monthly: range(models.map((m) => m.monthlyRate)),
    models,
  };
}

/** Which family a model sits under, for the model record's breadcrumb. */
export async function getFamilyOfAsset(assetId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { family: { select: { id: true, name: true, _count: { select: { assets: true } } } } },
  });
  if (!asset?.family) return null;
  return {
    id: asset.family.id,
    name: asset.family.name,
    models: asset.family._count.assets,
  };
}

export async function getUngroupedCount(): Promise<number> {
  return prisma.asset.count({ where: { familyId: null } });
}

/**
 * What the review screen offers. Only ungrouped models are considered, so a
 * family somebody has already accepted is never proposed again or reshuffled.
 */
export async function getSuggestions(): Promise<FamilySuggestion[]> {
  const rows = await prisma.asset.findMany({
    where: { familyId: null },
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { name: true } },
      _count: { select: { units: { where: { status: { notIn: OUT_OF_FLEET } } } } },
    },
  });

  return suggestFamilies(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      units: row._count.units,
    })),
  );
}
