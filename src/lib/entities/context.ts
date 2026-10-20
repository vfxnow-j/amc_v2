import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { entityDb, type EntityDb } from "@/lib/entities/client";
import { canWriteInEntity, entityIdsFor, type AccessUser, type EntityRole } from "@/lib/entities/access";

export class EntityAccessError extends Error {}

export type EntityContext = {
  entity: { id: string; name: string; slug: string; dbName: string; modules: string[] };
  db: EntityDb;
  userId: string;
  role: EntityRole;
  canWrite: boolean;
};

async function accessUser(userId: string): Promise<AccessUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, entityAccess: true, entityScope: true, disabledAt: true, entityGrants: { select: { entityId: true } } },
  });
  if (!user || user.disabledAt) return null;
  return {
    role: user.role,
    entityAccess: user.entityAccess,
    entityScope: user.entityScope === "ALL" ? "ALL" : "SELECTED",
    grantedEntityIds: user.entityGrants.map((g) => g.entityId),
  };
}

/**
 * The gate every entity page and action goes through. The slug comes from the
 * URL, so it is checked against the grants on every call: a bookmarked link to
 * an entity you have since lost is a refusal, not a page.
 */
export async function requireEntity(slug: string, opts: { write?: boolean } = {}): Promise<EntityContext> {
  const session = await auth();
  if (!session?.user?.id) throw new EntityAccessError("Unauthorized");

  const [user, active] = await Promise.all([
    accessUser(session.user.id),
    prisma.entity.findMany({ where: { active: true }, select: { id: true, name: true, slug: true, dbName: true, modules: true } }),
  ]);
  if (!user) throw new EntityAccessError("Unauthorized");

  const allowed = new Set(entityIdsFor(user, active.map((e) => e.id)));
  const entity = active.find((e) => e.slug === slug && allowed.has(e.id));
  if (!entity) throw new EntityAccessError("You don't have access to that entity.");

  const canWrite = canWriteInEntity(user.role);
  if (opts.write && !canWrite) throw new EntityAccessError("Your role can look at this entity but not change it.");

  return { entity, db: entityDb(entity.dbName), userId: session.user.id, role: user.role, canWrite };
}

/** The entities this user may switch into, for the menu. */
export async function listEntitiesFor(userId: string) {
  const [user, active] = await Promise.all([
    accessUser(userId),
    prisma.entity.findMany({ where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  if (!user) return [];
  const allowed = new Set(entityIdsFor(user, active.map((e) => e.id)));
  return active.filter((e) => allowed.has(e.id));
}
