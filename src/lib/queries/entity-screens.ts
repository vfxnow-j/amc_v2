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

const CHUNK = 500;
const chunks = <T,>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, n) => xs.slice(n * CHUNK, (n + 1) * CHUNK));
const RELEASE_FIELDS = { type: true, correctsId: true, finalToOwner: true, unitId: true, itemId: true, toLocationId: true, actorUserId: true, occurredAt: true, recipient: true } as const;

/**
 * The newest real release of each given unit, and of each (item, destination)
 * of the given items' stock: what `latestReleases` needs and nothing older.
 * `distinct` after a newest-first order keeps one row per key, and long id
 * lists go in chunks so no single query carries thousands of parameters.
 */
export async function getReleasesFor(db: EntityDb, unitIds: string[], stockItemIds: string[]) {
  const real = { type: "RELEASE" as const, correctsId: null, finalToOwner: false };
  const unitQueries = chunks(unitIds).map((ids) =>
    db.movement.findMany({ where: { ...real, unitId: { in: ids } }, select: RELEASE_FIELDS, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], distinct: ["unitId"] }),
  );
  const stockQueries = chunks(stockItemIds).map((ids) =>
    db.movement.findMany({ where: { ...real, unitId: null, itemId: { in: ids } }, select: RELEASE_FIELDS, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], distinct: ["itemId", "toLocationId"] }),
  );
  return (await Promise.all([...unitQueries, ...stockQueries])).flat();
}
