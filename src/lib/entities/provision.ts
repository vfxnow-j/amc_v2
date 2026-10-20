import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { ENTITY_DB_RE } from "@/lib/entities/naming";
import { entityUrl } from "@/lib/entities/url";
import { assertEntityDatabase } from "@/lib/db-guard";

// Read relative to process.cwd(): correct for scripts and for Next, which both run from the repo root.
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "entity", "migrations");

type MigrationFile = { version: number; file: string };

/**
 * Lists the numbered migration files in a folder, in version order, without reading their contents.
 * Two files sharing a 4-digit prefix, or a missing/empty folder, are errors.
 */
export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`Entity migrations folder not found: ${dir}`);
  }
  const list = names
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: Number(file.slice(0, 4)), file }));
  if (list.length === 0) throw new Error(`Entity migrations folder holds no migrations: ${dir}`);
  for (let i = 1; i < list.length; i++) {
    if (list[i].version === list[i - 1].version) {
      throw new Error(`Duplicate migration version ${list[i].version}: ${list[i - 1].file} and ${list[i].file}`);
    }
  }
  return list;
}

let latest: number | undefined;
/** The newest migration version on disk. Read on first use, then memoised; throws if there are none. */
export function latestVersion(): number {
  return (latest ??= Math.max(...listMigrations().map((m) => m.version)));
}

function poolFor(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  // An error on an idle connection must not crash the process.
  pool.on("error", (error) => console.error("[entities] pool error:", error.message));
  return pool;
}

/** A connection to the server's maintenance database, only to CREATE/DROP. */
function adminPool() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = "/postgres";
  return poolFor(url.toString());
}

/**
 * Creates an entity database and migrates it. If the migration step fails, the database this call
 * created is dropped again. A CREATE that fails (e.g. the database already exists) throws without
 * dropping anything.
 */
export async function provisionEntityDatabase(dbName: string) {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const admin = adminPool();
  try {
    // Identifiers cannot be parameterised; the regex above is what makes this safe.
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  // From here on, this call owns the database.
  try {
    const { to } = await migrateEntityDatabase(dbName);
    return { version: to };
  } catch (error) {
    await dropFailedEntityDatabase(dbName).catch((dropError) =>
      console.error("[entities] could not drop the failed database:", (dropError as Error).message),
    );
    throw error;
  }
}

/**
 * Applies every migration missing from the database's `_entity_migrations` table, in version order.
 * An older version that is not yet applied is applied (not skipped), even if a newer one is recorded.
 * A session-level advisory lock on the database name serialises concurrent runs.
 */
export async function migrateEntityDatabase(dbName: string) {
  const pool = poolFor(assertEntityDatabase(entityUrl(dbName)));
  try {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [dbName]);
      try {
        await client.query(
          `CREATE TABLE IF NOT EXISTS _entity_migrations (version INTEGER PRIMARY KEY, file TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        );
        const done = await client.query<{ version: number }>(`SELECT version FROM _entity_migrations`);
        const have = new Set(done.rows.map((r) => r.version));
        const from = Math.max(0, ...have);
        let to = from;
        for (const m of listMigrations().filter((x) => !have.has(x.version))) {
          const sql = readFileSync(path.join(MIGRATIONS_DIR, m.file), "utf8");
          try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(`INSERT INTO _entity_migrations (version, file) VALUES ($1, $2)`, [m.version, m.file]);
            await client.query("COMMIT");
            to = Math.max(to, m.version);
          } catch (error) {
            try {
              await client.query("ROLLBACK");
            } catch {
              broken = true; // do not let the rollback failure mask the migration error
            }
            // Callers (the migrate-all script) can record how far this database got.
            if (error instanceof Error) Object.assign(error, { reachedVersion: to });
            throw error;
          }
        }
        return { from, to };
      } finally {
        try {
          await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [dbName]);
        } catch {
          broken = true; // closing the connection releases the session lock
        }
      }
    } finally {
      client.release(broken);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Drops an entity database. Only call this for a database the caller itself just created
 * (e.g. when a registry write fails after provisioning); never for one that already existed.
 */
export async function dropFailedEntityDatabase(dbName: string) {
  if (!ENTITY_DB_RE.test(dbName)) throw new Error(`"${dbName}" is not an entity database name`);
  const admin = adminPool();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
