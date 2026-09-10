"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import {
  createService,
  deleteService,
  updateService,
} from "@/lib/actions/services";
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

/* ── The service catalogue ──────────────────────────────────────────────── */

/**
 * `createService`, `updateService` and `deleteService` were ported months ago
 * and reachable from nothing: Operate → Services listed the catalogue and
 * offered no way to add to it. These wrap them in the house outcome shape —
 * they throw, and a form wants a message, not a stack trace.
 *
 * `deleteService` refuses while any order line still references the row. That
 * guard is the server's and stays there; the form only mirrors it so the button
 * explains itself before it is pressed.
 */

export type ServiceInput = {
  name: string;
  description: string | null;
  defaultRate: number;
  unit: string;
  active: boolean;
};

function serviceProblem(input: ServiceInput): string | null {
  if (!input.name.trim()) return "A service needs a name.";
  if (!Number.isFinite(input.defaultRate) || input.defaultRate < 0) {
    return "Enter a default rate of zero or more.";
  }
  return null;
}

export async function createServiceEntry(
  input: ServiceInput,
): Promise<PricingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const problem = serviceProblem(input);
  if (problem) return { status: "error", message: problem };

  try {
    await createService({
      name: input.name.trim(),
      description: input.description ?? undefined,
      defaultRate: input.defaultRate,
      unit: input.unit,
    });
    // createService has no `active` argument — the column defaults to true, so
    // a service added as "not offered" needs a second write to say so.
    if (!input.active) {
      const created = await prisma.service.findFirst({
        where: { name: input.name.trim() },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (created) await updateService(created.id, { active: false });
    }
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not add it.",
    };
  }

  revalidatePath("/dashboard/pricing/services");
  return { status: "ok", message: `${input.name.trim()} added.` };
}

export async function updateServiceEntry(
  id: string,
  input: ServiceInput,
): Promise<PricingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const problem = serviceProblem(input);
  if (problem) return { status: "error", message: problem };

  try {
    await updateService(id, {
      name: input.name.trim(),
      description: input.description ?? "",
      defaultRate: input.defaultRate,
      unit: input.unit,
      active: input.active,
    });
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not save it.",
    };
  }

  revalidatePath("/dashboard/pricing/services");
  return { status: "ok", message: `${input.name.trim()} saved.` };
}

export async function deleteServiceEntry(id: string): Promise<PricingOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  try {
    await deleteService(id);
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not delete it.",
    };
  }

  revalidatePath("/dashboard/pricing/services");
  return { status: "ok", message: "Service deleted." };
}
