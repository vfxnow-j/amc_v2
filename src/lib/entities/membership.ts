import { prisma } from "@/lib/prisma";
import { entityIdsFor } from "@/lib/entities/access";
import { toAccessUser } from "@/lib/entities/gate";

/**
 * Who may enter which entity, from the MAIN database only. This file must never import the
 * entity client: the main shell calls listEntitiesFor, and `npm run check:entities` enforces it.
 */
export async function accessUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, entityAccess: true, entityScope: true, disabledAt: true, entityGrants: { select: { entityId: true } } },
  });
}

/** The entities this user may switch into, for the menu. */
export async function listEntitiesFor(userId: string) {
  const [record, active] = await Promise.all([
    accessUser(userId),
    prisma.entity.findMany({ where: { active: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const user = toAccessUser(record);
  if (!user) return [];
  const allowed = new Set(entityIdsFor(user, active.map((e) => e.id)));
  return active.filter((e) => allowed.has(e.id));
}
