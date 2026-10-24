import test from "node:test";
import assert from "node:assert/strict";
import { FLAG_CATEGORIES, OUTCOMES, REASONS, reasonByCode, reasonsIn } from "./catalog";

test("reason codes are unique", () => {
  const codes = REASONS.map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("every category has at least one reason and every reason a valid category", () => {
  for (const c of FLAG_CATEGORIES) assert.ok(reasonsIn(c).length > 0, c);
  for (const r of REASONS) assert.ok(FLAG_CATEGORIES.includes(r.category), r.code);
});

test("the lost-in-transit playbook has the claim steps in order", () => {
  const r = reasonByCode("lost_in_transit");
  assert.ok(r);
  assert.equal(r.tracksUnits, true);
  assert.equal(r.asksCarrier, true);
  assert.deepEqual(r.playbook.slice(0, 2), [
    "Record carrier, tracking number and last scan",
    "Open a trace with the carrier",
  ]);
});

test("write-off retires units and needs no amount; claim paid needs one", () => {
  const w = OUTCOMES.find((o) => o.code === "WRITTEN_OFF");
  const c = OUTCOMES.find((o) => o.code === "CLAIM_PAID");
  assert.equal(w?.unitsEnd, "retire");
  assert.equal(w?.needsAmount, false);
  assert.equal(c?.needsAmount, true);
});
