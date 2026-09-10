"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { isRateTier, RATE_TIER_LABEL, type RateTier } from "@/lib/queries/pricing";

/**
 * Writing catalogue prices, from Operate → Pricing.
 *
 * A wrapper in the house style — `{status, message}` out, never a throw — over
 * a targeted `asset.update`, rather than reaching for the ported `updateAsset`.
 * That one takes the whole `AssetFormData` and would need every other field
 * round-tripped through the browser to change one number, which is how an edit
 * to a rate quietly reverts a category somebody else changed in between.
 *
 * Changing a rate here does **not** touch orders already priced. Every
 * `ReservationItem` carries its own `rate`, captured when the line was added,
 * and `deriveItemAmount` reads that rather than looking the asset up again — so
 * an agreed price stays agreed and this only affects what gets quoted next.
 * That is the same rule `applyRateCard` states, and the reason a rate change
 * needs no confirmation dialog: nothing already agreed can move under it.
 */

export type PricingOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/** Two decimal places, non-negative, and null when the field is cleared. */
function parseAmount(input: number | null): number | null | undefined {
  if (input === null) return null;
  if (!Number.isFinite(input)) return undefined;
  if (input < 0) return undefined;
  return Math.round(input * 100) / 100;
}

export async function setAssetRate(
  assetId: string,
  tier: string,
  value: number | null,
): Promise<PricingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error };
  }

  if (!isRateTier(tier)) {
    return { status: "error", message: "Not a rate this catalogue keeps." };
  }

  const amount = parseAmount(value);
  if (amount === undefined) {
    return { status: "error", message: "Enter an amount of zero or more." };
  }

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true, name: true, dailyRate: true, weeklyRate: true, monthlyRate: true, salePrice: true },
  });
  if (!asset) {
    return { status: "error", message: "That model no longer exists." };
  }

  const before = asset[tier as RateTier];
  const previous = before === null ? null : Number(before);
  if (previous === amount) {
    return { status: "ok", message: "Unchanged." };
  }

  await prisma.asset.update({
    where: { id: assetId },
    data: { [tier]: amount },
  });

  await logAudit({
    action: "UPDATE",
    entityType: "Asset",
    entityId: assetId,
    userId: auth.userId,
    oldValues: { [tier]: previous },
    newValues: { [tier]: amount },
  });

  revalidatePath("/dashboard/pricing");
  revalidatePath(`/dashboard/assets/${assetId}`);

  return {
    status: "ok",
    message:
      amount === null
        ? `${RATE_TIER_LABEL[tier]} cleared on ${asset.name}.`
        : `${RATE_TIER_LABEL[tier]} set on ${asset.name}.`,
  };
}
