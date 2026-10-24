import test from "node:test";
import assert from "node:assert/strict";
import { decideGate } from "./unit-gate-rules";

const base = {
  unitId: "u1", barcode: "AMC-1", assetName: "RTX 5090",
  serialNumber: "S1", requiresSerial: true, dataFlag: null, move: "out" as const,
};

test("a complete unit is clear", () => {
  assert.deepEqual(decideGate(base), { kind: "clear" });
});

test("a missing serial prompts", () => {
  const r = decideGate({ ...base, serialNumber: null });
  assert.equal(r.kind, "needs-data");
});

test("a flagged unit going out is blocked, coming back in it prompts", () => {
  const flagged = { ...base, serialNumber: null, dataFlag: "MISSING_SERIAL" as const };
  assert.equal(decideGate(flagged).kind, "blocked");
  assert.equal(decideGate({ ...flagged, move: "in" }).kind, "needs-data");
});

test("a scanned serial label that differs is a mismatch", () => {
  const r = decideGate({ ...base, move: "in", scannedSerial: "OTHER" });
  assert.equal(r.kind, "mismatch");
});

test("a matching serial label is clear", () => {
  assert.deepEqual(decideGate({ ...base, move: "in", scannedSerial: " s1 " }), { kind: "clear" });
});

const lost = {
  flagId: "f1", reservationNumber: "R-100", reasonCode: "lost_in_transit",
  outcome: null, claimNumber: null, outcomeAmount: null,
};

test("a unit on an open case prompts before anything else, even if its data is complete", () => {
  const r = decideGate({ ...base, openCase: lost, retiredLost: false });
  assert.equal(r.kind, "on-case");
  if (r.kind === "on-case") {
    assert.equal(r.unitState, "open-case");
    assert.equal(r.reasonLabel, "Lost in transit");
    assert.equal(r.claim, null);
  }
});

test("an open case outranks a missing serial", () => {
  const r = decideGate({ ...base, serialNumber: null, openCase: lost, retiredLost: false });
  assert.equal(r.kind, "on-case");
});

test("a written-off unit prompts, with the claim attached when one was paid", () => {
  const r = decideGate({
    ...base,
    openCase: { ...lost, outcome: "CLAIM_PAID", claimNumber: "UPS-9", outcomeAmount: 1200 },
    retiredLost: true,
  });
  assert.equal(r.kind, "on-case");
  if (r.kind === "on-case") {
    assert.equal(r.unitState, "written-off");
    assert.deepEqual(r.claim, { claimNumber: "UPS-9", amount: 1200 });
  }
});

test("a paid claim without a number or amount attaches nothing", () => {
  const r = decideGate({
    ...base,
    openCase: { ...lost, outcome: "CLAIM_PAID", claimNumber: null, outcomeAmount: 1200 },
    retiredLost: true,
  });
  assert.equal(r.kind === "on-case" && r.claim, null);
});
