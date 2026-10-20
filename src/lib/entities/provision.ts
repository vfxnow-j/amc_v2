import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { ENTITY_DB_RE } from "@/lib/entities/naming";
import { entityUrl } from "@/lib/entities/client";
import { assertEntityDatabase } from "@/lib/db-guard";

// Read relative to process.cwd(): correct for scripts and for Next, which both run from the repo root.
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "entity", "migrations");

type Migration = { version: number; file: string; sql: string };

function migrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({
      version: Number(file.slice(0, 4)),
      file,
      sql: readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
    }));
}

export const LATEST_VERSION = Math.max(...migrations().map((m) => m.version));

/** A connection to the server's maintenance database, only to CREATE/DROP. */
function adminPool() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/postgres";
  return new Pool({ connectionString: url.toString(), max: 1 });
}

export async function provisionEntityDatabase(dbName: string) {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const admin = adminPool();
  try {
    // Identifiers cannot be parameterised; the regex above is what makes this safe.
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const { to } = await migrateEntityDatabase(dbName);
  return { version: to };
}

/** Applies every migration newer than the database's `_entity_migrations` table. */
export async function migrateEntityDatabase(dbName: string) {
  const pool = new Pool({ connectionString: assertEntityDatabase(entityUrl(dbName)), max: 1 });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _entity_migrations (version INTEGER PRIMARY KEY, file TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const done = await pool.query<{ version: number }>(`SELECT version FROM _entity_migrations`);
    const have = new Set(done.rows.map((r) => r.version));
    const from = Math.max(0, ...have);
    let to = from;
    for (const m of migrations().filter((x) => !have.has(x.version))) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query(`INSERT INTO _entity_migrations (version, file) VALUES ($1, $2)`, [m.version, m.file]);
        await client.query("COMMIT");
        to = m.version;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return { from, to };
  } finally {
    await pool.end();
  }
}

/** Rollback for a creation that failed part-way. Only ever called on a database this attempt created. */
export async function dropFailedEntityDatabase(dbName: string) {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const admin = adminPool();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
