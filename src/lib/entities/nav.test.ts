import test from "node:test";
import assert from "node:assert/strict";
import { entityNavItems, isNavActive, movementLabel, otherEntities } from "./nav";

test("a writer sees all six links, in order", () => {
  assert.deepEqual(entityNavItems("acme", true).map((i) => i.label), ["Dashboard", "Inventory", "Receive", "Release & return", "Movement log", "Locations"]);
  assert.equal(entityNavItems("acme", true)[0].href, "/entity/acme");
  assert.equal(entityNavItems("acme", true)[3].href, "/entity/acme/release");
});

test("a read-only viewer does not see Receive or Release", () => {
  assert.deepEqual(entityNavItems("acme", false).map((i) => i.label), ["Dashboard", "Inventory", "Movement log", "Locations"]);
});

test("Dashboard is active only on the exact entity root", () => {
  const [dash, inv] = entityNavItems("acme", true);
  assert.equal(isNavActive("/entity/acme", dash), true);
  assert.equal(isNavActive("/entity/acme/", dash), true);
  assert.equal(isNavActive("/entity/acme/inventory", dash), false);
  assert.equal(isNavActive("/entity/acme/inventory/abc", inv), true);
  assert.equal(isNavActive("/entity/acme/inventory-x", inv), false);
});

test("the picker leaves out the current entity", () => {
  const all = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];
  assert.deepEqual(otherEntities(all, "a"), [{ slug: "b", name: "B" }]);
});

test("a correction row is labelled as a correction", () => {
  assert.equal(movementLabel({ type: "MOVE", quantity: 0, correctsId: "x", finalToOwner: false }), "Correction");
  assert.equal(movementLabel({ type: "MOVE", quantity: 1, correctsId: null, finalToOwner: false }), "Move");
  assert.equal(movementLabel({ type: "RELEASE", quantity: 1, correctsId: null, finalToOwner: true }), "Returned to owner");
  assert.equal(movementLabel({ type: "RELEASE", quantity: 1, correctsId: null, finalToOwner: false }), "Release");
  assert.equal(movementLabel({ type: "RECEIVE", quantity: 2, correctsId: null, finalToOwner: false }), "Receive");
  assert.equal(movementLabel({ type: "RETURN", quantity: 1, correctsId: null, finalToOwner: false }), "Return");
});
