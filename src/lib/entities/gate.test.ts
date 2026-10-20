import test from "node:test";
import assert from "node:assert/strict";
import { decideEntity, type UserRecord } from "./gate";

const a = { id: "a", slug: "acme" }, b = { id: "b", slug: "beta" };
const user = (o: Partial<UserRecord> = {}): UserRecord => ({ role: "STAFF", entityAccess: true, entityScope: "SELECTED", disabledAt: null, entityGrants: [{ entityId: "a" }], ...o });
const reason = (d: ReturnType<typeof decideEntity>) => (d.ok ? "" : d.reason);

test("a granted entity opens; an ungranted one does not", () => {
  assert.equal(decideEntity(user(), [a, b], "acme").ok, true);
  assert.match(reason(decideEntity(user(), [a, b], "beta")), /access/);
});
test("unknown slug and inactive (absent) entity are refused", () => {
  assert.equal(decideEntity(user(), [a], "nope").ok, false);
  assert.equal(decideEntity(user({ entityGrants: [{ entityId: "b" }] }), [a], "beta").ok, false);
});
test("missing or disabled users are unauthorized", () => {
  assert.equal(reason(decideEntity(null, [a], "acme")), "Unauthorized");
  assert.equal(reason(decideEntity(user({ disabledAt: new Date() }), [a], "acme")), "Unauthorized");
});
test("scope ALL opens everything; no entityAccess opens nothing; super admin always", () => {
  assert.equal(decideEntity(user({ entityScope: "ALL", entityGrants: [] }), [b], "beta").ok, true);
  assert.equal(decideEntity(user({ entityAccess: false }), [a], "acme").ok, false);
  assert.equal(decideEntity(user({ role: "SUPER_ADMIN", entityAccess: false, entityGrants: [] }), [b], "beta").ok, true);
  assert.equal(decideEntity(user({ role: "FLOW_USER", entityScope: "ALL" }), [a], "acme").ok, false);
});
test("write needs STAFF or above; viewers can read", () => {
  const v = user({ role: "VIEWER" });
  assert.equal(decideEntity(v, [a], "acme").ok, true);
  assert.match(reason(decideEntity(v, [a], "acme", { write: true })), /not change/);
  assert.equal(decideEntity(user({ role: "ADMIN" }), [a], "acme", { write: true }).ok, true);
});
