import { Pool } from "pg";
import { provisionEntityDatabase, dropFailedEntityDatabase, migrateEntityDatabase } from "@/lib/entities/provision";
import { entityUrl } from "@/lib/entities/client";

const db = "vfxnow_ent_zz_check";
let failed = 0;
const ok = (label: string, pass: boolean) => { if (!pass) failed++; console.log(pass ? "ok  " : "FAIL", label); };
const fails = async (pool: Pool, sql: string) => { try { await pool.query(sql); return false; } catch { return true; } };

(async () => {
  await dropFailedEntityDatabase(db);
  const { version } = await provisionEntityDatabase(db);
  ok("provision applies the migrations", version >= 1);
  ok("migrating again is a no-op", (await migrateEntityDatabase(db)).from === version);

  const pool = new Pool({ connectionString: entityUrl(db), max: 1 });
  await pool.query(`INSERT INTO "Item" (id, name, "updatedAt") VALUES ('i1','Case',now())`);
  await pool.query(`INSERT INTO "Movement" (id, type, "itemId", "actorUserId") VALUES ('m1','RECEIVE','i1','u1')`);
  ok("a movement cannot be updated", await fails(pool, `UPDATE "Movement" SET notes='x' WHERE id='m1'`));
  ok("a movement cannot be deleted", await fails(pool, `DELETE FROM "Movement" WHERE id='m1'`));
  ok("movements cannot be truncated", await fails(pool, `TRUNCATE "Movement"`));
  await pool.end();

  await dropFailedEntityDatabase(db);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
