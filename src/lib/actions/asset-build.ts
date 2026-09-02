"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import type { ComponentPriceMode, PricingType } from "@/generated/prisma/client";

/**
 * What a SKU is built from, and putting that build on an order.
 *
 * The old way was categories. A category flagged `isConfigurable` could host
 * children, a category flagged `isComponent` could be one, and the actual
 * specification lived in the asset's name — "Intel U9 285K Workstation / 64GB
 * RAM / 1TB NVMe SSD". Nothing recorded what a workstation normally contains,
 * so the configuration was rebuilt by hand on every order, and the category
 * list filled up with entries that exist only as spec labels and hold no assets
 * at all: "RAM: 64GB", "8TB M.2 NVMe SSD", "RAM: 128GB".
 *
 * A build is recorded once on the SKU and expanded onto the order. It stays
 * editable there, because the same machine genuinely goes out configured
 * differently depending on who ordered it — the existing data prices the same
 * RTX 4090 at $300, $350 and $360 across three orders.
 */

export type BuildOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work.";
}

export type BuildRow = {
  id: string;
  componentAssetId: string;
  name: string;
  categoryName: string | null;
  quantity: number;
  priceMode: ComponentPriceMode;
  isDefault: boolean;
  tracked: boolean;
  /** What it would be charged at — the override, or the component's own rate. */
  rate: number;
  rateOverride: number | null;
  notes: string | null;
  sortOrder: number;
  /** Units of this component in the fleet, for the "is it trackable" reading. */
  fleet: number;
};

/** The rate a component charges on an order of this pricing cadence. */
function rateFor(
  asset: { dailyRate: unknown; weeklyRate: unknown; monthlyRate: unknown; salePrice: unknown },
  pricingType: string,
  sale: boolean,
): number {
  if (sale) return Number(asset.salePrice ?? 0);
  switch (pricingType) {
    case "DAILY":
      return Number(asset.dailyRate ?? 0);
    case "WEEKLY":
      return Number(asset.weeklyRate ?? 0);
    case "MONTHLY":
      return Number(asset.monthlyRate ?? 0);
    default:
      return Number(asset.monthlyRate ?? asset.dailyRate ?? 0);
  }
}

