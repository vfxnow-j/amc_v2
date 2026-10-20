/**
 * The create-an-entity sequence, free of next/auth so the action and the verification script
 * run the very same code. The registry is passed in, so a test can make its write fail.
 *
 * Order matters: refuse a taken slug, provision (which cleans up after its own failure and,
 * if the database already exists, throws without dropping anything), then write the registry
 * row. Only if that write fails AFTER provisioning succeeded is the database dropped again.
 */
import { dbNameFor } from "@/lib/entities/naming";
import type { EntityData } from "@/lib/entities/entity-input";
import { dropFailedEntityDatabase, provisionEntityDatabase } from "@/lib/entities/provision";

export type EntityRegistry = {
  /** Case-insensitive: is this slug already registered? */
  slugTaken: (slug: string) => Promise<boolean>;
  create: (row: EntityData & { dbName: string; schemaVersion: number }) => Promise<{ id: string }>;
};

export type CreateOutcome =
  | { status: "ok"; id: string; slug: string; dbName: string }
  | { status: "error"; message: string };

export async function createEntityRecord(
  registry: EntityRegistry,
  data: EntityData,
  provision: typeof provisionEntityDatabase = provisionEntityDatabase,
  drop: typeof dropFailedEntityDatabase = dropFailedEntityDatabase,
): Promise<CreateOutcome> {
  if (await registry.slugTaken(data.slug)) {
    return { status: "error", message: "An entity with that name already exists." };
  }
  const dbName = dbNameFor(data.slug);

  let schemaVersion: number;
  try {
    ({ version: schemaVersion } = await provision(dbName));
  } catch (error) {
    // Nothing of ours exists now: either the CREATE failed (e.g. the name is taken, and we
    // drop nothing) or provisioning already dropped its own half-made database.
    console.error("[entities] provisioning failed:", (error as Error).message);
    return { status: "error", message: "The entity's database could not be created, so nothing was saved." };
  }

  try {
    const row = await registry.create({ ...data, dbName, schemaVersion });
    return { status: "ok", id: row.id, slug: data.slug, dbName };
  } catch (error) {
    console.error("[entities] registry write failed:", (error as Error).message);
    // This call created the database a moment ago, so it is the one to remove.
    try {
      await drop(dbName);
    } catch (dropError) {
      console.error("[entities] could not drop the database:", (dropError as Error).message);
      return {
        status: "error",
        message: `The entity could not be saved, and its empty database ${dbName} could not be removed. Ask for it to be dropped by hand.`,
      };
    }
    return { status: "error", message: "The entity could not be saved, so its database was removed. Nothing was kept." };
  }
}
