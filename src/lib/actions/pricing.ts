"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import type { ServiceKind } from "@/generated/prisma/enums";
import {
  createService,
  deleteService,
  updateService,
} from "@/lib/actions/services";
import { isRateTier, RATE_TIER_LABEL, type RateTier } from "@/lib/queries/pricing";
import {
  applyBulkChange,
  bulkChangeProblem,
  type BulkRateChange,
} from "@/lib/pricing/bulk-rates";

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

/* ── Many models at once ────────────────────────────────────────────────── */

export type BulkRateRequest = {
  assetIds: string[];
  /** Tiers left out are left alone — a blank field in the dialog. */
  changes: Partial<Record<RateTier, BulkRateChange>>;
};

/** More than a few pages of the catalogue in one go is a mistake, not an edit. */
const BULK_LIMIT = 500;

function bulkProblem(request: BulkRateRequest): string | null {
  const ids = request.assetIds;
  if (!Array.isArray(ids) || ids.length === 0) return "Select at least one model.";
  if (ids.length > BULK_LIMIT) {
    return `Edit at most ${BULK_LIMIT} models at a time.`;
  }
  if (ids.some((id) => typeof id !== "string")) return "Select at least one model.";

  const entries = Object.entries(request.changes ?? {});
  if (entries.length === 0) return "Enter at least one new rate.";

  for (const [tier, change] of entries) {
    if (!isRateTier(tier) || !change) return "Not a rate this catalogue keeps.";
    const problem = bulkChangeProblem(change);
    if (problem) return `${RATE_TIER_LABEL[tier]}: ${problem}`;
  }
  return null;
}

/**
 * Operate → Pricing's bulk edit: new figures for several models in one go.
 *
 * The same rules as `setAssetRate`, applied to a selection — editor access,
 * zero or more, cents — and the same targeted update of the rate columns only,
 * for the same reason. The whole request is checked before anything is read,
 * so one bad figure writes nothing at all.
 *
 * The current rates are read and the new ones written inside one transaction.
 * An adjustment is worked out from what the database holds at that moment, not
 * from what the browser showed in its preview, so a price somebody changed
 * inline in between is adjusted from its real value rather than overwritten
 * with a stale one. A model whose figures come out identical is skipped and
 * not counted, and a selected model that has since been deleted is skipped and
 * reported.
 *
 * One audit row per model changed, carrying only the tiers that moved — the
 * shape `setAssetRate` writes, so an asset's history reads the same whichever
 * screen changed it. `logAudit` writes through the global client and reads the
 * request headers, so the rows are written once the transaction has committed
 * rather than inside it: a price that failed to save leaves no record claiming
 * it did.
 */
export async function setAssetRatesBulk(
  request: BulkRateRequest,
): Promise<PricingOutcome & { updated?: number }> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error };
  }

  const problem = bulkProblem(request);
  if (problem) return { status: "error", message: problem };

  const ids = [...new Set(request.assetIds)];
  const changes = Object.entries(request.changes) as [RateTier, BulkRateChange][];

  const written = await prisma.$transaction(async (tx) => {
    const assets = await tx.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, dailyRate: true, weeklyRate: true, monthlyRate: true, salePrice: true },
    });

    const results: {
      id: string;
      oldValues: Record<string, number | null>;
      newValues: Record<string, number | null>;
    }[] = [];

    for (const asset of assets) {
      const oldValues: Record<string, number | null> = {};
      const newValues: Record<string, number | null> = {};

      for (const [tier, change] of changes) {
        const before = asset[tier] === null ? null : Number(asset[tier]);
        const after = applyBulkChange(before, change);
        if (after !== before) {
          oldValues[tier] = before;
          newValues[tier] = after;
        }
      }

      if (Object.keys(newValues).length === 0) continue;

      await tx.asset.update({ where: { id: asset.id }, data: newValues });
      results.push({ id: asset.id, oldValues, newValues });
    }

    return { results, missing: ids.length - assets.length };
    // One update per model, so a full selection is hundreds of statements —
    // well past the five seconds Prisma allows an interactive transaction.
  }, { timeout: 30_000 });

  await Promise.all(
    written.results.map((result) =>
      logAudit({
        action: "UPDATE",
        entityType: "Asset",
        entityId: result.id,
        userId: auth.userId,
        oldValues: result.oldValues,
        newValues: result.newValues,
      }),
    ),
  );

  revalidatePath("/dashboard/pricing");
  for (const result of written.results) {
    revalidatePath(`/dashboard/assets/${result.id}`);
  }

  const updated = written.results.length;
  const parts = [
    updated === 0
      ? "No rates changed — every selected model already had those figures."
      : `Rates updated on ${updated} ${updated === 1 ? "model" : "models"}.`,
  ];
  if (written.missing > 0) {
    parts.push(
      `${written.missing} selected ${written.missing === 1 ? "model no longer exists" : "models no longer exist"} and ${written.missing === 1 ? "was" : "were"} skipped.`,
    );
  }

  return { status: "ok", message: parts.join(" "), updated };
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
  kind: ServiceKind;
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
      kind: input.kind,
      active: input.active,
    });
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
      kind: input.kind,
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
