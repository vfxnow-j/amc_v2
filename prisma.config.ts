import "dotenv/config";
import { defineConfig } from "prisma/config";
import { assertV2Database } from "./src/lib/db-guard";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Guarded rather than passed straight through: every Prisma CLI command
    // loads this file, so a DATABASE_URL pointing anywhere but v2 stops here —
    // including `db push --accept-data-loss`, which would otherwise happily
    // rewrite live v1's schema. See src/lib/db-guard.ts.
    url: assertV2Database(process.env["DATABASE_URL"]),
  },
});
