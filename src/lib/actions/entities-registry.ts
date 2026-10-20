"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth-utils";
import { checkEntityInput, cleanModules, type EntityFormInput } from "@/lib/entities/entity-input";
import { createEntityRecord } from "@/lib/entities/create";
import { entityAccessSchema, userIdSchema } from "@/lib/entities/access-input";
import { saveEntityAccess } from "@/lib/entities/save-access";

// slug and dbName are deliberately not editable anywhere here: the slug is the database name.
// Entities are deactivated, never deleted: there is no delete action.

type Outcome = { status: "ok"; message: string } | { status: "error"; message: string };

export async function createEntity(
  input: EntityFormInput,
): Promise<{ status: "ok"; id: string; slug: string } | { status: "error"; message: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const checked = checkEntityInput(input);
  if (!checked.ok) return { status: "error", message: checked.message };

  const result = await createEntityRecord(
    {
      slugTaken: async (slug) =>
        (await prisma.entity.findFirst({ where: { slug: { equals: slug, mode: "insensitive" } }, select: { id: true } })) !== null,
      create: ({ slug, name, dbName, modules, schemaVersion, contactName, email, phone, address, notes }) =>
        prisma.entity.create({
          data: { name, slug, dbName, modules, schemaVersion, contactName, email, phone, address, notes },
          select: { id: true },
        }),
    },
    checked.data,
  );
  if (result.status === "error") return result;
  revalidatePath("/dashboard/settings/entities");
  return { status: "ok", id: result.id, slug: result.slug };
}

export async function updateEntity(id: string, input: EntityFormInput): Promise<Outcome> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  if (typeof id !== "string" || !id || id.length > 64) return { status: "error", message: "That entity doesn't exist." };

  const checked = checkEntityInput(input);
  if (!checked.ok) return { status: "error", message: checked.message };
  const { name, contactName, email, phone, address, notes } = checked.data;

  try {
    const existing = await prisma.entity.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return { status: "error", message: "That entity doesn't exist." };
    await prisma.entity.update({
      where: { id },
      data: { name, modules: cleanModules(checked.data.modules), contactName, email, phone, address, notes },
    });
  } catch (error) {
    console.error("[entities] update failed:", (error as Error).message);
    return { status: "error", message: "Could not save." };
  }
  revalidatePath("/dashboard/settings/entities");
  return { status: "ok", message: "Saved." };
}

export async function setEntityActive(id: string, active: boolean): Promise<Outcome> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };
  if (typeof id !== "string" || !id || id.length > 64 || typeof active !== "boolean") {
    return { status: "error", message: "That isn't a valid request." };
  }
  try {
    const existing = await prisma.entity.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return { status: "error", message: "That entity doesn't exist." };
    await prisma.entity.update({ where: { id }, data: { active } });
  } catch (error) {
    console.error("[entities] activate failed:", (error as Error).message);
    return { status: "error", message: "Could not change the status." };
  }
  revalidatePath("/dashboard/settings/entities");
  return { status: "ok", message: active ? "Reactivated." : "Deactivated. Its data is kept." };
}

/** A super admin sets one user's entity access. Never throws to the client. */
export async function saveUserEntityAccess(userId: string, input: unknown): Promise<Outcome> {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const id = userIdSchema.safeParse(userId);
  const parsed = entityAccessSchema.safeParse(input);
  if (!id.success || !parsed.success) return { status: "error", message: "That isn't a valid request." };

  try {
    const result = await saveEntityAccess(prisma, id.data, parsed.data);
    if (result.status === "error") return result;
  } catch (error) {
    console.error("[entities] save access failed:", (error as Error).message);
    return { status: "error", message: "Could not save." };
  }
  revalidatePath(`/dashboard/settings/users/${id.data}`);
  return { status: "ok", message: "Entity access saved." };
}
