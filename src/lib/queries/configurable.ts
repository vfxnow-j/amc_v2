import { prisma } from "@/lib/prisma";
import type { ConfigSlot } from "@/generated/prisma/client";

/**
 * Reads behind Settings → Configurable items. An item is configurable when it
 * has at least one option recorded (`AssetComponent`); there is no separate
 * flag to keep in step.
 */

export const SLOT_LABEL: Record<ConfigSlot, string> = {
  GPU: "GPU",
  MEMORY: "Memory",
  STORAGE: "Storage",
  ADDON: "Add-ons",
  OTHER: "Other",
};

export async function listConfigurableItems() {
  const assets = await prisma.asset.findMany({
    where: { components: { some: {} } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      category: { select: { name: true } },
      components: {
        select: { slot: true, isDefault: true },
      },
      _count: { select: { units: { where: { status: { notIn: ["RETIRED", "SOLD"] } } } } },
    },
  });
  return assets.map((asset) => {
    const slots = new Map<ConfigSlot, number>();
    for (const option of asset.components) slots.set(option.slot, (slots.get(option.slot) ?? 0) + 1);
    return {
      id: asset.id,
      name: asset.name,
      category: asset.category?.name ?? null,
      monthlyRate: Number(asset.monthlyRate ?? 0),
      units: asset._count.units,
      base: asset.components.filter((option) => option.isDefault).length,
      options: asset.components.length,
      slots: [...slots.entries()].map(([slot, count]) => ({ slot, count })),
    };
  });
}

export async function getConfigurableItem(assetId: string) {
  return prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      name: true,
      monthlyRate: true,
      weeklyRate: true,
      dailyRate: true,
      salePrice: true,
      category: { select: { name: true } },
    },
  });
}
