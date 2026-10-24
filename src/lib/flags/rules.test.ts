import test from "node:test";
import assert from "node:assert/strict";
import { autoRaiseDecisions, canClose, exposureFor, isStale, overdueDays } from "./rules";

test("exposure sums price and landed cost", () => {
  assert.equal(exposureFor([{ purchasePrice: 1000, landedCostAdjustment: 50 }, { purchasePrice: 500, landedCostAdjustment: -10 }]), 1540);
  assert.equal(exposureFor([]), 0);
});

test("closing needs an outcome", () => {
  assert.deepEqual(canClose({ outcome: null, amount: null, stepsOpen: 0, unitsStillMissing: 0 }), { ok: false, message: "Choose an outcome to close this case." });
});

test("claim paid needs an amount", () => {
  const r = canClose({ outcome: "CLAIM_PAID", amount: null, stepsOpen: 0, unitsStillMissing: 0 });
  assert.equal(r.ok, false);
  assert.equal(canClose({ outcome: "CLAIM_PAID", amount: 900, stepsOpen: 0, unitsStillMissing: 0 }).ok, true);
});

test("found cannot close while other units are still missing", () => {
  const r = canClose({ outcome: "FOUND_RETURNED", amount: null, stepsOpen: 0, unitsStillMissing: 2 });
  assert.equal(r.ok, false);
});

test("open playbook steps do not block closing", () => {
  assert.equal(canClose({ outcome: "WRITTEN_OFF", amount: null, stepsOpen: 3, unitsStillMissing: 0 }).ok, true);
});

test("a case is stale once its next action date passes", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  assert.equal(isStale({ nextActionDate: new Date("2026-10-22T00:00:00Z"), resolvedAt: null }, now), true);
  assert.equal(isStale({ nextActionDate: new Date("2026-10-24T00:00:00Z"), resolvedAt: null }, now), false);
  assert.equal(isStale({ nextActionDate: new Date("2026-10-22T00:00:00Z"), resolvedAt: now }, now), false);
});

test("overdue return raises when units are out past the due date, clears when back", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const late = { returnDue: new Date("2026-10-20T00:00:00Z"), unitsOut: 2, invoicePastDue: false, unitsDataFlagged: 0 };
  assert.deepEqual(autoRaiseDecisions(late, [], now), { raise: ["overdue_return"], clear: [] });
  assert.deepEqual(autoRaiseDecisions({ ...late, unitsOut: 0 }, [{ ruleKey: "overdue_return" }], now), { raise: [], clear: ["overdue_return"] });
  assert.deepEqual(autoRaiseDecisions(late, [{ ruleKey: "overdue_return" }], now), { raise: [], clear: [] });
});

test("overdueDays counts whole days", () => {
  assert.equal(overdueDays(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-23T12:00:00Z")), 3);
});

test("a case whose reason has no outcomes closes with a note, and needs one", () => {
  const base = { outcome: null, amount: null, stepsOpen: 2, unitsStillMissing: 0, outcomesAllowed: [] as never[] };
  assert.deepEqual(canClose({ ...base, note: "" }), { ok: false, message: "Say how it was resolved." });
  assert.deepEqual(canClose({ ...base, note: "  " }), { ok: false, message: "Say how it was resolved." });
  assert.deepEqual(canClose({ ...base, note: "Rebooked the truck for Friday" }), { ok: true });
});

test("an outcome the reason does not offer is refused", () => {
  const r = canClose({ outcome: "FOUND_RETURNED", amount: null, stepsOpen: 0, unitsStillMissing: 0, outcomesAllowed: ["CLIENT_BILLED"] });
  assert.equal(r.ok, false);
  assert.equal(canClose({ outcome: "CLIENT_BILLED", amount: 50, stepsOpen: 0, unitsStillMissing: 0, outcomesAllowed: ["CLIENT_BILLED"] }).ok, true);
});
