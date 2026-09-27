import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { HOLDS_STOCK_STATUSES, OUT_OF_FLEET } from "@/lib/inventory/availability";

/**
 * Availability behind the new-order builder.
 *
 * The commitment is counted from `ReservationItem.quantity`, not from unit
 * rows: an order approved for next month has promised six units without any
 * being assigned yet, and those six are exactly what must not be promised
 * twice. Counting rows would call them free and let the builder oversell.
 */

/**
 * Orders that hold stock. Quotes don't — nobody has agreed to them. Exported
 * for the portal's capacity loader (`lib/portal/capacity-load.ts`), which must
 * count commitment exactly as the builder does. The statuses themselves live
 * in `lib/inventory/availability.ts` (Prisma-value-free) so tests can read
 * them with no database.
 */
export const HOLDS_STOCK: Prisma.ReservationWhereInput = {
  status: { in: HOLDS_STOCK_STATUSES },
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
  /**
   * Units in the fleet sitting in MAINTENANCE today. They count as fleet (they
   * will earn again) but not as free: a unit on the bench can't be promised.
   */
  maintenance: number;
  /** `max(0, fleet − maintenance − committed)`. */
  free: number;
  /**
   * When enough units come back for the window to be satisfiable — the earliest
   * end date among the orders holding them. Null when nothing is holding any.
   */
  freeFrom: Date | null;
};

export function pickRate(asset: {
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

  return availabilityFor(
    {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { assetNumber: { contains: trimmed, mode: "insensitive" } },
        { manufacturer: { contains: trimmed, mode: "insensitive" } },
      ],
      units: { some: { status: { notIn: OUT_OF_FLEET } } },
    },
    start,
    end,
    take,
  );
}

/**
 * Specific assets across the window — the lines of one of our packages, when it
 * is dropped into a quote being built. No fleet filter: a package line for an
 * asset with nothing on the shelf still comes through, as nothing free.
 */
export async function availabilityForAssets(
  assetIds: string[],
  start: Date,
  end: Date,
): Promise<AssetAvailability[]> {
  if (assetIds.length === 0) return [];
  return availabilityFor({ id: { in: assetIds } }, start, end, assetIds.length);
}

/**
 * Fleet and bench counts from the in-fleet unit rows. Units in MAINTENANCE were
 * counted as free until 2026-09-26 — the builder would promise a unit on the
 * bench. They stay in `fleet` (capacity that will earn again) and come off
 * `free`. Units out on a checkout with no order are still not subtracted here;
 * the portal's capacity figure does that (`lib/portal/capacity.ts`).
 */
function fleetOf(units: { status: string }[]): { fleet: number; maintenance: number } {
  return {
    fleet: units.length,
    maintenance: units.filter((unit) => unit.status === "MAINTENANCE").length,
  };
}

/**
 * KNOWN OVER-COUNT (conservative — never oversells, so left as-is for now):
 * `committed` sums `ReservationItem.quantity` and is never reduced by check-ins,
 * so a still-open multi-unit order (APPROVED/PREPARING/SHIPPED/ACTIVE) keeps its
 * full quantity committed even after some of its units come back. If one of
 * those returns damaged (checked in to MAINTENANCE), that same physical unit is
 * then also counted in `maintenance` — it gets subtracted from `free` twice:
 * once inside the order's still-full `committed` quantity, once as a bench
 * unit. The builder under-reports `free` rather than over-reports it, which is
 * why this has not caused an oversell, but the number can be wrong low.
 * TODO: reduce `committed` by units already checked in (mirroring the portal's
 * `checkedOutCount`/`checkedInCount` netting in `lib/portal/capacity.ts`) so a
 * unit is never subtracted under both buckets. Not fixed here — this function
 * is not restructured as part of the portal capacity findings; see
 * docs/portal-api-plan.md and the capacity fix commit for context.
 */

async function availabilityFor(
  where: Prisma.AssetWhereInput,
  start: Date,
  end: Date,
  take: number,
): Promise<AssetAvailability[]> {
  const assets = await prisma.asset.findMany({
    where,
    take,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      weeklyRate: true,
      dailyRate: true,
      category: { select: { id: true, name: true } },
      units: { where: { status: { notIn: OUT_OF_FLEET } }, select: { status: true } },
      reservationItems: {
        where: {
          parentId: null,
          // Only the option an order goes ahead with holds stock. A quote
          // offering three builds would otherwise count all three against the
          // shelf, and an alternative nobody chose would block the next order.
          OR: [{ packageId: null }, { package: { isActive: true } }],
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
    const { fleet, maintenance } = fleetOf(asset.units);
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
      maintenance,
      free: Math.max(0, fleet - maintenance - committed),
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
      units: { where: { status: { notIn: OUT_OF_FLEET } }, select: { status: true } },
      reservationItems: {
        where: {
          parentId: null,
          // The chosen option only — see availabilityFor.
          OR: [{ packageId: null }, { package: { isActive: true } }],
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
      const { fleet, maintenance } = fleetOf(asset.units);
      return {
        assetId: asset.id,
        name: asset.name,
        category: asset.category?.name ?? null,
        categoryId: asset.category?.id ?? null,
        ...pickRate(asset),
        fleet,
        committed,
        maintenance,
        free: Math.max(0, fleet - maintenance - committed),
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
