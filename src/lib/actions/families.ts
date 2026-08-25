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
 * Create a family and move models into it, in one transaction.
 *
 * Only models that are currently ungrouped are moved. Somebody reviewing
 * suggestions on a stale page would otherwise silently pull a model out of a
 * family that was settled since the page loaded, and the count they were shown
 * would no longer be what they got.
 */
export async function createFamily(
  name: string,
  assetIds: string[],
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const label = clean(name);
  if (!label) return { status: "error", message: "Give the asset a name." };
  if (assetIds.length === 0) {
    return {
      status: "error",
      message: "Choose at least one model to put under it.",
    };
  }

  const clash = await prisma.assetFamily.findUnique({
    where: { name: label },
    select: { id: true },
  });
  if (clash) {
    return {
      status: "error",
      message: `An asset called "${label}" already exists. Add the models to that one instead, or pick another name.`,
    };
  }

  const moved = await prisma.$transaction(async (tx) => {
    const family = await tx.assetFamily.create({ data: { name: label } });
    const result = await tx.asset.updateMany({
      where: { id: { in: assetIds }, familyId: null },
      data: { familyId: family.id },
    });
    return result.count;
  });

  refresh();
  const skipped = assetIds.length - moved;
  return {
    status: "ok",
    message:
      skipped === 0
        ? `${label} created with ${moved} ${moved === 1 ? "model" : "models"}.`
        : `${label} created with ${moved} of ${assetIds.length} models — ${skipped} had already been grouped elsewhere.`,
  };
}

/**
 * Apply a reviewed batch of groupings in one go.
 *
 * The review screen offers 27 at once and accepting them one request at a time
 * would be 27 round trips and 27 chances to end up half-applied. Each group is
 * still created in its own transaction rather than one for the batch: a name
 * that clashes should cost you that group, not the twenty-six you already
 * agreed with.
 */
export async function applyGroupings(
  groups: { name: string; assetIds: string[] }[],
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }
  if (groups.length === 0) {
    return { status: "error", message: "Nothing selected." };
  }

  let created = 0;
  let models = 0;
  const failed: string[] = [];

  for (const group of groups) {
    const result = await createFamily(group.name, group.assetIds);
    if (result.status === "ok") {
      created += 1;
      models += group.assetIds.length;
    } else {
      failed.push(clean(group.name));
    }
  }

  refresh();
  const made = `${created} ${created === 1 ? "asset" : "assets"} created from ${models} ${models === 1 ? "model" : "models"}`;
  return failed.length === 0
    ? { status: "ok", message: `${made}.` }
    : {
        status: "ok",
        message: `${made}. ${failed.length} could not be: ${failed.join(", ")} — most likely the name is already taken.`,
      };
}

/** Move models into a family that already exists. */
export async function assignToFamily(
  familyId: string,
  assetIds: string[],
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const family = await prisma.assetFamily.findUnique({
    where: { id: familyId },
    select: { name: true },
  });
  if (!family) return { status: "error", message: "That asset no longer exists." };

  const { count } = await prisma.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { familyId },
  });

  refresh();
  revalidatePath(`/dashboard/assets/family/${familyId}`);
  return {
    status: "ok",
    message: `${count} ${count === 1 ? "model" : "models"} moved under ${family.name}.`,
  };
}

/** Take models out of whatever family they are in. */
export async function ungroupAssets(
  assetIds: string[],
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const { count } = await prisma.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { familyId: null },
  });

  refresh();
  return {
    status: "ok",
    message: `${count} ${count === 1 ? "model is" : "models are"} no longer grouped. Nothing else changed.`,
  };
}

export async function renameFamily(
  id: string,
  name: string,
): Promise<FamilyOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) {
    return { status: "error", message: auth.error ?? "Not allowed." };
  }

  const label = clean(name);
  if (!label) return { status: "error", message: "Give the asset a name." };

  const clash = await prisma.assetFamily.findFirst({
    where: { name: label, NOT: { id } },
    select: { id: true },
  });
  if (clash) {
    return { status: "error", message: `An asset called "${label}" already exists.` };
  }

  await prisma.assetFamily.update({ where: { id }, data: { name: label } });
  refresh();
  revalidatePath(`/dashboard/assets/family/${id}`);
  return { status: "ok", message: `Renamed to ${label}.` };
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
