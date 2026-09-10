import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OUT_OF_FLEET } from "@/lib/inventory/availability";

/**
 * Queries behind Operate → Pricing.
 *
 * Separate from `queries/inventory` on purpose. The Assets list answers "what do
 * we own and how much of it is free" and selects one rate as a hint; this
 * answers "what is everything priced at", which needs all four figures on every
 * row and cares nothing about availability. Sharing one query would have meant
 * loading unit rows for a screen that never counts units, or dropping three
 * rates from a screen whose whole job is showing them.
 *
 * Retired models are excluded by default. A price on something that has been
 * sold or scrapped is not a price anybody is going to charge, and the list is
 * long enough without them.
 */

export const PAGE_SIZE = 40;

/** The three rental tiers plus the outright price. Keyed by the Asset column. */
export const RATE_TIERS = [
  "dailyRate",
  "weeklyRate",
  "monthlyRate",
  "salePrice",
] as const;

export type RateTier = (typeof RATE_TIERS)[number];

export const RATE_TIER_LABEL: Record<RateTier, string> = {
  dailyRate: "Daily",
  weeklyRate: "Weekly",
  monthlyRate: "Monthly",
  salePrice: "Sale",
};

export function isRateTier(value: unknown): value is RateTier {
  return RATE_TIERS.includes(value as RateTier);
}

export type PricingRow = {
  id: string;
  name: string;
  maker: string | null;
  categoryName: string;
  categoryId: string | null;
  fleet: number;
  rates: Record<RateTier, number | null>;
};

function searchWhere(search: string): Prisma.AssetWhereInput {
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

function pricingWhere(
  search: string,
  categoryId: string,
  includeRetired: boolean,
): Prisma.AssetWhereInput {
  const clauses: Prisma.AssetWhereInput[] = [];
  if (!includeRetired) clauses.push({ retiredAt: null });
  if (search) clauses.push(searchWhere(search));
  if (categoryId) clauses.push({ categoryId });
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

export async function getPricingList({
  search = "",
  categoryId = "",
  includeRetired = false,
  page = 1,
}: {
  search?: string;
  categoryId?: string;
  includeRetired?: boolean;
  page?: number;
} = {}) {
  const where = pricingWhere(search, categoryId, includeRetired);

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
        categoryId: true,
        dailyRate: true,
        weeklyRate: true,
        monthlyRate: true,
        salePrice: true,
        category: { select: { name: true } },
        _count: { select: { units: { where: { status: { notIn: OUT_OF_FLEET } } } } },
      },
    }),
    prisma.asset.count({ where }),
  ]);

  const rows: PricingRow[] = records.map((record) => ({
    id: record.id,
    name: record.name,
    maker: [record.manufacturer, record.model].filter(Boolean).join(" ") || null,
    categoryName: record.category.name,
    categoryId: record.categoryId,
    // Fleet, not `totalQuantity` — the denormalized column counts retired and
    // sold units, and how many earning units carry a price is the whole point
    // of showing the number next to it.
    fleet: record._count.units,
    rates: {
      dailyRate: toNumber(record.dailyRate),
      weeklyRate: toNumber(record.weeklyRate),
      monthlyRate: toNumber(record.monthlyRate),
      salePrice: toNumber(record.salePrice),
    },
  }));

  return { rows, total, page, pageSize: PAGE_SIZE };
}

/**
 * The header figure: how much of the active catalogue carries no rental price
 * at all.
 *
 * Counted as "no daily, weekly or monthly", not "no daily" — most of the fleet
 * is quoted monthly and only 11 models carry a weekly rate, so counting a
 * missing daily rate as unpriced would report almost the whole catalogue as
 * broken. Unpriced here means the order builder's `pickRate` would find nothing
 * and the line would land at zero.
 */
export async function getPricingHeaderStats() {
  const [priced, unpriced] = await Promise.all([
    prisma.asset.count({ where: { retiredAt: null } }),
    prisma.asset.count({
      where: {
        retiredAt: null,
        dailyRate: null,
        weeklyRate: null,
        monthlyRate: null,
      },
    }),
  ]);
  return { active: priced, unpriced };
}

export async function getPricingCategories() {
  const categories = await prisma.assetCategory.findMany({
    where: { assets: { some: { retiredAt: null } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { assets: { where: { retiredAt: null } } } },
    },
  });
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    assets: category._count.assets,
  }));
}
