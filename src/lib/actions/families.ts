"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

/**
 * Writes behind asset families.
 *
 * Grouping is reversible on purpose and these actions keep it that way: a
 * family owns nothing, so creating, renaming, emptying or deleting one moves no
 * rate, no unit and no depreciation schedule. Deleting a family releases its
 * models rather than taking them with it — `onDelete: SetNull` on the relation,
 * and it matters, because the one thing that must never happen here is losing a
 * model by tidying up its container.
 */

export type FamilyOutcome =
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

function clean(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function refresh(): void {
  revalidatePath("/dashboard/assets");
  revalidatePath("/dashboard/assets/grouping");
}

/**
 * The four things a family owns: its name, who makes it, and two notes.
 *
 * Everything else on this screen is rolled up from the models, which is why
 * there is so little to edit here — and why editing it cannot affect a rate, a
 * unit or a depreciation schedule.
 */
export async function updateFamily(
  id: string,
  input: {
    name: string;
    manufacturer: string;
    description: string;
    notes: string;
  },
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const label = clean(input.name);
  if (!label) return { status: "error", message: "Give the asset a name." };

  const clash = await prisma.assetFamily.findFirst({
    where: { name: label, NOT: { id } },
    select: { id: true },
  });
  if (clash) {
    return { status: "error", message: `An asset called "${label}" already exists.` };
  }

  await prisma.assetFamily.update({
    where: { id },
    data: {
      name: label,
      // Empty means "not recorded", which is a different thing from an empty
      // string and reads differently everywhere it is shown.
      manufacturer: clean(input.manufacturer) || null,
      description: clean(input.description) || null,
      notes: input.notes.trim() || null,
    },
  });

  refresh();
  revalidatePath(`/dashboard/assets/family/${id}`);
  return { status: "ok", message: "Saved." };
}

/**
 * Delete a family. Its models are released, not deleted — the relation is
 * `SetNull`, and they go back to being ungrouped exactly as they were before
 * anybody grouped them.
 */
export async function deleteFamily(id: string): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const family = await prisma.assetFamily.findUnique({
    where: { id },
    select: { name: true, _count: { select: { assets: true } } },
  });
  if (!family) return { status: "error", message: "That asset no longer exists." };

  await prisma.assetFamily.delete({ where: { id } });
  refresh();
  const n = family._count.assets;
  return {
    status: "ok",
    message:
      n === 0
        ? `${family.name} deleted.`
        : `${family.name} deleted. Its ${n} ${n === 1 ? "model is" : "models are"} ungrouped — nothing was removed from inventory.`,
  };
}
