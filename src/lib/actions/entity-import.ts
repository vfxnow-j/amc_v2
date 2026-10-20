"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EntityAccessError, requireEntity } from "@/lib/entities/context";
import { groupRows, parseItemCsv } from "@/lib/entities/csv";
import { buildPlans, describeImport } from "@/lib/entities/import-plan";
import { importItemsTx } from "@/lib/entities/ledger";
import { locationOptions } from "@/lib/entities/main-lookup";
import { check, itemSchema } from "@/lib/entities/schemas";

export type ImportOutcome =
  | { status: "ok"; message: string; created: number; lines: string[]; dryRun: boolean }
  | { status: "error"; message: string };

const inputSchema = z.strictObject({
  slug: z.string().min(1, "Missing entity.").max(64, "That entity is not valid."),
  csv: z.string("Choose a file or paste its contents.").max(1_000_000, "The file is too large (1 MB at most)."),
  dryRun: z.boolean("Preview or import?"),
});

const fail = (message: string): ImportOutcome => ({ status: "error", message });

/**
 * Import items, units and stock from a CSV. Everything goes through the ledger's
 * importItemsTx (the same per-unit and stock writes the other actions use), in one
 * transaction: a bad file leaves nothing. dryRun runs the same work and rolls it back.
 * Locations are looked up, never created.
 */
export async function importItems(slug: string, csv: string, dryRun: boolean): Promise<ImportOutcome> {
  const input = check(inputSchema, { slug, csv, dryRun });
  if (!input.ok) return fail(input.message);
  try {
    const c = await requireEntity(input.data.slug, { write: true });

    const parsed = parseItemCsv(input.data.csv);
    if (parsed.errors.length) return fail(parsed.errors.join("\n"));
    if (parsed.rows.length === 0) return fail("The file has no rows to import.");

    const grouped = groupRows(parsed.rows);
    if (grouped.errors.length) return fail(grouped.errors.join("\n"));
    for (const g of grouped.groups) {
      const p = check(itemSchema, { name: g.name, manufacturer: g.manufacturer, model: g.model, category: g.category, trackingMode: g.trackingMode });
      if (!p.ok) return fail(`${g.name}: ${p.message}`);
    }

    const built = buildPlans(grouped.groups, await locationOptions());
    if (built.errors.length) return fail(built.errors.join("\n"));

    const result = await importItemsTx(c.db, { actorUserId: c.userId, items: built.plans, dryRun: input.data.dryRun });
    if (!result.ok) return fail(result.reason);

    const lines = describeImport(result.items);
    const created = result.items.filter((i) => i.created).length;
    if (result.dryRun) {
      return { status: "ok", dryRun: true, created, lines, message: `Preview only; nothing was saved. ${created} new item${created === 1 ? "" : "s"} would be created.` };
    }
    revalidatePath(`/entity/${input.data.slug}`, "layout");
    return { status: "ok", dryRun: false, created, lines, message: `Imported ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}; ${created} new item${created === 1 ? "" : "s"} created.` };
  } catch (error) {
    if (error instanceof EntityAccessError) return fail(error.message);
    console.error(error);
    return fail("That didn't import. Nothing was saved.");
  }
}
