import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBackup, assessVerify, formatBytes, summariseDatabases } from "./status";

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test("missing status is 'never'", () => {
  assert.equal(assessBackup(null, NOW).state, "never");
  assert.equal(assessBackup(undefined, NOW).state, "never");
  assert.equal(assessVerify(null, NOW).state, "never");
});

test("a recent ok run is ok", () => {
  assert.equal(assessBackup({ lastRunAt: ago(9), ok: true }, NOW).state, "ok");
});

test("the 26 hour threshold: 26h is ok, just past it is stale", () => {
  assert.equal(assessBackup({ lastRunAt: ago(26), ok: true }, NOW).state, "ok");
  assert.equal(assessBackup({ lastRunAt: ago(26.01), ok: true }, NOW).state, "stale");
  assert.equal(assessBackup({ lastRunAt: ago(30), ok: true }, NOW, 48).state, "ok");
});

test("a failed last run is failed, however recent or old", () => {
  assert.equal(assessBackup({ lastRunAt: ago(1), ok: false }, NOW).state, "failed");
  assert.equal(assessBackup({ lastRunAt: ago(500), ok: false }, NOW).state, "failed");
});

test("garbage is failed, not ok", () => {
  assert.equal(assessBackup({}, NOW).state, "failed");
  assert.equal(assessBackup({ lastRunAt: "yesterday", ok: true }, NOW).state, "failed");
  assert.equal(assessBackup({ lastRunAt: 5, ok: true }, NOW).state, "failed");
  assert.equal(assessBackup({ lastRunAt: ago(1), ok: "true" }, NOW).state, "failed");
});

test("verify goes stale after 26 hours and fails on ok=false", () => {
  assert.equal(assessVerify({ verifiedAt: ago(25), ok: true }, NOW).state, "ok");
  assert.equal(assessVerify({ verifiedAt: ago(27), ok: true }, NOW).state, "stale");
  assert.equal(assessVerify({ verifiedAt: ago(1), ok: false }, NOW).state, "failed");
});

test("size helpers", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(-1), "-");
  assert.deepEqual(summariseDatabases({ databases: [{ bytes: 10 }, { bytes: 5 }, null, { bytes: "x" }] }), { count: 4, bytes: 15 });
  assert.deepEqual(summariseDatabases(null), { count: 0, bytes: 0 });
});

test("a future-dated record is failed, not ok", () => {
  assert.equal(assessBackup({ lastRunAt: ago(-5), ok: true }, NOW).state, "failed");
  assert.equal(assessBackup({ lastRunAt: ago(-0.5), ok: true }, NOW).state, "ok"); // small clock skew is fine
  assert.equal(assessVerify({ verifiedAt: ago(-100), ok: true }, NOW).state, "failed");
});

test("an unreadable file is its own state, distinct from never", () => {
  assert.equal(assessBackup("unreadable", NOW).state, "unreadable");
  assert.equal(assessVerify("unreadable", NOW).state, "unreadable");
  assert.equal(assessBackup(null, NOW).state, "never");
});

test("partial and suspect outcomes read differently from a plain failure", () => {
  const base = { lastRunAt: ago(1), ok: false };
  assert.match(assessBackup({ ...base, outcome: "partial" }, NOW).reason, /problems/);
  assert.match(assessBackup({ ...base, outcome: "suspect" }, NOW).reason, /suspect/);
  assert.match(assessBackup({ ...base, outcome: "failed" }, NOW).reason, /failed/);
});

import { dueAlerts, problemsFrom } from "./status";

test("problemsFrom lists only what is not ok, keyed by source and state", () => {
  const ok = assessBackup({ lastRunAt: ago(1), ok: true }, NOW);
  const stale = assessVerify({ verifiedAt: ago(40), ok: true }, NOW);
  assert.deepEqual(problemsFrom(ok, ok), []);
  assert.deepEqual(problemsFrom(ok, stale).map((p) => p.key), ["restore-test:stale"]);
});

test("dueAlerts: first time sends, within 24h stays quiet, after 24h sends again, cleared problems are forgotten", () => {
  const p = [{ key: "backup:failed", text: "x" }];
  const first = dueAlerts(p, {}, NOW);
  assert.equal(first.send.length, 1);
  const again = dueAlerts(p, first.next, new Date(NOW.getTime() + 3 * 3_600_000));
  assert.equal(again.send.length, 0);
  assert.equal(again.next["backup:failed"], first.next["backup:failed"]);
  const later = dueAlerts(p, first.next, new Date(NOW.getTime() + 25 * 3_600_000));
  assert.equal(later.send.length, 1);
  const cleared = dueAlerts([], first.next, NOW);
  assert.deepEqual(cleared.next, {});
  assert.equal(dueAlerts(p, cleared.next, NOW).send.length, 1);
});

test("a different problem is its own alert", () => {
  const sent = { "backup:failed": NOW.toISOString() };
  const r = dueAlerts([{ key: "backup:failed", text: "a" }, { key: "restore-test:failed", text: "b" }], sent, NOW);
  assert.deepEqual(r.send.map((x) => x.key), ["restore-test:failed"]);
});
