import { assertEntityDatabase } from "@/lib/db-guard";
import { ENTITY_DB_RE } from "@/lib/entities/naming";
import { PrismaClient } from "@/generated/entity-prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

export type EntityDb = PrismaClient;

const globalForEntities = globalThis as unknown as {
  entityClients: Map<string, PrismaClient> | undefined;
};
const clients = (globalForEntities.entityClients ??= new Map());

/** The main DATABASE_URL with its database swapped for an entity's. */
export function entityUrl(dbName: string): string {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** One pooled client per entity, kept on globalThis so hot reloads reuse it. */
export function entityDb(dbName: string): EntityDb {
  const existing = clients.get(dbName);
  if (existing) return existing;
  const connectionString = assertEntityDatabase(entityUrl(dbName));
  const pool = new Pool({ connectionString, max: 4 });
  // An error on an idle pooled connection must not crash the process.
  pool.on("error", (error) => console.error(`entity pool ${dbName}:`, error.message));
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  clients.set(dbName, client);
  return client;
}
