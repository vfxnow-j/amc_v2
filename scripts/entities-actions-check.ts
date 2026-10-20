/**
 * Integration check for the inventory write path, against a throwaway entity
 * database (vfxnow_ent_zz_actions). The server actions need a session so they
 * cannot be called here; they are thin wrappers over the functions in
 * src/lib/entities/ledger.ts, which this script calls directly.
 */
import { Pool } from "pg";
import { dropFailedEntityDatabase, provisionEntityDatabase } from "@/lib/entities/provision";
import { entityDb, entityUrl } from "@/lib/entities/client";
import { receiveUnitsTx, writeCorrection, writeStockMovement, writeUnitMovement } from "@/lib/entities/ledger";

const DB = "vfxnow_ent_zz_actions";
let failed = 0;
const ok = (label: string, pass: boolean) => { if (!pass) failed++; console.log(pass ? "ok  " : "FAIL", label); };
const refused = (r: { ok: boolean }, label: string, reason?: RegExp & { source: string }) => {
  const res = r as { ok: boolean; reason?: string };
  ok(label, !res.ok && (!reason || reason.test(res.reason ?? "")));
};

(async () => {
  let pool: Pool | undefined;
  try {
    await dropFailedEntityDatabase(DB);
    await provisionEntityDatabase(DB);
    const db = entityDb(DB);
    pool = new Pool({ connectionString: entityUrl(DB), max: 1 });
    const actor = "user-1";
    const WH = "loc-warehouse", WH2 = "loc-shelf", SITE = "loc-site";
    let sitesMade = 0;
    const makeSite = async (name: string) => { sitesMade++; return `site-${name}`; };

    // Serialized unit: receive, release, refused move while deployed, return.
    const cam = await db.item.create({ data: { name: "Camera", trackingMode: "SERIALIZED" } });
    const r1 = await receiveUnitsTx(db, { actorUserId: actor, itemId: cam.id, toLocationId: WH, units: [{ serial: "S1", scanTag: "TAG1" }] });
    ok("receive a unit", r1.ok);
    const unit = (await db.unit.findFirstOrThrow({ where: { itemId: cam.id } }));
    ok("unit is IN_STORAGE at the warehouse", unit.status === "IN_STORAGE" && unit.currentLocationId === WH);
    refused(await receiveUnitsTx(db, { actorUserId: actor, itemId: cam.id, toLocationId: WH, units: [{ serial: "S2", scanTag: "TAG1" }] }), "duplicate scan tag refused", /scan tag/);
    ok("a refused receipt left no extra unit", (await db.unit.count({ where: { itemId: cam.id } })) === 1);

    refused(await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RELEASE", toLocationId: WH, recipient: "Acme" }), "release to where it already is refused", /where it already is/);
    refused(await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RELEASE", newSite: { name: "Ghost" }, makeSite }), "release without a recipient refused", /who/);
    ok("a refused release created no site", sitesMade === 0);

    const rel = await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RELEASE", toLocationId: SITE, recipient: "Acme", carrier: "UPS" });
    ok("release to a site", rel.ok);
    let u = await db.unit.findUniqueOrThrow({ where: { id: unit.id } });
    ok("unit is DEPLOYED at the site", u.status === "DEPLOYED" && u.currentLocationId === SITE);
    refused(await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "MOVE", toLocationId: WH2 }), "moving a deployed unit refused", /deployed unit/);
    const ret = await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RETURN", toLocationId: WH2 });
    ok("return to storage", ret.ok);
    u = await db.unit.findUniqueOrThrow({ where: { id: unit.id } });
    ok("unit is IN_STORAGE at the shelf", u.status === "IN_STORAGE" && u.currentLocationId === WH2);
    const mv = await db.movement.findMany({ where: { unitId: unit.id }, orderBy: { createdAt: "asc" } });
    ok("ledger has RECEIVE, RELEASE, RETURN in order", mv.map((m) => m.type).join() === "RECEIVE,RELEASE,RETURN");
    ok("the RELEASE row records the unit's own location as 'from'", mv[1].fromLocationId === WH && mv[1].toLocationId === SITE);
    ok("the RETURN row records the site as 'from'", mv[2].fromLocationId === SITE);

    // New site on the spot, then final hand-back.
    const rel2 = await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RELEASE", newSite: { name: "Stage 9", address: "1 Lot Rd" }, makeSite, recipient: "Crew" });
    u = await db.unit.findUniqueOrThrow({ where: { id: unit.id } });
    ok("release to a new site creates it once", rel2.ok && sitesMade === 1 && u.currentLocationId === "site-Stage 9");
    await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RETURN", toLocationId: WH });
    const fin = await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "RELEASE", recipient: "Owner", finalToOwner: true });
    u = await db.unit.findUniqueOrThrow({ where: { id: unit.id } });
    ok("final hand-back leaves RETURNED_TO_OWNER with no location", fin.ok && u.status === "RETURNED_TO_OWNER" && u.currentLocationId === null);
    refused(await writeUnitMovement(db, { actorUserId: actor, unitId: unit.id, type: "MOVE", toLocationId: WH }), "a handed-back unit cannot be moved");

    // Quantity item: receive 40, release 15, return 15.
    const cable = await db.item.create({ data: { name: "Cable", trackingMode: "QUANTITY" } });
    const q = (type: "RECEIVE" | "MOVE" | "RELEASE" | "RETURN", quantity: number, extra: object = {}) =>
      writeStockMovement(db, { actorUserId: actor, itemId: cable.id, type, quantity, ...extra });
    ok("receive 40", (await q("RECEIVE", 40, { toLocationId: WH })).ok);
    ok("release 15 to a site", (await q("RELEASE", 15, { fromLocationId: WH, toLocationId: SITE, recipient: "Acme" })).ok);
    let rows = await db.stock.findMany({ where: { itemId: cable.id } });
    ok("stock is 25 stored and 15 deployed", rows.find((r) => !r.deployed)?.quantity === 25 && rows.find((r) => r.deployed)?.quantity === 15);
    refused(await q("RELEASE", 26, { fromLocationId: WH, toLocationId: SITE, recipient: "Acme" }), "releasing more than is stored refused", /not that much/);
    for (const bad of [0, -3, 2.5, 2 ** 53, 1_000_001]) refused(await q("RECEIVE", bad, { toLocationId: WH }), `quantity ${bad} refused`);
    ok("return 15", (await q("RETURN", 15, { fromLocationId: SITE, toLocationId: WH })).ok);
    rows = await db.stock.findMany({ where: { itemId: cable.id } });
    ok("stock is 40 stored, nothing deployed", rows.length === 1 && rows[0].quantity === 40 && !rows[0].deployed);
    ok("only the 3 accepted cable movements were written (refusals wrote none)", (await db.movement.count({ where: { itemId: cable.id } })) === 3);

    // Correction: a ledger row only; state untouched.
    const first = await db.movement.findFirstOrThrow({ where: { itemId: cable.id }, orderBy: { createdAt: "asc" } });
    refused(await writeCorrection(db, { movementId: first.id, note: "  ", actorUserId: actor }), "an empty correction note refused");
    ok("correction logged", (await writeCorrection(db, { movementId: first.id, note: "wrong site", actorUserId: actor })).ok);
    const corr = await db.movement.findFirstOrThrow({ where: { correctsId: first.id } });
    rows = await db.stock.findMany({ where: { itemId: cable.id } });
    ok("correction row is MOVE qty 0 pointing at the original", corr.type === "MOVE" && corr.quantity === 0 && corr.correctsId === first.id);
    ok("stock unchanged by the correction", rows.length === 1 && rows[0].quantity === 40);

    // Append-only trigger still holds.
    const upd = await pool.query(`UPDATE "Movement" SET notes='x' WHERE id=$1`, [first.id]).then(() => null, (e: Error) => e.message);
    ok("ledger rows still cannot be updated", !!upd && /append-only/.test(upd));
    const del = await pool.query(`DELETE FROM "Movement" WHERE id=$1`, [first.id]).then(() => null, (e: Error) => e.message);
    ok("ledger rows still cannot be deleted", !!del && /append-only/.test(del));
  } catch (error) {
    failed++;
    console.log("FAIL", "unexpected error:", (error as Error).message);
  } finally {
    await pool?.end().catch(() => {});
    await entityDb(DB).$disconnect().catch(() => {});
    await dropFailedEntityDatabase(DB).catch((e) => { failed++; console.log("FAIL could not drop", DB, (e as Error).message); });
  }
  console.log(failed ? `${failed} FAILED` : "all ok");
  process.exit(failed ? 1 : 0);
})();
