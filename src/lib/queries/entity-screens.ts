import type { EntityDb } from "@/lib/entities/client";
import type { LogType } from "@/lib/entities/screens";

/* Reads for the receive, release, log and locations screens. Called only by pages that hold an EntityContext. */

export const LOG_LIMIT = 200;

export async function getLog(db: EntityDb, opts: { itemId?: string | null; type?: LogType | null }) {
  return db.movement.findMany({
    where: { itemId: opts.itemId ?? undefined, type: opts.type ?? undefined },
    include: { item: { select: { name: true } }, unit: { select: { serial: true, ownerTag: true } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: LOG_LIMIT,
  });
}

/** Releases that could explain where deployed gear is: those of the given units, and of the given items' stock. */
export async function getReleasesFor(db: EntityDb, unitIds: string[], stockItemIds: string[]) {
  if (unitIds.length === 0 && stockItemIds.length === 0) return [];
  return db.movement.findMany({
    where: {
      type: "RELEASE", correctsId: null, finalToOwner: false,
      OR: [...(unitIds.length ? [{ unitId: { in: unitIds } }] : []), ...(stockItemIds.length ? [{ unitId: null, itemId: { in: stockItemIds } }] : [])],
    },
    select: { type: true, correctsId: true, finalToOwner: true, unitId: true, itemId: true, toLocationId: true, actorUserId: true, occurredAt: true, recipient: true },
    orderBy: { occurredAt: "desc" },
  });
}
