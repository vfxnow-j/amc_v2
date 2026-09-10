"use server";

import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { bulkUpdateAssets, type BulkUpdateData } from "@/lib/actions/assets";
import { OUT_OF_FLEET } from "@/lib/inventory/availability";
import { revalidatePath } from "next/cache";

/**
 * Running an action over everything on a scan list.
 *
 * `bulkUpdateAssets` has existed since the port and been reachable from
 * nothing. This is the wiring, and it comes with a preview, because the shape
 * of the data makes an unpreviewed bulk rate change genuinely dangerous:
 *
 * **Rates live on `Asset`, not `AssetUnit`.** Scanning three of forty RTX 5090s
 * onto a list and setting a daily rate changes the rate on all forty, and on
 * every future quote that prices one. The person scanning is holding three
 * boxes and thinking about three boxes. So the preview reports the blast radius
 * in numbers — how many models, how many units they cover, and how many of
 * those units are not on the list — and the screen is required to say it out
 * loud before anything is written.
 *
 * `bulkUpdateAssetRates` in actions/import is deliberately not used here. It
 * gates on `auth()` alone rather than `requireEditor`, and with empty filters
 * its where clause is `{}` — one call reprices the entire catalogue. Both were
 * fixed in the hardening pass, and it still has no business behind a scanner.
 */

export type BulkOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export type BulkTargetModel = {
  assetId: string;
  name: string;
  /** Units of this model that are on the list. */
  onList: number;
  /** Units of this model in the fleet at all. */
  inFleet: number;
  dailyRate: number | null;
  weeklyRate: number | null;
  monthlyRate: number | null;
};

export type BulkTarget = {
  models: BulkTargetModel[];
  /** Scanned codes that match no unit — they can carry no action. */
  unresolved: number;
  /** Units in the fleet that these models cover but that nobody scanned. */
  unitsNotOnList: number;
};

/**
 * What a bulk action would actually touch. Read-only.
 */
export async function getScanListBulkTarget(
  listId: string,
): Promise<BulkTarget | null> {
  const auth = await requireEditor();
  if (!auth.authorized) return null;

  const items = await prisma.scanListItem.findMany({
    where: { listId },
    select: { assetUnitId: true },
  });

  const unresolved = items.filter((item) => item.assetUnitId === null).length;

  // `ScanListItem.assetUnitId` carries no Prisma relation — the column is a
  // plain nullable string, because a scan list holds barcodes whether or not
  // they turn out to be units. So the units are fetched in one batch, the same
  // way `getScanList` does it.
  const unitIds = items
    .map((item) => item.assetUnitId)
    .filter((id): id is string => id !== null);

  const units = unitIds.length
    ? await prisma.assetUnit.findMany({
        where: { id: { in: unitIds } },
        select: {
          id: true,
          asset: {
            select: {
              id: true,
              name: true,
              dailyRate: true,
              weeklyRate: true,
              monthlyRate: true,
            },
          },
        },
      })
    : [];

  const byAsset = new Map<string, BulkTargetModel>();
  for (const unit of units) {
    const asset = unit.asset;
    const existing = byAsset.get(asset.id);
    if (existing) {
      existing.onList += 1;
      continue;
    }
    byAsset.set(asset.id, {
      assetId: asset.id,
      name: asset.name,
      onList: 1,
      inFleet: 0,
      dailyRate: asset.dailyRate === null ? null : Number(asset.dailyRate),
      weeklyRate: asset.weeklyRate === null ? null : Number(asset.weeklyRate),
      monthlyRate: asset.monthlyRate === null ? null : Number(asset.monthlyRate),
    });
  }

  const models = [...byAsset.values()];
  for (const model of models) {
    // Fleet count, not `totalQuantity`: the denormalized column counts retired
    // and sold units, and the point of this number is how many *earning* units
    // a rate change would reach.
    model.inFleet = await prisma.assetUnit.count({
      where: { assetId: model.assetId, status: { notIn: OUT_OF_FLEET } },
    });
  }

  models.sort((a, b) => b.onList - a.onList || a.name.localeCompare(b.name));

  return {
    models,
    unresolved,
    unitsNotOnList: models.reduce(
      (sum, model) => sum + Math.max(0, model.inFleet - model.onList),
      0,
    ),
  };
}

/**
 * Apply a change to every model represented on the list.
 *
 * Delegates to the ported `bulkUpdateAssets` — the guards, the field filtering
 * and the audit all live there. This adds the list-to-models resolution and the
 * outcome shape a screen can render.
 */
export async function bulkUpdateFromScanList(
  listId: string,
  data: BulkUpdateData,
): Promise<BulkOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const target = await getScanListBulkTarget(listId);
  if (!target || target.models.length === 0) {
    return {
      status: "error",
      message: "Nothing on this list resolves to a model to change.",
    };
  }

  const changes = Object.entries(data).filter(([, value]) => value !== undefined);
  if (changes.length === 0) {
    return { status: "error", message: "Nothing was chosen to change." };
  }

  try {
    await bulkUpdateAssets(
      target.models.map((model) => model.assetId),
      data,
    );
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "The change failed.",
    };
  }

  revalidatePath("/dashboard/pricing");
  revalidatePath("/dashboard/assets");
  revalidatePath(`/dashboard/audits/scan-lists/${listId}`);

  const units = target.models.reduce((sum, model) => sum + model.inFleet, 0);
  return {
    status: "ok",
    message: `Updated ${target.models.length} ${
      target.models.length === 1 ? "model" : "models"
    }, covering ${units} ${units === 1 ? "unit" : "units"} in the fleet.`,
  };
}
