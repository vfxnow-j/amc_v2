import test from "node:test";
import assert from "node:assert/strict";
import { check, correctionSchema, itemSchema, receiveUnitsSchema, stockMoveSchema, unitMoveSchema } from "./schemas";

const msg = (r: { ok: boolean; message?: string }) => (r.ok ? "" : r.message);

test("units must be a list of objects, not a string", () => {
  const r = check(receiveUnitsSchema, { itemId: "i", toLocationId: "l", units: "x".repeat(500) });
  assert.equal(r.ok, false);
  assert.match(msg(r)!, /list/);
  assert.equal(check(receiveUnitsSchema, { itemId: "i", toLocationId: "l", units: ["a"] }).ok, false);
});
test("units length 1..500", () => {
  assert.equal(check(receiveUnitsSchema, { itemId: "i", toLocationId: "l", units: [] }).ok, false);
  assert.equal(check(receiveUnitsSchema, { itemId: "i", toLocationId: "l", units: Array(501).fill({}) }).ok, false);
  assert.equal(check(receiveUnitsSchema, { itemId: "i", toLocationId: "l", units: Array(500).fill({ serial: "s" }) }).ok, true);
});
test("overlong text is refused", () => {
  assert.match(msg(check(itemSchema, { name: "a", trackingMode: "SERIALIZED", notes: "n".repeat(2001) }))!, /notes/);
  assert.equal(check(itemSchema, { name: "a".repeat(201), trackingMode: "SERIALIZED" }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "RELEASE", recipient: "r".repeat(201) }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "RELEASE", newSiteName: "s".repeat(121) }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "RELEASE", newSiteAddress: "s".repeat(301) }).ok, false);
});
test("bad enums, unknown keys and wrong types are refused", () => {
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "RECEIVE" }).ok, false);
  assert.equal(check(itemSchema, { name: "a", trackingMode: "BOTH" }).ok, false);
  assert.equal(check(stockMoveSchema, { itemId: "i", type: "BURN", quantity: 1 }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "MOVE", extra: 1 }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: 5, type: "MOVE" }).ok, false);
  assert.equal(check(itemSchema, null).ok, false);
  assert.equal(check(itemSchema, "x").ok, false);
});
test("quantity must be a safe integer 1..1,000,000", () => {
  for (const q of [0, -1, 1.5, 2 ** 53, 1_000_001, "5", NaN, undefined]) assert.equal(check(stockMoveSchema, { itemId: "i", type: "RECEIVE", quantity: q }).ok, false, String(q));
  assert.equal(check(stockMoveSchema, { itemId: "i", type: "RECEIVE", quantity: 1_000_000 }).ok, true);
});
test("ids are bounded and a good move passes", () => {
  assert.equal(check(unitMoveSchema, { unitId: "x".repeat(65), type: "MOVE" }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "", type: "MOVE" }).ok, false);
  assert.equal(check(unitMoveSchema, { unitId: "u", type: "MOVE", toLocationId: "l", notes: "ok", occurredAt: "2026-10-20" }).ok, true);
  assert.equal(check(correctionSchema, { movementId: "m", note: "  " }).ok, false);
});
