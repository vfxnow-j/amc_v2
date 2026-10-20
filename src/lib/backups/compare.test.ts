import assert from "node:assert/strict";
import { test } from "node:test";
import { compareManifests, type Manifest } from "./compare";

const main = (rows: number, tables = ["entities", "settings", "users", "orders"]) => ({
  name: "vfxnow_amc_v2", kind: "main", tables, copyRows: rows,
});
const ent = (rows: number, tables = ["_entity_migrations", "Movement", "Unit", "Item"]) => ({
  name: "vfxnow_ent_a", kind: "entity", tables, copyRows: rows,
});
const m = (...databases: Manifest["databases"] & object): Manifest => ({ databases });

test("first ever set: only anchors are checked", () => {
  assert.deepEqual(compareManifests(null, m(main(5), ent(0))), []);
  assert.equal(compareManifests(null, m(main(5, ["orders"]))).length, 3);
});

test("anchor tables are required per kind", () => {
  const p = compareManifests(null, m(main(100), ent(0, ["Item"])));
  assert.equal(p.length, 3);
  assert.ok(p.every((x) => x.startsWith("vfxnow_ent_a")));
});

test("same data, small growth and small shrink pass", () => {
  assert.deepEqual(compareManifests(m(main(1000)), m(main(1200))), []);
  assert.deepEqual(compareManifests(m(main(1000)), m(main(600))), []);
});

test("a lost table is a problem", () => {
  const p = compareManifests(m(main(1000)), m(main(1000, ["entities", "settings", "users"])));
  assert.equal(p.length, 1);
  assert.match(p[0], /table\(s\) lost/);
});

test("more than 50% fewer rows is a problem; exactly half is not", () => {
  assert.equal(compareManifests(m(main(1000)), m(main(499))).length, 1);
  assert.equal(compareManifests(m(main(1000)), m(main(500))).length, 0);
  assert.equal(compareManifests(m(ent(40)), m(ent(0))).length, 1);
});

test("small previous totals are ignored", () => {
  assert.deepEqual(compareManifests(m(ent(19)), m(ent(0))), []);
  assert.equal(compareManifests(m(ent(20)), m(ent(0))).length, 1);
});

test("an entity that disappeared from the set is a problem; unregistered ones may go", () => {
  assert.equal(compareManifests(m(main(100), ent(50)), m(main(100))).length, 1);
  const unreg = { name: "vfxnow_ent_x", kind: "unregistered", tables: ["t"], copyRows: 99 };
  assert.deepEqual(compareManifests(m(main(100), unreg), m(main(100))), []);
});

test("acceptShrink skips the comparison but not the anchors", () => {
  assert.deepEqual(compareManifests(m(main(1000)), m(main(1)), { acceptShrink: true }), []);
  assert.equal(compareManifests(m(main(1000)), m(main(1, ["orders"])), { acceptShrink: true }).length, 3);
});
