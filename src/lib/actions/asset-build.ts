"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import type { ComponentPriceMode, ConfigSlot, PricingType } from "@/generated/prisma/client";

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

function revalidateBuild(assetId: string) {
  revalidatePath(`/dashboard/assets/${assetId}`);
  revalidatePath("/dashboard/settings/configurable-items");
  revalidatePath(`/dashboard/settings/configurable-items/${assetId}`);
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work.";
}

export type BuildRow = {
  id: string;
  /** Null for a spec option (RAM, most storage) that isn't stocked as an asset. */
  componentAssetId: string | null;
  name: string;
  slot: ConfigSlot;
  categoryName: string | null;
  quantity: number;
  priceMode: ComponentPriceMode;
  isDefault: boolean;
  tracked: boolean;
  /** What it would be charged at — the override, or the component's own rate. */
  rate: number;
  rateOverride: number | null;
  salePrice: number | null;
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
    name: row.componentAsset?.name ?? row.label ?? "Option",
    slot: row.slot,
    categoryName: row.componentAsset?.category?.name ?? null,
    quantity: row.quantity,
    priceMode: row.priceMode,
    isDefault: row.isDefault,
    tracked: row.tracked,
    rate:
      row.rateOverride != null
        ? Number(row.rateOverride)
        : row.componentAsset
          ? rateFor(row.componentAsset, "MONTHLY", false)
          : 0,
    rateOverride: row.rateOverride == null ? null : Number(row.rateOverride),
    salePrice: row.salePrice == null ? null : Number(row.salePrice),
    notes: row.notes,
    sortOrder: row.sortOrder,
    fleet: row.componentAsset?._count.units ?? 0,
  }));
}

