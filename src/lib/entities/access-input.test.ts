import test from "node:test";
import assert from "node:assert/strict";
import { accessCardMode, entityAccessSchema, userIdSchema } from "./access-input";

const ok = { entityAccess: true, scope: "SELECTED", entityIds: ["a", "b"] };

test("a valid input parses", () => {
  assert.ok(entityAccessSchema.safeParse(ok).success);
  assert.ok(entityAccessSchema.safeParse({ entityAccess: false, scope: "ALL", entityIds: [] }).success);
});
test("a bad scope, wrong types, an unknown key and too many ids are refused", () => {
  assert.equal(entityAccessSchema.safeParse({ ...ok, scope: "NONE" }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, entityAccess: "true" }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, entityIds: "a" }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, entityIds: [1] }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, entityIds: [""] }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, role: "SUPER_ADMIN" }).success, false);
  assert.equal(entityAccessSchema.safeParse({ ...ok, entityIds: Array.from({ length: 101 }, (_, i) => `e${i}`) }).success, false);
  assert.ok(entityAccessSchema.safeParse({ ...ok, entityIds: Array.from({ length: 100 }, (_, i) => `e${i}`) }).success);
  assert.equal(entityAccessSchema.safeParse(null).success, false);
});
test("the user id is 1 to 64 characters", () => {
  assert.ok(userIdSchema.safeParse("u1").success);
  assert.equal(userIdSchema.safeParse("").success, false);
  assert.equal(userIdSchema.safeParse("x".repeat(65)).success, false);
  assert.equal(userIdSchema.safeParse(5).success, false);
});
test("the card shows text for super admins and flow users, controls for the rest", () => {
  assert.deepEqual(accessCardMode("SUPER_ADMIN"), { kind: "everything", text: "Super admins can open every entity." });
  assert.deepEqual(accessCardMode("FLOW_USER"), { kind: "refused", text: "Flow users can't be given entity access." });
  for (const r of ["ADMIN", "STAFF", "VIEWER"]) assert.equal(accessCardMode(r).kind, "controls");
});
