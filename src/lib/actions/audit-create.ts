"use server";

import { prisma } from "@/lib/prisma";
import { requireEditor } from "@/lib/auth-utils";
import {
  createInventoryAudit,
  deleteInventoryAudit,
  startInventoryAudit,
} from "@/lib/actions/inventory-audits";
import { createScanList } from "@/lib/actions/scan-lists";

/**
 * Starting an audit or a scan list, from Inventory → Audits & scan lists.
 *
 * Both writes were ported and reachable from nothing on this screen:
 * `createInventoryAudit` had no caller at all, and `createScanList` only the
 * scan desk's list mode. These wrap them in the house `{status, message}` shape
 * — the ported actions throw — and add nothing to what they write.
 *
 * **An audit is created and started in one go.** A draft audit has no items,
 * and the record page cannot start one (see its `NotCounting` card), so a draft
 * made here would be a dead end. `startInventoryAudit` is what snapshots the
 * units in scope into `AuditItem` rows and moves the audit to counting, which
 * is the state the record's scan panel runs in. If starting refuses — nothing
 * in that scope — the draft `createInventoryAudit` just made is deleted again
 * with `deleteInventoryAudit`, so a failed attempt leaves no empty audit behind.
 * They are three ported actions rather than one transaction because each does
 * its own auth, audit-log row and revalidation, and re-implementing them inside
 * a transaction would fork the rules the scan desk already relies on.
 *
 * Only the three scopes that need no picker are offered. PARTIAL needs a set of
 * assets chosen and CLIENT_ORDER a set of orders, and `startInventoryAudit`
 * refuses both without them; neither picker exists yet.
 */

export type CreateOutcome =
  | { status: "ok"; id: string; message: string }
  | { status: "error"; message: string };

export type AuditScope = "FULL" | "CATEGORY" | "LOCATION";

export type AuditScopeInput = {
  scope: AuditScope;
  categoryId?: string;
  locationId?: string;
};

function scopeProblem(input: AuditScopeInput): string | null {
  if (!["FULL", "CATEGORY", "LOCATION"].includes(input.scope)) {
    return "Choose what the audit covers.";
  }
  if (input.scope === "CATEGORY" && !input.categoryId) return "Choose a category.";
  if (input.scope === "LOCATION" && !input.locationId) return "Choose a location.";
  return null;
}

/**
 * The categories and locations the dialog offers, and how many units each
 * scope would snapshot. The counts use the same filter `startInventoryAudit`
 * builds — every unit not RETIRED, narrowed by category or location — so the
 * number the dialog states is the number of lines the start writes.
 */
export async function getAuditScopeOptions() {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error" as const, message: auth.error };

  const counted = { status: { not: "RETIRED" as const } };

  const [full, categories, byCategory, locations, byLocation] = await Promise.all([
    prisma.assetUnit.count({ where: counted }),
    prisma.assetCategory.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      select: {
        categoryId: true,
        _count: { select: { units: { where: counted } } },
      },
    }),
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.assetUnit.groupBy({
      by: ["locationId"],
      where: { ...counted, locationId: { not: null } },
      _count: true,
    }),
  ]);

  const categoryUnits = new Map<string, number>();
  for (const asset of byCategory) {
    if (!asset.categoryId) continue;
    categoryUnits.set(
      asset.categoryId,
      (categoryUnits.get(asset.categoryId) ?? 0) + asset._count.units,
    );
  }
  const locationUnits = new Map(
    byLocation.map((group) => [group.locationId as string, group._count]),
  );

  return {
    status: "ok" as const,
    full,
    categories: categories.map((category) => ({
      ...category,
      units: categoryUnits.get(category.id) ?? 0,
    })),
    locations: locations.map((location) => ({
      ...location,
      units: locationUnits.get(location.id) ?? 0,
    })),
  };
}

export async function createAndStartAudit(
  input: AuditScopeInput & { name: string; notes: string },
): Promise<CreateOutcome> {
  const auth = await requireEditor();
  if (!auth.authorized) return { status: "error", message: auth.error };

  const name = input.name.trim();
  if (!name) return { status: "error", message: "An audit needs a name." };
  const problem = scopeProblem(input);
  if (problem) return { status: "error", message: problem };

  let id: string;
  try {
    const audit = (await createInventoryAudit({
      name,
      scope: input.scope,
      categoryId: input.scope === "CATEGORY" ? input.categoryId : undefined,
      locationId: input.scope === "LOCATION" ? input.locationId : undefined,
      notes: input.notes.trim() || undefined,
    })) as { id: string };
    id = audit.id;
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not create the audit.",
    };
  }

  try {
    const started = await startInventoryAudit(id);
    return {
      status: "ok",
      id,
      message: `${name} started with ${started.totalItems} ${started.totalItems === 1 ? "unit" : "units"} to count.`,
    };
  } catch (cause) {
    // Still a draft, so the ported delete accepts it.
    await deleteInventoryAudit(id).catch(() => {});
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not start the audit.",
    };
  }
}

export async function newScanList(input: {
  name: string;
  description: string;
}): Promise<CreateOutcome> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "A scan list needs a name." };

  try {
    // `createScanList` does its own editor check and throws its message.
    const list = (await createScanList({
      name,
      description: input.description.trim() || undefined,
    })) as { id: string };
    return { status: "ok", id: list.id, message: `${name} created.` };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not create the list.",
    };
  }
}