export async function addBuildComponent(
  assetId: string,
  input: {
    /** An asset part (a GPU). Omit, with a `label`, for a spec option. */
    componentAssetId?: string | null;
    /** A spec option's name — "128GB DDR5" — when there is no asset. */
    label?: string | null;
    slot?: ConfigSlot;
    quantity?: number;
    priceMode?: ComponentPriceMode;
    isDefault?: boolean;
    tracked?: boolean;
    rateOverride?: number | null;
    salePrice?: number | null;
  },
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  if (!input.componentAssetId && !input.label?.trim()) {
    return { status: "error", message: "An option is either an asset or a named spec like “128GB DDR5”." };
  }
  if (input.componentAssetId && assetId === input.componentAssetId) {
    return { status: "error", message: "A SKU cannot be a part of itself." };
  }
  for (const price of [input.rateOverride, input.salePrice]) {
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      return { status: "error", message: "A price is zero or more." };
    }
  }

  // One level deep, deliberately. A part that is itself built from parts is a
  // tree, and a tree on a quote line is unreadable — the order record and the
  // client-facing quote both render exactly one level of indent.
  const componentHasBuild = input.componentAssetId
    ? await prisma.assetComponent.count({ where: { assetId: input.componentAssetId } })
    : 0;
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
        componentAssetId: input.componentAssetId || null,
        label: input.componentAssetId ? null : input.label!.trim(),
        slot: input.slot ?? "OTHER",
        quantity: input.quantity ?? 1,
        priceMode: input.priceMode ?? "ADDS",
        isDefault: input.isDefault ?? true,
        // Only an asset has units to scan.
        tracked: input.componentAssetId ? (input.tracked ?? false) : false,
        rateOverride: input.rateOverride ?? null,
        salePrice: input.salePrice ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
    revalidateBuild(assetId);
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
    label?: string;
    slot?: ConfigSlot;
    quantity?: number;
    priceMode?: ComponentPriceMode;
    isDefault?: boolean;
    tracked?: boolean;
    rateOverride?: number | null;
    salePrice?: number | null;
    notes?: string | null;
  },
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  if (patch.quantity != null && (!Number.isInteger(patch.quantity) || patch.quantity < 1)) {
    return { status: "error", message: "A part goes in at least once." };
  }
  if (patch.label !== undefined && !patch.label.trim()) {
    return { status: "error", message: "A spec option needs a name." };
  }

  try {
    const row = await prisma.assetComponent.update({
      where: { id },
      data: { ...patch, ...(patch.label !== undefined ? { label: patch.label.trim() } : {}) },
    });
    revalidateBuild(row.assetId);
    return { status: "ok", message: "Build updated." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

/**
 * Change what an option *is*: rename a spec option, point an asset option at a
 * different asset, or turn one kind into the other. Orders already configured
 * keep the part rows they have — a line's parts are matched to options by asset
 * or name, so a renamed or swapped option simply stops matching the old row,
 * which the Configure dialog then lists as "also on this line, unchanged".
 */
export async function editBuildOption(
  id: string,
  input: { slot: ConfigSlot; componentAssetId: string | null; label: string | null },
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const row = await prisma.assetComponent.findUnique({ where: { id }, select: { assetId: true } });
  if (!row) return { status: "error", message: "That option no longer exists." };

  const label = input.label?.trim() ?? "";
  if (!input.componentAssetId && !label) {
    return { status: "error", message: "An option is either an asset or a named spec like “128GB DDR5”." };
  }
  if (input.componentAssetId) {
    if (input.componentAssetId === row.assetId) {
      return { status: "error", message: "A SKU cannot be a part of itself." };
    }
    const nested = await prisma.assetComponent.count({ where: { assetId: input.componentAssetId } });
    if (nested > 0) {
      return { status: "error", message: "That asset has a build of its own, so it can't be a part. Nesting is one level deep." };
    }
    const duplicate = await prisma.assetComponent.count({
      where: { assetId: row.assetId, componentAssetId: input.componentAssetId, id: { not: id } },
    });
    if (duplicate > 0) return { status: "error", message: "That asset is already an option on this item." };
  }

  try {
    await prisma.assetComponent.update({
      where: { id },
      data: {
        slot: input.slot,
        componentAssetId: input.componentAssetId,
        label: input.componentAssetId ? null : label,
        // Only an asset has units to scan; GPUs and add-ons are scanned out, as on add.
        tracked: Boolean(input.componentAssetId) && (input.slot === "GPU" || input.slot === "ADDON"),
      },
    });
    revalidateBuild(row.assetId);
    return { status: "ok", message: "Option updated." };
  } catch (error) {
    return { status: "error", message: reasonFrom(error) };
  }
}

export async function removeBuildComponent(id: string): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };
  try {
    const row = await prisma.assetComponent.delete({ where: { id } });
    revalidateBuild(row.assetId);
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
    const rate = optionRate(row, parent.pricingType, sale);
    const included = row.priceMode === "INCLUDED";
    return {
      reservationId,
      packageId: parent.packageId,
      parentId: parent.id,
      assetId: row.componentAssetId,
      // A spec option has no asset, so its name is the line.
      description: row.componentAssetId ? null : row.label,
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

/**
 * What one configuration option charges on a line of this cadence: its own
 * price when set (the sale price on a sale), else the part asset's rate. A spec
 * option with no price set is free — it is spec, not an upgrade.
 */
export async function optionRateFor(
  row: {
    rateOverride: unknown;
    salePrice: unknown;
    componentAsset: { dailyRate: unknown; weeklyRate: unknown; monthlyRate: unknown; salePrice: unknown } | null;
  },
  pricingType: string,
  sale: boolean,
): Promise<number> {
  return optionRate(row, pricingType, sale);
}

function optionRate(
  row: {
    rateOverride: unknown;
    salePrice: unknown;
    componentAsset: { dailyRate: unknown; weeklyRate: unknown; monthlyRate: unknown; salePrice: unknown } | null;
  },
  pricingType: string,
  sale: boolean,
): number {
  if (sale) {
    if (row.salePrice != null) return Number(row.salePrice);
    return row.componentAsset ? rateFor(row.componentAsset, pricingType, true) : 0;
  }
  if (row.rateOverride != null) return Number(row.rateOverride);
  return row.componentAsset ? rateFor(row.componentAsset, pricingType, false) : 0;
}

/* ── Configuring a line on an order ─────────────────────────────────────── */

export type LineOption = {
  optionId: string;
  name: string;
  slot: ConfigSlot;
  /** Part of the base build — included in the machine's rate. */
  base: boolean;
  included: boolean;
  /** What it charges per machine at this line's cadence (0 when included). */
  rate: number;
  /** Per machine, as the option is defined. */
  defaultQuantity: number;
  /** On this line now, per machine. */
  selected: number;
  /** Units scanned out against it on this line — it can't be taken off. */
  out: number;
  tracked: boolean;
  /** Chosen from stock: an asset whose units are scanned with the machine. */
  asset: boolean;
};

export type LineConfiguration = {
  itemId: string;
  name: string;
  quantity: number;
  pricingType: string;
  sale: boolean;
  /** The machine's own rate on this line. */
  baseRate: number;
  options: LineOption[];
  /** Parts on the line that match no option — kept as they are. */
  otherParts: { name: string; quantity: number }[];
};

async function lineContext(reservationId: string, itemId: string) {
  const parent = await prisma.reservationItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      assetId: true,
      packageId: true,
      pricingType: true,
      isOneTime: true,
      quantity: true,
      rate: true,
      asset: { select: { name: true } },
      reservation: {
        select: { id: true, status: true, reservationType: true, startDate: true, endDate: true, isRecurring: true },
      },
      components: {
        select: { id: true, assetId: true, description: true, quantity: true, checkedOutCount: true },
      },
    },
  });
  if (!parent?.assetId || parent.reservation.id !== reservationId) return null;
  const options = await prisma.assetComponent.findMany({
    where: { assetId: parent.assetId },
    orderBy: [{ slot: "asc" }, { sortOrder: "asc" }],
    include: {
      componentAsset: {
        select: { name: true, dailyRate: true, weeklyRate: true, monthlyRate: true, salePrice: true },
      },
    },
  });
  const sale = parent.reservation.reservationType === "SALE" || parent.reservation.reservationType === "CLOUD";
  // A line's part row belongs to the option with its asset, or its label.
  const matchFor = (option: (typeof options)[number]) =>
    parent.components.find((part) =>
      option.componentAssetId
        ? part.assetId === option.componentAssetId
        : !part.assetId && part.description?.trim().toLowerCase() === option.label?.trim().toLowerCase(),
    );
  return { parent, options, sale, matchFor };
}

