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

test("reasons that track units can close with a unit outcome; the rest close with a note", () => {
  for (const r of REASONS.filter((x) => x.tracksUnits)) assert.ok(r.outcomes.length > 0, r.code);
  assert.deepEqual(reasonByCode("payment_overdue")?.outcomes, []);
  assert.deepEqual(reasonByCode("driver_unavailable")?.outcomes, []);
  assert.equal(reasonByCode("lost_in_transit")?.outcomes.length, 5);
});

test("every allowed outcome is a real outcome", () => {
  const codes = OUTCOMES.map((o) => o.code);
  for (const r of REASONS) for (const o of r.outcomes) assert.ok(codes.includes(o), `${r.code}: ${o}`);
});

test("the operations-side categories exist and have reasons", () => {
  for (const c of ["transport", "warehouse", "site", "vendor", "internal", "risk"] as const) {
    assert.ok(FLAG_CATEGORIES.includes(c), c);
    assert.ok(reasonsIn(c).length >= 3, c);
  }
  assert.equal(reasonByCode("damaged_in_transit")?.category, "transport");
  assert.equal(reasonByCode("damaged_in_transit")?.asksCarrier, true);
});
