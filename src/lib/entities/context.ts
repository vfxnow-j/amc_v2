import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { entityDb, type EntityDb } from "@/lib/entities/client";
import { entityIdsFor, type EntityRole } from "@/lib/entities/access";
import { decideEntity, toAccessUser } from "@/lib/entities/gate";

export class EntityAccessError extends Error {}

export type EntityContext = {
  entity: { id: string; name: string; slug: string; dbName: string; modules: string[] };
  db: EntityDb;
  userId: string;
  role: EntityRole;
  canWrite: boolean;
};

async function userRecord(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, entityAccess: true, entityScope: true, disabledAt: true, entityGrants: { select: { entityId: true } } },
  });
}

/**
 * The gate every entity page and action goes through. The slug comes from the
 * URL, so it is checked against the grants on every call: a bookmarked link to
 * an entity you have since lost is a refusal, not a page.
 */
export async function requireEntity(slug: string, opts: { write?: boolean } = {}): Promise<EntityContext> {
  const session = await auth();
  if (!session?.user?.id) throw new EntityAccessError("Unauthorized");

  const [record, active] = await Promise.all([
    userRecord(session.user.id),
    prisma.entity.findMany({ where: { active: true }, select: { id: true, name: true, slug: true, dbName: true, modules: true } }),
  ]);
  const decision = decideEntity(record, active, slug, opts);
  if (!decision.ok) throw new EntityAccessError(decision.reason);
  return { entity: decision.entity, db: entityDb(decision.entity.dbName), userId: session.user.id, role: decision.role, canWrite: decision.canWrite };
}

/** The entities this user may switch into, for the menu. */
export async function listEntitiesFor(userId: string) {
  const [record, active] = await Promise.all([
    userRecord(userId),
    prisma.entity.findMany({ where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const user = toAccessUser(record);
  if (!user) return [];
  const allowed = new Set(entityIdsFor(user, active.map((e) => e.id)));
  return active.filter((e) => allowed.has(e.id));
}
