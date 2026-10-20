import { ENTITY_DB_RE } from "@/lib/entities/naming";

/**
 * The main DATABASE_URL with its database swapped for an entity's. Kept apart from
 * client.ts so code that only needs a URL (provisioning, scripts) never loads the entity client.
 */
export function entityUrl(dbName: string): string {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}