/** A line's configurable options and what is on it now, for the Configure dialog. */
export async function getLineConfiguration(
  reservationId: string,
  itemId: string,
): Promise<LineConfiguration | null> {
  const auth = await requireEditor();
  if (!auth.authorized) return null;
  const context = await lineContext(reservationId, itemId);
  if (!context || context.options.length === 0) return null;
  const { parent, options, sale, matchFor } = context;

  const matched = new Set<string>();
  const rows: LineOption[] = options.map((option) => {
    const part = matchFor(option);
    if (part) matched.add(part.id);
    const perMachine = part ? Math.max(1, Math.round(part.quantity / Math.max(1, parent.quantity))) : 0;
    return {
      optionId: option.id,
      name: option.componentAsset?.name ?? option.label ?? "Option",
      slot: option.slot,
      base: option.isDefault,
      included: option.priceMode === "INCLUDED",
      rate: option.priceMode === "INCLUDED" ? 0 : optionRate(option, parent.pricingType, sale),
      defaultQuantity: option.quantity,
      selected: part ? perMachine : 0,
      out: part?.checkedOutCount ?? 0,
      tracked: option.tracked,
      asset: option.componentAssetId !== null,
    };
  });

  return {
    itemId: parent.id,
    name: parent.asset?.name ?? "Line",
    quantity: parent.quantity,
    pricingType: parent.pricingType,
    sale,
    baseRate: Number(parent.rate),
    options: rows,
    otherParts: parent.components
      .filter((part) => !matched.has(part.id))
      .map((part) => ({ name: part.description ?? "Part", quantity: part.quantity })),
  };
}

