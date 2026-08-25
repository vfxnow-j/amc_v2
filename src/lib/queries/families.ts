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

/**
 * A row on the Assets list: either a family with models under it, or an asset
 * that stands on its own.
 *
 * Both are things the business owns, and that is the whole point of merging
 * them. Most of the fleet has no variants — a switch is a switch — and calling
 * those "models" of nothing was wrong. `models` is null for a standalone, which
 * the list renders as a dash rather than as 1.
 */
export type FleetRow = {
  kind: "asset" | "family";
  id: string;
  href: string;
  name: string;
  manufacturer: string | null;
  /** How many models sit under it; null when it stands alone. */
  models: number | null;
  retiredModels: number;
  categoryNames: string[];
  retired: boolean;
  stock: StockRollup;
  daily: RateRange;
  monthly: RateRange;
};

/** Active / Retired / All, applied to families and standalone assets alike. */
export type FleetView = "active" | "retired" | "all";

function matches(row: FleetRow, extra: string[], needle: string): boolean {
  if (!needle) return true;
  const hay = [row.name, row.manufacturer ?? "", ...extra]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle.toLowerCase());
}

/**
 * Everything the business owns, at the level you shop for it.
 *
 * Assembled in memory rather than in SQL because it is a union across two
 * tables that has to sort and page as one list, and the fleet is 224 rows —
 * the whole set costs one query for the families, one for the standalone
 * assets and one grouped count for the units. If the catalogue ever reaches
 * the thousands this becomes a materialised view or a UNION, not a bigger
 * in-memory sort.
 */
export async function getFleetList({
  view = "active",
  search = "",
  page = 1,
}: { view?: FleetView; search?: string; page?: number } = {}) {
  const [families, loose] = await Promise.all([
    prisma.assetFamily.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        manufacturer: true,
        assets: {
          select: {
            id: true,
            name: true,
            retiredAt: true,
            dailyRate: true,
            monthlyRate: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    prisma.asset.findMany({
      where: { familyId: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        manufacturer: true,
        model: true,
        retiredAt: true,
        dailyRate: true,
        monthlyRate: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  const stock = await stockByAsset([
    ...families.flatMap((family) => family.assets.map((asset) => asset.id)),
    ...loose.map((asset) => asset.id),
  ]);

  const searchable = new Map<string, string[]>();

  const familyRows: FleetRow[] = families.map((family) => {
    searchable.set(
      family.id,
      family.assets.map((asset) => asset.name),
    );
    return {
      kind: "family" as const,
      id: family.id,
      href: `/dashboard/assets/family/${family.id}`,
      name: family.name,
      manufacturer: family.manufacturer,
      models: family.assets.length,
      retiredModels: family.assets.filter((a) => a.retiredAt !== null).length,
      categoryNames: [
        ...new Set(family.assets.map((asset) => asset.category.name)),
      ].sort(),
      // A family is retired only when every model in it is. One live model
      // means the thing is still in service.
      retired:
        family.assets.length > 0 &&
        family.assets.every((asset) => asset.retiredAt !== null),
      stock: sum(
        family.assets.map((asset) => stock.get(asset.id) ?? { ...EMPTY }),
      ),
      daily: range(
        family.assets.map((a) => (a.dailyRate === null ? null : Number(a.dailyRate))),
      ),
      monthly: range(
        family.assets.map((a) =>
          a.monthlyRate === null ? null : Number(a.monthlyRate),
        ),
      ),
    };
  });

  const looseRows: FleetRow[] = loose.map((asset) => {
    searchable.set(asset.id, [asset.model ?? ""]);
    return {
      kind: "asset" as const,
      id: asset.id,
      href: `/dashboard/assets/${asset.id}`,
      name: asset.name,
      manufacturer: asset.manufacturer,
      models: null,
      retiredModels: 0,
      categoryNames: [asset.category.name],
      retired: asset.retiredAt !== null,
      stock: stock.get(asset.id) ?? { ...EMPTY },
      daily: range([asset.dailyRate === null ? null : Number(asset.dailyRate)]),
      monthly: range([
        asset.monthlyRate === null ? null : Number(asset.monthlyRate),
      ]),
    };
  });

  const all = [...familyRows, ...looseRows]
    .filter((row) =>
      view === "all" ? true : view === "retired" ? row.retired : !row.retired,
    )
    .filter((row) => matches(row, searchable.get(row.id) ?? [], search.trim()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const start = (page - 1) * PAGE_SIZE;
  return {
    rows: all.slice(start, start + PAGE_SIZE),
    total: all.length,
    page,
    pageSize: PAGE_SIZE,
    families: familyRows.length,
  };
}

/** Row counts per view, for the filter strip. */
export async function getFleetCounts(search = "") {
  const [active, retired, all] = await Promise.all([
    getFleetList({ view: "active", search, page: 1 }),
    getFleetList({ view: "retired", search, page: 1 }),
    getFleetList({ view: "all", search, page: 1 }),
  ]);
  return { active: active.total, retired: retired.total, all: all.total };
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
