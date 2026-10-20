import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import {
  provisionEntityDatabase,
  dropFailedEntityDatabase,
  migrateEntityDatabase,
  listMigrations,
  latestVersion,
} from "@/lib/entities/provision";
import { entityUrl } from "@/lib/entities/url";

const db = "vfxnow_ent_zz_check";
let failed = 0;
const ok = (label: string, pass: boolean) => { if (!pass) failed++; console.log(pass ? "ok  " : "FAIL", label); };

/** The error message a statement raises, or null if it succeeded. */
async function errorOf(pool: Pool, sql: string): Promise<string | null> {
  try { await pool.query(sql); return null; } catch (e) { return (e as Error).message; }
}
async function count(pool: Pool, table: string) {
  return Number((await pool.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
}
async function throwsMessage(fn: () => unknown): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
}

(async () => {
  let pool: Pool | undefined;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ent-mig-"));
  try {
    await dropFailedEntityDatabase(db);
    const { version } = await provisionEntityDatabase(db);
    ok("provision applies the migrations", version >= 1 && version === latestVersion());
    ok("migrating again is a no-op", (await migrateEntityDatabase(db)).from === version);

    pool = new Pool({ connectionString: entityUrl(db), max: 1 });
    await pool.query(`INSERT INTO "Item" (id, name, "updatedAt") VALUES ('i1','Case',now())`);
    await pool.query(`INSERT INTO "Movement" (id, type, "itemId", "actorUserId") VALUES ('m1','RECEIVE','i1','u1')`);

    const upd = await errorOf(pool, `UPDATE "Movement" SET notes='x' WHERE id='m1'`);
    const stillThere = async () => (await pool!.query(`SELECT notes FROM "Movement" WHERE id='m1'`)).rows;
    ok("a movement cannot be updated", !!upd && /append-only/.test(upd) && (await stillThere()).length === 1 && (await stillThere())[0].notes === null);
    const del = await errorOf(pool, `DELETE FROM "Movement" WHERE id='m1'`);
    ok("a movement cannot be deleted", !!del && /append-only/.test(del) && (await count(pool, "Movement")) === 1);
    await pool.query(`INSERT INTO "Movement" (id, type, "itemId", "actorUserId") VALUES ('m2','RECEIVE','i1','u1')`);
    const trunc = await errorOf(pool, `TRUNCATE "Movement"`);
    ok("movements cannot be truncated", !!trunc && /append-only/.test(trunc) && (await count(pool, "Movement")) === 2);

    // Proof the checks can fail for the right reason: a typo is a different error from the trigger's.
    const typo = await errorOf(pool, `UPDATE "Movement" SET no_such_column='x' WHERE id='m1'`);
    ok("a typo is reported as a different error than the trigger's", !!typo && !/append-only/.test(typo) && /no_such_column/.test(typo));
    await pool.end();
    pool = undefined;

    // Provisioning a name that already exists throws and must not drop that database.
    const dup = await throwsMessage(() => provisionEntityDatabase(db));
    ok("provisioning an existing database throws", !!dup && /already exists/.test(dup));
    const after = new Pool({ connectionString: entityUrl(db), max: 1 });
    try {
      ok("...and does not drop it", (await count(after, "Movement")) === 2);
    } finally { await after.end(); }

    // Two concurrent migrations serialise: each migration is applied exactly once.
    await dropFailedEntityDatabase(db);
    await provisionEntityDatabase(db);
    const check = new Pool({ connectionString: entityUrl(db), max: 1 });
    try {
      await check.query(`DROP TABLE _entity_migrations`);
      // Wipe the schema so migration 0001 would collide if it ran twice.
      await check.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
    } finally { await check.end(); }
    const results = await Promise.allSettled([migrateEntityDatabase(db), migrateEntityDatabase(db), migrateEntityDatabase(db)]);
    ok("concurrent migrations all succeed", results.every((r) => r.status === "fulfilled"));
    const check2 = new Pool({ connectionString: entityUrl(db), max: 1 });
    try {
      const rows = (await check2.query(`SELECT version FROM _entity_migrations`)).rows;
      ok("...and each migration is applied exactly once", rows.length === listMigrations().length);
    } finally { await check2.end(); }

    // Listing: duplicate prefixes, and an empty or missing folder.
    writeFileSync(path.join(tmp, "0001_a.sql"), "SELECT 1;");
    writeFileSync(path.join(tmp, "0001_b.sql"), "SELECT 1;");
    const dupMsg = await throwsMessage(() => listMigrations(tmp));
    ok("a duplicate migration prefix is rejected, naming both files", !!dupMsg && /0001_a\.sql/.test(dupMsg) && /0001_b\.sql/.test(dupMsg));
    rmSync(path.join(tmp, "0001_b.sql"));
    ok("a clean folder lists", listMigrations(tmp).length === 1);
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), "ent-empty-"));
    const emptyMsg = await throwsMessage(() => listMigrations(emptyDir));
    rmSync(emptyDir, { recursive: true });
    ok("an empty folder is rejected, naming it", !!emptyMsg && emptyMsg.includes(emptyDir));
  } catch (e) {
    failed++;
    console.error("FAIL unexpected error:", e);
  } finally {
    if (pool) await pool.end().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
    await dropFailedEntityDatabase(db).catch((e) => { failed++; console.error("FAIL cleanup:", (e as Error).message); });
  }
  process.exit(failed ? 1 : 0);
})();
