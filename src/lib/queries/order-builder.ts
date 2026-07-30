import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OUT_OF_FLEET } from "@/lib/inventory/availability";

/**
 * Availability behind the new-order builder.
 *
 * The commitment is counted from `ReservationItem.quantity`, not from unit
 * rows: an order approved for next month has promised six units without any
 * being assigned yet, and those six are exactly what must not be promised
 * twice. Counting rows would call them free and let the builder oversell.
 */

/** Orders that hold stock. Quotes don't — nobody has agreed to them. */
const HOLDS_STOCK: Prisma.ReservationWhereInput = {
  status: { in: ["APPROVED", "PREPARING", "SHIPPED", "ACTIVE"] },
};

export type AssetAvailability = {
  assetId: string;
  name: string;
  category: string | null;
  categoryId: string | null;
  rate: number;
  pricingType: "DAILY" | "WEEKLY" | "MONTHLY";
  /** Units that exist and could earn — retired and sold are not capacity. */
  fleet: number;
  /** Units promised to orders overlapping this window. */
  committed: number;
  free: number;
  /**
   * When enough units come back for the window to be satisfiable — the earliest
   * end date among the orders holding them. Null when nothing is holding any.
   */
  freeFrom: Date | null;
};

function pickRate(asset: {
  monthlyRate: Prisma.Decimal | null;
  weeklyRate: Prisma.Decimal | null;
  dailyRate: Prisma.Decimal | null;
}): { rate: number; pricingType: "DAILY" | "WEEKLY" | "MONTHLY" } {
  // Same precedence as the ported checkout path, so a line added here and a
  // line added by a scan are priced identically.
  const monthly = Number(asset.monthlyRate ?? 0);
  if (monthly > 0) return { rate: monthly, pricingType: "MONTHLY" };
  const weekly = Number(asset.weeklyRate ?? 0);
  if (weekly > 0) return { rate: weekly, pricingType: "WEEKLY" };
  return { rate: Number(asset.dailyRate ?? 0), pricingType: "DAILY" };
}

/**
 * Assets matching a search, with what's actually free across the window.
 *
 * Two orders overlap when each starts before the other ends — the standard
 * interval test, and the reason a same-day handover reads as a clash. That is
 * deliberate: the builder should say so and let a person wave it through.
 */
export async function searchAssetsForWindow(
  query: string,
  start: Date,
  end: Date,
  take = 12,
): Promise<AssetAvailability[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { assetNumber: { contains: trimmed, mode: "insensitive" } },
        { manufacturer: { contains: trimmed, mode: "insensitive" } },
      ],
      units: { some: { status: { notIn: OUT_OF_FLEET } } },
    },
    take,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      weeklyRate: true,
      dailyRate: true,
      category: { select: { id: true, name: true } },
      _count: { select: { units: { where: { status: { notIn: OUT_OF_FLEET } } } } },
      reservationItems: {
        where: {
          parentId: null,
          reservation: {
            ...HOLDS_STOCK,
            startDate: { lte: end },
            endDate: { gte: start },
          },
        },
        select: {
          quantity: true,
          reservation: { select: { endDate: true } },
        },
      },
    },
  });

  return assets.map((asset) => {
    const committed = asset.reservationItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const fleet = asset._count.units;
    const freeFrom = asset.reservationItems.length
      ? asset.reservationItems
          .map((item) => item.reservation.endDate)
          .reduce((earliest, date) => (date < earliest ? date : earliest))
      : null;

    return {
      assetId: asset.id,
      name: asset.name,
      category: asset.category?.name ?? null,
      categoryId: asset.category?.id ?? null,
      ...pickRate(asset),
      fleet,
      committed,
      free: Math.max(0, fleet - committed),
      freeFrom,
    };
  });
}

/**
 * Alternatives for a line that can't be filled: the same category, enough free
 * across the whole window, nearest in price first.
 *
 * Nearest in price rather than cheapest — a substitute is meant to be the same
 * job, and a $40 stand offered in place of a $900 workstation wastes the
 * person's time.
 */
export async function findSubstitutes(
  assetId: string,
  quantity: number,
  start: Date,
  end: Date,
  take = 3,
): Promise<AssetAvailability[]> {
  const original = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      categoryId: true,
      monthlyRate: true,
      weeklyRate: true,
      dailyRate: true,
    },
  });
  if (!original?.categoryId) return [];

  const siblings = await prisma.asset.findMany({
    where: {
      categoryId: original.categoryId,
      id: { not: assetId },
      units: { some: { status: { notIn: OUT_OF_FLEET } } },
    },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      weeklyRate: true,
      dailyRate: true,
      category: { select: { id: true, name: true } },
      _count: { select: { units: { where: { status: { notIn: OUT_OF_FLEET } } } } },
      reservationItems: {
        where: {
          parentId: null,
          reservation: {
            ...HOLDS_STOCK,
            startDate: { lte: end },
            endDate: { gte: start },
          },
        },
        select: { quantity: true, reservation: { select: { endDate: true } } },
      },
    },
  });

  const target = pickRate(original).rate;

  return siblings
    .map((asset) => {
      const committed = asset.reservationItems.reduce(
        (sum, i) => sum + i.quantity,
        0,
      );
      const fleet = asset._count.units;
      return {
        assetId: asset.id,
        name: asset.name,
        category: asset.category?.name ?? null,
        categoryId: asset.category?.id ?? null,
        ...pickRate(asset),
        fleet,
        committed,
        free: Math.max(0, fleet - committed),
        freeFrom: null,
      } satisfies AssetAvailability;
    })
    .filter((asset) => asset.free >= quantity)
    .sort((a, b) => Math.abs(a.rate - target) - Math.abs(b.rate - target))
    .slice(0, take);
}

export async function searchClients(query: string, take = 8) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { companyName: { contains: trimmed, mode: "insensitive" } },
        { email: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    take,
    orderBy: { name: "asc" },
    select: { id: true, name: true, companyName: true },
  });
}
