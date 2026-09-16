import { assertV2Database } from "@/lib/db-guard";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Throws unless this is v2's own database. v1 is live and shares the same
  // container and superuser; see src/lib/db-guard.ts.
  const connectionString = assertV2Database(process.env.DATABASE_URL);

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Kept on globalThis in development so hot reloads reuse one pool.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