/**
 * Apply a configuration to a machine on an order: which options it goes out
 * with, and how many of each per machine.
 *
 * Each option's part row under the line is created, re-quantified or removed to
 * match. Memory is one choice; storage, GPUs and add-ons take several. A part with units already
 * scanned out against it can't be removed or reduced below them. Parts that
 * match no option (older orders' free-text spec lines) are left as they are.
 * The order is repriced once at the end.
 */
export async function configureLine(
  reservationId: string,
  itemId: string,
  selections: { optionId: string; quantity: number }[],
): Promise<BuildOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error ?? "Unauthorized" };

  const context = await lineContext(reservationId, itemId);
  if (!context) return { status: "error", message: "That line isn't a configurable machine on this order." };
  const { parent, options, sale, matchFor } = context;
  if (["COMPLETED", "CANCELLED", "LOST"].includes(parent.reservation.status)) {
    return { status: "error", message: "This order is closed, so its lines can't change." };
  }

  const wanted = new Map<string, number>();
  for (const selection of selections) {
    if (!Number.isInteger(selection.quantity) || selection.quantity < 0 || selection.quantity > 64) {
      return { status: "error", message: "Quantities are whole numbers from 0 to 64." };
    }
    if (selection.quantity > 0) wanted.set(selection.optionId, selection.quantity);
  }
  // Memory is one configuration per machine. Storage takes several — a base
  // drive plus an extra one (owner, 2026-09-17).
  if (options.filter((option) => option.slot === "MEMORY" && wanted.has(option.id)).length > 1) {
    return { status: "error", message: "Choose one memory configuration." };
  }

  const { calculatePeriods } = await import("@/lib/actions/reservations");
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

  const writes: (() => Promise<unknown>)[] = [];
  for (const option of options) {
    const part = matchFor(option);
    const perMachine = wanted.get(option.id) ?? 0;
    const quantity = perMachine * parent.quantity;
    const name = option.componentAsset?.name ?? option.label ?? "Option";

    if (part && quantity < part.checkedOutCount) {
      return {
        status: "error",
        message: `${part.checkedOutCount} ${name} ${part.checkedOutCount === 1 ? "is" : "are"} out with the client on this line — check ${part.checkedOutCount === 1 ? "it" : "them"} in before taking ${part.checkedOutCount === 1 ? "it" : "them"} off.`,
      };
    }

    const included = option.priceMode === "INCLUDED";
    const rate = optionRate(option, parent.pricingType, sale);
    const subtotal = included ? 0 : rate * quantity * periods;

    if (quantity === 0 && part) {
      writes.push(() => prisma.reservationItem.delete({ where: { id: part.id } }));
    } else if (quantity > 0 && part) {
      writes.push(() =>
        prisma.reservationItem.update({
          where: { id: part.id },
          data: { quantity, rate, subtotal, includedInParent: included, pricingType: parent.pricingType as PricingType },
        }),
      );
    } else if (quantity > 0) {
      writes.push(() =>
        prisma.reservationItem.create({
          data: {
            reservationId,
            packageId: parent.packageId,
            parentId: parent.id,
            assetId: option.componentAssetId,
            description: option.componentAssetId ? null : option.label,
            pricingType: parent.pricingType as PricingType,
            isOneTime: parent.isOneTime,
            quantity,
            rate,
            subtotal,
            includedInParent: included,
            sortOrder: sortOrder++,
          },
        }),
      );
    }
  }

  for (const write of writes) await write();
  const { repriceOrderAfterEdit } = await import("@/lib/actions/order-stage");
  await repriceOrderAfterEdit(reservationId);
  return { status: "ok", message: `${parent.asset?.name ?? "Machine"} configured.` };
}

/** Any asset, for choosing an item to make configurable. Parts are left out. */
export async function lookupConfigurableCandidates(query: string) {
  const auth = await requireEditor();
  if (!auth.authorized) return [];
  const needle = query.trim();
  if (needle.length < 2) return [];
  const assets = await prisma.asset.findMany({
    where: { name: { contains: needle, mode: "insensitive" }, partOf: { none: {} } },
    take: 10,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      _count: { select: { components: true } },
    },
  });
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    categoryName: asset.category?.name ?? null,
    configurable: asset._count.components > 0,
  }));
}
