import { canWriteInEntity, entityIdsFor, type AccessUser } from "@/lib/entities/access";

/** The user columns the gate reads, exactly as the database returns them. */
export type UserRecord = {
  role: AccessUser["role"];
  entityAccess: boolean;
  entityScope: string;
  disabledAt: Date | null;
  entityGrants: { entityId: string }[];
};

export function toAccessUser(r: UserRecord | null): AccessUser | null {
  if (!r || r.disabledAt) return null;
  return {
    role: r.role,
    entityAccess: r.entityAccess,
    entityScope: r.entityScope === "ALL" ? "ALL" : "SELECTED",
    grantedEntityIds: r.entityGrants.map((g) => g.entityId),
  };
}

export type GateDecision<E> = { ok: true; entity: E; role: AccessUser["role"]; canWrite: boolean } | { ok: false; reason: string };

/** Pure core of requireEntity: may this user (fresh from the database) open or change this active entity? */
export function decideEntity<E extends { id: string; slug: string }>(
  record: UserRecord | null,
  active: E[],
  slug: string,
  opts: { write?: boolean } = {},
): GateDecision<E> {
  const user = toAccessUser(record);
  if (!user) return { ok: false, reason: "Unauthorized" };
  const allowed = new Set(entityIdsFor(user, active.map((e) => e.id)));
  const entity = active.find((e) => e.slug === slug && allowed.has(e.id));
  if (!entity) return { ok: false, reason: "You don't have access to that entity." };
  const canWrite = canWriteInEntity(user.role);
  if (opts.write && !canWrite) return { ok: false, reason: "Your role can look at this entity but not change it." };
  return { ok: true, entity, role: user.role, canWrite };
}
