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

test("verify goes stale after eight days and fails on ok=false", () => {
  assert.equal(assessVerify({ verifiedAt: ago(24 * 7), ok: true }, NOW).state, "ok");
  assert.equal(assessVerify({ verifiedAt: ago(24 * 9), ok: true }, NOW).state, "stale");
  assert.equal(assessVerify({ verifiedAt: ago(1), ok: false }, NOW).state, "failed");
});

test("size helpers", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(-1), "-");
  assert.deepEqual(summariseDatabases({ databases: [{ bytes: 10 }, { bytes: 5 }, null, { bytes: "x" }] }), { count: 4, bytes: 15 });
  assert.deepEqual(summariseDatabases(null), { count: 0, bytes: 0 });
});
