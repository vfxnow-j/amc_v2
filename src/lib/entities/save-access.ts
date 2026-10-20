/**
 * The write behind "save a user's entity access", free of next/auth so the action and the
 * verification script run the same code. One transaction: the user's flags and the grants
 * replace together, so a failure never leaves flags and grants disagreeing.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { EntityAccessInput } from "@/lib/entities/access-input";

export type SaveAccessResult =
  | { status: "ok"; granted: number }
  | { status: "error"; message: string };

export async function saveEntityAccess(
  db: PrismaClient,
  userId: string,
  input: EntityAccessInput,
): Promise<SaveAccessResult> {
  return db.$transaction(async (tx): Promise<SaveAccessResult> => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return { status: "error", message: "User not found." };
    if (user.role === "FLOW_USER" && input.entityAccess) {
      return { status: "error", message: "Flow users can't be given entity access." };
    }
    // Only ids that exist in the registry; stale ids from an old page are dropped.
    const valid = input.entityAccess
      ? await tx.entity.findMany({ where: { id: { in: input.entityIds } }, select: { id: true } })
      : [];
    await tx.user.update({
      where: { id: userId },
      data: input.entityAccess
        ? { entityAccess: true, entityScope: input.scope }
        : { entityAccess: false, entityScope: "SELECTED" },
    });
    await tx.userEntity.deleteMany({ where: { userId } });
    if (valid.length > 0) {
      await tx.userEntity.createMany({ data: valid.map((e) => ({ userId, entityId: e.id })) });
    }
    return { status: "ok", granted: valid.length };
  });
}
