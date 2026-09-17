"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-utils";
import { logAudit } from "@/lib/actions/audit";
import { createLocation } from "@/lib/actions/entities";
import { IN_FLEET } from "@/lib/inventory/availability";

/**
 * Adding and removing locations, from Inventory → Locations & transfers.
 *
 * `entities.ts` has had `createLocation` and `deleteLocation` since the port,
 * wired to a settings screen v2 never built. Adding goes through
 * `createLocation` as it is — editor access, the case-insensitive duplicate
 * check, the audit row — wrapped in the house `{status, message}` shape because
 * it throws. Removing cannot reuse `deleteLocation`: that one refuses outright
 * while any unit is filed at the location, and the whole point here is to move
 * those units somewhere first.
 *
 * **A removal moves everything, then deletes** (owner, 2026-09-17). Nothing
 * refuses: every record that points at the location is re-pointed at the one
 * chosen, in one transaction —
 *
 * - units filed there, retired and sold ones included;
 * - purchase orders shipping to it;
 * - locations filed within it;
 * - transfers to or from it — rewritten in place, with a note naming the
 *   removed location so the history still says where the unit really went;
 * - inventory audits scoped to it, and audit lines that expected a unit there —
 *   each audit touched gets a note saying the location was folded in.
 *
 * The location's DELETE row in the audit log names the destination and every
 * count moved.
 *
 * v1 note: a location that came from v1 is re-created by the next refresh while
 * v1 still has it, and v1's units point back at it. Remove it in v1 too, or
 * expect it back until cut-over.
 */

export type LocationOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export type NewLocationInput = {
  name: string;
  address: string;
  description: string;
  /** A percentage as typed — 8.25, not 0.0825. Null when left blank. */
  taxRatePercent: number | null;
  taxLabel: string;
};

export async function addLocation(input: NewLocationInput): Promise<LocationOutcome> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "A location needs a name." };

  const percent = input.taxRatePercent;
  // `taxRate` is Decimal(5,4): a fraction below 10, and nothing negative is a tax.
  if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent >= 100)) {
    return { status: "error", message: "Enter a tax rate from 0 to under 100%." };
  }

  try {
    // `createLocation` does its own editor check and throws its message.
    await createLocation({
      name,
      address: input.address.trim() || undefined,
      description: input.description.trim() || undefined,
      taxRate: percent === null ? undefined : Math.round(percent * 100) / 10000,
      taxLabel: input.taxLabel.trim() || undefined,
    });
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not add it.",
    };
  }

  revalidatePath("/dashboard/locations");
  return { status: "ok", message: `${name} added.` };
}

type Db = Pick<typeof prisma, "location" | "inventoryAudit" | "auditItem" | "assetUnit">;

/** Everything that points at this location and moves with a removal, as sentences. */
async function removalReferences(db: Db, id: string): Promise<string[]> {
  const [counts, audits, auditLines] = await Promise.all([
    db.location.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            transfersFrom: true,
            transfersTo: true,
            purchaseOrders: true,
            childLocations: true,
          },
        },
      },
    }),
    db.inventoryAudit.count({ where: { locationId: id } }),
    db.auditItem.count({ where: { expectedLocationId: id } }),
  ]);
  if (!counts) return [];

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const references: string[] = [];
  const transfers = counts._count.transfersFrom + counts._count.transfersTo;
  if (counts._count.purchaseOrders > 0) {
    references.push(plural(counts._count.purchaseOrders, "purchase order ship-to", "purchase order ship-tos"));
  }
  if (transfers > 0) references.push(`${plural(transfers, "transfer", "transfers")}, noted`);
  if (audits > 0) references.push(`${plural(audits, "inventory audit", "inventory audits")} scoped to it, noted`);
  if (auditLines > 0) references.push(`${plural(auditLines, "audit line", "audit lines")} expecting a unit there`);
  if (counts._count.childLocations > 0) {
    references.push(plural(counts._count.childLocations, "location filed within it", "locations filed within it"));
  }
  return references;
}

export type LocationRemovalPlan = {
  id: string;
  name: string;
  units: { total: number; inFleet: number };
  /** The assets those units are, most first. Capped; `moreModels` counts the rest. */
  models: { name: string; count: number }[];
  moreModels: number;
  /** Other records that move with it — purchase orders, transfers, audits. */
  references: string[];
  destinations: { id: string; name: string }[];
};

const MODELS_LISTED = 8;

/**
 * Everything the remove dialog needs to ask its question, read when it opens
 * rather than shipped with every row of the list.
 */
