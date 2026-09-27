import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_CHECKOUT, OUT_OF_FLEET } from "@/lib/inventory/availability";
import { HOLDS_STOCK } from "@/lib/queries/order-builder";
import {
  DEFAULT_REFURB_BUFFER_DAYS,
  computeCapacity,
  figuresForOffering,
  type CapacityAsset,
  type CapacityFigures,
  type CapacityOptions,
  type CapacityResult,
} from "./capacity";

/**
 * Reads what `computeCapacity` needs, for a pool or a single asset. SELECTs
 * only; never returns a row as-is — the route maps the result explicitly.
 *
 * A pool (`portal_capacity_pools`) is either a list of asset ids or a whole
 * category; when both are set, the union is used. Portal holds are not read yet
 * (Phase 2 adds `portal_holds`); `tentative` is QUOTE_SENT orders until then.
 */

export type CapacityPoolInfo = { slug: string; name: string; unitLabel: string };

export type LoadedCapacity = CapacityResult & { pool_info: CapacityPoolInfo | null };

const TENTATIVE_STATUS = "QUOTE_SENT" as const;

/** Look up a pool by slug. Null when there is no such pool. */
export async function loadPoolCapacity(
  slug: string,
  today: Date,
  options: CapacityOptions = {},
): Promise<LoadedCapacity | null> {
  const pool = await prisma.portalCapacityPool.findUnique({
    where: { slug },
    select: { slug: true, name: true, unitLabel: true, assetIds: true, categoryId: true },
  });
  if (!pool) return null;

  const or: Prisma.AssetWhereInput[] = [];
  if (pool.assetIds.length) or.push({ id: { in: pool.assetIds } });
  if (pool.categoryId) or.push({ categoryId: pool.categoryId });
  const assets = or.length ? await loadAssets({ OR: or }, today, options) : [];

  return {
    ...computeCapacity(assets, today, options),
    pool_info: { slug: pool.slug, name: pool.name, unitLabel: pool.unitLabel },
  };
}

/** One asset, as a pool of one. Null when the asset does not exist. */
export async function loadAssetCapacity(
  assetId: string,
  today: Date,
  options: CapacityOptions = {},
): Promise<LoadedCapacity | null> {
  const assets = await loadAssets({ id: assetId }, today, options);
  if (!assets.length) return null;
  return { ...computeCapacity(assets, today, options), pool_info: null };
}

async function loadAssets(
  where: Prisma.AssetWhereInput,
  today: Date,
  options: CapacityOptions,
): Promise<CapacityAsset[]> {
  const from = options.from && options.from > today ? options.from : today;
  const to = options.to && options.to > from ? options.to : from;
  // An order whose end is well before the window can still occupy it through
  // return transit + buffer (at most ~2 weeks), and one that is out and overdue
  // occupies it indefinitely. Everything else is outside the window.
  const lookback = new Date(from.getTime() - 45 * 86_400_000);

  const rows = await prisma.asset.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: { select: { refurbBufferDays: true } },
      units: {
        where: { status: { notIn: OUT_OF_FLEET } },
        select: {
          status: true,
          offeredAs: true,
          checkouts: {
            where: { ...OPEN_CHECKOUT, reservationId: null },
            select: { expectedReturn: true },
            take: 1,
          },
          maintenanceRecords: {
            where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, returnToInventory: true },
            select: { returnDate: true, completionDate: true },
          },
        },
      },
      reservationItems: {
        where: {
          parentId: null,
          // The chosen option only — as the order builder counts it.
          OR: [{ packageId: null }, { package: { isActive: true } }],
          reservation: {
            AND: [
              { OR: [HOLDS_STOCK, { status: TENTATIVE_STATUS }] },
              { startDate: { lte: to } },
              {
                OR: [
                  { endDate: { gte: lookback } },
                  { returnDate: { gte: lookback } },
                  { status: { in: ["SHIPPED", "ACTIVE"] } },
                ],
              },
            ],
          },
        },
        select: {
          quantity: true,
          checkedInCount: true,
          checkedOutCount: true,
          reservation: {
            select: {
              status: true,
              startDate: true,
              endDate: true,
              returnDate: true,
              returnMethod: true,
              returnTrackingNumber: true,
              reservationType: true,
              billingCycleType: true,
              isRecurring: true,
              termMonths: true,
              flowTermMonths: true,
            },
          },
        },
      },
    },
  });

  return rows.map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    refurbBufferDays: asset.category?.refurbBufferDays ?? DEFAULT_REFURB_BUFFER_DAYS,
    units: asset.units.map((unit) => ({
      status: unit.status,
      offeredAs: unit.offeredAs,
      looseCheckout: unit.checkouts[0] ? { expectedReturn: unit.checkouts[0].expectedReturn } : null,
      maintenanceReady: latest(
        unit.maintenanceRecords.map((job) => job.returnDate ?? job.completionDate),
      ),
    })),
    orders: asset.reservationItems.map((item) => ({
      quantity: item.quantity,
      checkedInCount: item.checkedInCount,
      checkedOutCount: item.checkedOutCount,
      ...item.reservation,
    })),
    holds: [],
  }));
}

/** The offerings the portal sells: rent-to-own is staff-only and never offered. */
export const PORTAL_OFFERINGS = ["RENTAL", "SALE", "FLOW"] as const;
export type PortalOffering = (typeof PORTAL_OFFERINGS)[number];

/**
 * One asset's figures per portal offering, from a single read — plus `ALL`,
 * every in-fleet unit, which the lines of one offer share. Each offering is the
 * asset's overall figure narrowed to the units ticked for that offering
 * (figuresForOffering). Null when the asset does not exist.
 */
export async function loadAssetCapacityByOffering(
  assetId: string,
  today: Date,
  options: CapacityOptions = {},
): Promise<Record<PortalOffering | "ALL", CapacityFigures> | null> {
  const assets = await loadAssets({ id: assetId }, today, options);
  if (!assets.length) return null;
  const all = computeCapacity(assets, today, options).pool;
  const qty = options.qty ?? 1;
  return {
    ALL: all,
    RENTAL: figuresForOffering(assets[0], all, "RENTAL", qty),
    SALE: figuresForOffering(assets[0], all, "SALE", qty),
    FLOW: figuresForOffering(assets[0], all, "FLOW", qty),
  };
}

/** The latest date among a unit's open jobs — it is ready when the last is done. Null if any is undated. */
function latest(dates: (Date | null)[]): Date | null {
  if (!dates.length || dates.some((date) => date === null)) return null;
  return (dates as Date[]).reduce((max, date) => (date > max ? date : max));
}
