import { assertEntityDatabase } from "@/lib/db-guard";
import { entityUrl } from "@/lib/entities/url";
import { PrismaClient } from "@/generated/entity-prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

export type EntityDb = PrismaClient;

export { entityUrl };

const globalForEntities = globalThis as unknown as {
  entityClients: Map<string, PrismaClient> | undefined;
};
const clients = (globalForEntities.entityClients ??= new Map());

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