export async function getLocationRemovalPlan(
  id: string,
): Promise<{ status: "ok"; plan: LocationRemovalPlan } | { status: "error"; message: string }> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const location = await prisma.location.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!location) return { status: "error", message: "That location no longer exists." };

  const [byStatus, byAsset, references, others] = await Promise.all([
    prisma.assetUnit.groupBy({
      by: ["status"],
      where: { locationId: id },
      _count: true,
    }),
    prisma.assetUnit.groupBy({
      by: ["assetId"],
      where: { locationId: id },
      _count: true,
    }),
    removalReferences(prisma, id),
    prisma.location.findMany({
      where: { id: { not: id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const total = byStatus.reduce((sum, group) => sum + group._count, 0);
  const inFleet = byStatus
    .filter((group) => IN_FLEET.includes(group.status))
    .reduce((sum, group) => sum + group._count, 0);

  const top = [...byAsset].sort((a, b) => b._count - a._count).slice(0, MODELS_LISTED);
  const names = await prisma.asset.findMany({
    where: { id: { in: top.map((group) => group.assetId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((asset) => [asset.id, asset.name]));

  return {
    status: "ok",
    plan: {
      id: location.id,
      name: location.name,
      units: { total, inFleet },
      models: top.map((group) => ({
        name: nameOf.get(group.assetId) ?? "Unknown model",
        count: group._count,
      })),
      moreModels: Math.max(0, byAsset.length - MODELS_LISTED),
      references,
      destinations: others,
    },
  };
}

class Refusal extends Error {}

/**
 * Remove a location, first moving every record that points at it to
 * `destinationId`. Admin only, as `deleteLocation` is.
 *
 * One transaction: a failure leaves everything where it was. The audit log row
 * is written after the commit, the way `setAssetRatesBulk` does it, because
 * `logAudit` writes through the global client.
 */
export async function removeLocation(
  id: string,
  destinationId: string | null,
): Promise<LocationOutcome> {
  const auth = await requireAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  let result: {
    location: {
      name: string;
      address: string | null;
      description: string | null;
      taxRate: unknown;
      taxLabel: string | null;
    };
    unitIds: string[];
    destination: { id: string; name: string } | null;
    moved: Record<string, number>;
  };

  try {
    result = await prisma.$transaction(
      async (tx) => {
        const location = await tx.location.findUnique({ where: { id } });
        if (!location) throw new Refusal("That location no longer exists.");

        const units = await tx.assetUnit.findMany({
          where: { locationId: id },
          select: { id: true },
        });
        const references = await removalReferences(tx, id);
        if (units.length === 0 && references.length === 0) {
          await tx.location.delete({ where: { id } });
          return { location, unitIds: [], destination: null, moved: {} };
        }

        if (!destinationId || destinationId === id) {
          throw new Refusal("Choose where its records should go.");
        }
        const destination = await tx.location.findUnique({
          where: { id: destinationId },
          select: { id: true, name: true, parentLocationId: true },
        });
        if (!destination) throw new Refusal("The location you chose no longer exists.");
        if (destination.parentLocationId === id) {
          // Its child becomes top level rather than its own parent.
          await tx.location.update({ where: { id: destination.id }, data: { parentLocationId: null } });
        }

        const today = new Date().toISOString().slice(0, 10);
        const note = `${location.name} removed ${today}; folded into ${destination.name}.`;

        const moved: Record<string, number> = {};
        moved.units = (
          await tx.assetUnit.updateMany({ where: { locationId: id }, data: { locationId: destination.id } })
        ).count;
        moved.purchaseOrders = (
          await tx.purchaseOrder.updateMany({ where: { shipToLocationId: id }, data: { shipToLocationId: destination.id } })
        ).count;
        moved.childLocations = (
          await tx.location.updateMany({ where: { parentLocationId: id }, data: { parentLocationId: destination.id } })
        ).count;

        // Transfers keep a note of the location they really named.
        await tx.$executeRawUnsafe(
          `update asset_transfers set notes = case when coalesce(notes, '') = '' then $1 else notes || E'\n' || $1 end
            where "fromLocationId" = $2 or "toLocationId" = $2`,
          note,
          id,
        );
        moved.transfers =
          (await tx.assetTransfer.updateMany({ where: { fromLocationId: id }, data: { fromLocationId: destination.id } })).count +
          (await tx.assetTransfer.updateMany({ where: { toLocationId: id }, data: { toLocationId: destination.id } })).count;

        // Audits scoped to it, or holding lines that expected a unit there, get the note.
        const lineAudits = await tx.auditItem.findMany({
          where: { expectedLocationId: id },
          select: { auditId: true },
          distinct: ["auditId"],
        });
        const auditIds = [
          ...new Set([
            ...lineAudits.map((line) => line.auditId),
            ...(await tx.inventoryAudit.findMany({ where: { locationId: id }, select: { id: true } })).map((a) => a.id),
          ]),
        ];
        if (auditIds.length) {
          await tx.$executeRawUnsafe(
            `update inventory_audits set notes = case when coalesce(notes, '') = '' then $1 else notes || E'\n' || $1 end
              where id = any($2::text[])`,
            note,
            auditIds,
          );
        }
        moved.audits = (
          await tx.inventoryAudit.updateMany({ where: { locationId: id }, data: { locationId: destination.id } })
        ).count;
        moved.auditLines = (
          await tx.auditItem.updateMany({ where: { expectedLocationId: id }, data: { expectedLocationId: destination.id } })
        ).count;

        await tx.location.delete({ where: { id } });

        return {
          location,
          unitIds: units.map((unit) => unit.id),
          destination: { id: destination.id, name: destination.name },
          moved,
        };
      },
      { timeout: 60_000 },
    );
  } catch (cause) {
    if (cause instanceof Refusal) return { status: "error", message: cause.message };
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not remove it.",
    };
  }

  const { location, unitIds, destination, moved } = result;

  await logAudit({
    action: "DELETE",
    entityType: "Location",
    entityId: id,
    userId: auth.userId,
    oldValues: {
      name: location.name,
      address: location.address,
      description: location.description,
      taxRate: location.taxRate === null ? null : String(location.taxRate),
      taxLabel: location.taxLabel,
    },
    newValues: destination ? { movedTo: destination, moved, unitIds } : undefined,
  });

  revalidatePath("/dashboard/locations");
  if (destination) revalidatePath(`/dashboard/locations/${destination.id}`);

  const others = (moved.purchaseOrders ?? 0) + (moved.transfers ?? 0) + (moved.audits ?? 0) + (moved.auditLines ?? 0) + (moved.childLocations ?? 0);
  return {
    status: "ok",
    message: destination
      ? `${location.name} removed. ${unitIds.length} ${unitIds.length === 1 ? "unit" : "units"}${
          others ? ` and ${others} other ${others === 1 ? "record" : "records"}` : ""
        } moved to ${destination.name}.`
      : `${location.name} removed.`,
  };
}
