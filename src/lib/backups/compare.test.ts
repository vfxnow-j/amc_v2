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

import { REAL_MAIN_ROWS } from "./compare.fixture";

const realMain = (rows: Record<string, number>): Manifest => ({
  databases: [{
    name: "vfxnow_amc_v2", kind: "main", tables: Object.keys(rows),
    rowsByTable: rows, copyRows: Object.values(rows).reduce((a, b) => a + b, 0),
  }],
});
const KEEP = new Set(["postal_centroids", "v1_link.origin", "entities", "settings"]);

test("real distribution: wiping every business table is caught although the total only drops ~18%", () => {
  const wiped = Object.fromEntries(Object.entries(REAL_MAIN_ROWS).map(([k, v]) => [k, KEEP.has(k) ? v : 0]));
  const p = compareManifests(realMain(REAL_MAIN_ROWS), realMain(wiped));
  assert.ok(p.some((x) => x.includes("table asset_units")));
  assert.ok(p.some((x) => x.includes("table reservations ")));
  assert.ok(!p.some((x) => x.includes("row count fell")), "the total rule alone would have missed it");
});

test("real distribution: normal growth, and churn tables emptying, are fine", () => {
  const grown = Object.fromEntries(Object.entries(REAL_MAIN_ROWS).map(([k, v]) => [k, v + 3]));
  assert.deepEqual(compareManifests(realMain(REAL_MAIN_ROWS), realMain(grown)), []);
  const churned = { ...REAL_MAIN_ROWS, sessions: 0, notifications: 0, portal_request_log: 0, current_rms_apply_log: 0, quote_tokens: 0, email_tokens: 0, mfa_trust_tokens: 0 };
  assert.deepEqual(compareManifests(realMain({ ...REAL_MAIN_ROWS, sessions: 400 }), realMain(churned)), []);
});

test("audit_logs is history, not churn: emptying it is flagged", () => {
  const p = compareManifests(realMain(REAL_MAIN_ROWS), realMain({ ...REAL_MAIN_ROWS, audit_logs: 0 }));
  assert.equal(p.length, 1);
  assert.match(p[0], /audit_logs/);
});

test("a new table is fine, a lost table is flagged", () => {
  assert.deepEqual(compareManifests(realMain(REAL_MAIN_ROWS), realMain({ ...REAL_MAIN_ROWS, brand_new: 0 })), []);
  const { assets: _drop, ...without } = REAL_MAIN_ROWS;
  void _drop;
  assert.match(compareManifests(realMain(REAL_MAIN_ROWS), realMain(without))[0], /lost/);
});

test("entity Movement and Unit may never decrease, even by one", () => {
  const e = (movement: number, unit: number): Manifest => ({
    databases: [{ name: "vfxnow_ent_a", kind: "entity", tables: ["_entity_migrations", "Movement", "Unit"],
      rowsByTable: { _entity_migrations: 2, Movement: movement, Unit: unit }, copyRows: 2 + movement + unit }],
  });
  assert.deepEqual(compareManifests(e(10, 10), e(10, 10)), []);
  assert.deepEqual(compareManifests(e(10, 10), e(12, 11)), []);
  assert.match(compareManifests(e(10, 10), e(9, 10))[0], /Movement/);
  assert.match(compareManifests(e(10, 10), e(10, 9))[0], /Unit/);
});