export async function getAssetBuild(assetId: string): Promise<BuildRow[]> {
  const rows = await prisma.assetComponent.findMany({
    where: { assetId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      componentAsset: {
        select: {
          id: true,
          name: true,
          dailyRate: true,
          weeklyRate: true,
          monthlyRate: true,
          salePrice: true,
          category: { select: { name: true } },
          _count: {
            select: { units: { where: { status: { notIn: ["RETIRED", "SOLD"] } } } },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    componentAssetId: row.componentAssetId,
    name: row.componentAsset.name,
    categoryName: row.componentAsset.category?.name ?? null,
    quantity: row.quantity,
    priceMode: row.priceMode,
    isDefault: row.isDefault,
    tracked: row.tracked,
    rate:
      row.rateOverride != null
        ? Number(row.rateOverride)
        : rateFor(row.componentAsset, "MONTHLY", false),
    rateOverride: row.rateOverride == null ? null : Number(row.rateOverride),
    notes: row.notes,
    sortOrder: row.sortOrder,
    fleet: row.componentAsset._count.units,
  }));
}

export async function addBuildComponent(
  assetId: string,
  input: {
    componentAssetId: string;
    quantity?: number;
    priceMode?: ComponentPriceMode;
    isDefault?: boolean;
    tracked?: boolean;
    rateOverride?: number | null;
  },
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  if (assetId === input.componentAssetId) {
    return { status: "error", message: "A SKU cannot be a part of itself." };
  }

  // One level deep, deliberately. A part that is itself built from parts is a
  // tree, and a tree on a quote line is unreadable — the order record and the
  // client-facing quote both render exactly one level of indent.
  const componentHasBuild = await prisma.assetComponent.count({
    where: { assetId: input.componentAssetId },
  });
  if (componentHasBuild > 0) {
    return {
      status: "error",
      message:
        "That asset has a build of its own, so it is a SKU rather than a part. Nesting is one level deep.",
    };
  }

  try {
    const last = await prisma.assetComponent.aggregate({
      where: { assetId },
      _max: { sortOrder: true },
    });
    await prisma.assetComponent.create({
      data: {
        assetId,
        componentAssetId: input.componentAssetId,
        quantity: input.quantity ?? 1,
        priceMode: input.priceMode ?? "ADDS",
        isDefault: input.isDefault ?? true,
        tracked: input.tracked ?? false,
        rateOverride: input.rateOverride ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
    revalidatePath(`/dashboard/assets/${assetId}`);
    return { status: "ok", message: "Part added to the build." };
  } catch (error) {
    const message = reasonFrom(error);
    if (message.includes("Unique constraint")) {
      return {
        status: "error",
        message: "That part is already in this build — change its quantity instead.",
      };
    }
    return { status: "error", message };
  }
}

export async function updateBuildComponent(
  id: string,
  patch: {
    quantity?: number;
    priceMode?: ComponentPriceMode;
    isDefault?: boolean;
    tracked?: boolean;
    rateOverride?: number | null;
  },
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  if (patch.quantity != null && (!Number.isInteger(patch.quantity) || patch.quantity < 1)) {
    return { status: "error", message: "A part goes in at least once." };
  }

  try {
    const row = await prisma.assetComponent.update({ where: { id }, data: patch });
    revalidatePath(`/dashboard/assets/${row.assetId}`);
    return { status: "ok", message: "Build updated." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function removeBuildComponent(id: string): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    const row = await prisma.assetComponent.delete({ where: { id } });
    revalidatePath(`/dashboard/assets/${row.assetId}`);
    return { status: "ok", message: "Part removed from the build." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/** Assets that can be a part: anything without a build of its own. */
export async function lookupParts(query: string, excludeAssetId: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const needle = query.trim();
  if (needle.length < 2) return [];

  const assets = await prisma.asset.findMany({
    where: {
      id: { not: excludeAssetId },
      name: { contains: needle, mode: "insensitive" },
      components: { none: {} },
    },
    take: 8,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      dailyRate: true,
      category: { select: { name: true } },
      _count: { select: { units: { where: { status: { notIn: ["RETIRED", "SOLD"] } } } } },
    },
  });

  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    categoryName: asset.category?.name ?? null,
    rate: Number(asset.monthlyRate ?? asset.dailyRate ?? 0),
    fleet: asset._count.units,
  }));
}

/**
 * Expand a SKU's default build onto an order line.
 *
 * Called after the parent line is created. Every default part becomes a nested
 * `ReservationItem`, priced at the cadence the parent is priced at — a part
 * charged monthly on a monthly order and daily on a daily one, because a build
 * that quotes its GPU on a different cadence to its workstation is a quote
 * nobody can add up.
 *
 * An INCLUDED part is written at its real rate with `includedInParent` set,
 * rather than at zero. The rate is what the part is worth and is wanted when
 * somebody swaps it for a different one; the flag is what stops it being
 * charged. Writing zero would lose the first to express the second.
 */
export async function expandBuildOntoLine(
  reservationId: string,
  parentItemId: string,
): Promise<{ added: number }> {
  const parent = await prisma.reservationItem.findUnique({
    where: { id: parentItemId },
    select: {
      id: true,
      assetId: true,
      packageId: true,
      pricingType: true,
      isOneTime: true,
      quantity: true,
      reservation: {
        select: { id: true, reservationType: true, startDate: true, endDate: true, isRecurring: true },
      },
    },
  });
  if (!parent?.assetId || parent.reservation.id !== reservationId) return { added: 0 };

  const build = await prisma.assetComponent.findMany({
    where: { assetId: parent.assetId, isDefault: true },
    orderBy: [{ sortOrder: "asc" }],
    include: {
      componentAsset: {
        select: { id: true, dailyRate: true, weeklyRate: true, monthlyRate: true, salePrice: true },
      },
    },
  });
  if (build.length === 0) return { added: 0 };

  const { calculatePeriods } = await import("@/lib/actions/reservations");
  const sale =
    parent.reservation.reservationType === "SALE" ||
    parent.reservation.reservationType === "CLOUD";
  const periods = parent.isOneTime
    ? 1
    : await calculatePeriods(
        parent.reservation.startDate,
        parent.reservation.endDate,
        parent.pricingType,
        parent.reservation.isRecurring,
      );

  const last = await prisma.reservationItem.aggregate({
    where: { reservationId, packageId: parent.packageId },
    _max: { sortOrder: true },
  });
  let sortOrder = (last._max.sortOrder ?? 0) + 1;

  const rows = build.map((row) => {
    const rate =
      row.rateOverride != null
        ? Number(row.rateOverride)
        : rateFor(row.componentAsset, parent.pricingType, sale);
    const included = row.priceMode === "INCLUDED";
    return {
      reservationId,
      packageId: parent.packageId,
      parentId: parent.id,
      assetId: row.componentAssetId,
      pricingType: parent.pricingType as PricingType,
      isOneTime: parent.isOneTime,
      quantity: row.quantity * parent.quantity,
      rate,
      // An included part contributes nothing, whatever its rate says.
      subtotal: included ? 0 : rate * row.quantity * parent.quantity * periods,
      includedInParent: included,
      sortOrder: sortOrder++,
    };
  });

  await prisma.reservationItem.createMany({ data: rows });
  return { added: rows.length };
}
