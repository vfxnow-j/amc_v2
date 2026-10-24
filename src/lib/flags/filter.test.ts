import test from "node:test";
import assert from "node:assert/strict";
import { flagWhere, isFlagFilter } from "./filter";

const now = new Date("2026-10-23T12:00:00Z");

test("all adds no condition", () => assert.deepEqual(flagWhere("all", "u1", now), {}));
test("flagged requires an open flag", () =>
  assert.deepEqual(flagWhere("flagged", "u1", now), { flags: { some: { resolvedAt: null } } }));
test("unflagged requires none", () =>
  assert.deepEqual(flagWhere("unflagged", "u1", now), { flags: { none: { resolvedAt: null } } }));
test("mine means an open flag I own", () =>
  assert.deepEqual(flagWhere("mine", "u1", now), { flags: { some: { resolvedAt: null, ownerId: "u1" } } }));
test("stale means an open flag past its next action date", () =>
  assert.deepEqual(flagWhere("stale", "u1", now), {
    flags: { some: { resolvedAt: null, nextActionDate: { lt: now } } },
  }));
test("critical means an open critical flag", () =>
  assert.deepEqual(flagWhere("critical", "u1", now), {
    flags: { some: { resolvedAt: null, severity: "CRITICAL" } },
  }));
test("the filter guard accepts only the known set", () => {
  assert.equal(isFlagFilter("stale"), true);
  assert.equal(isFlagFilter("nope"), false);
});
