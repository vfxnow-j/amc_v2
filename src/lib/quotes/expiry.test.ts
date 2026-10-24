import test from "node:test";
import assert from "node:assert/strict";
import { canSetExpiry, expiryFromChoice, endOfExpiryDay } from "./expiry";

const now = new Date("2026-10-23T15:30:00Z");

test("quick picks land on a midday-anchored date that many days out", () => {
  assert.equal(expiryFromChoice("1d", now).toISOString(), "2026-10-24T12:00:00.000Z");
  assert.equal(expiryFromChoice("3d", now).toISOString(), "2026-10-26T12:00:00.000Z");
  assert.equal(expiryFromChoice("7d", now).toISOString(), "2026-10-30T12:00:00.000Z");
  assert.equal(expiryFromChoice("30d", now).toISOString(), "2026-11-22T12:00:00.000Z");
});

test("the link lives to the end of its expiry day", () => {
  assert.equal(endOfExpiryDay(new Date("2026-10-30T12:00:00Z")).toISOString(), "2026-10-30T23:59:59.999Z");
});

test("expiry can be set only on a quote that is still open, and not in the past", () => {
  const future = new Date("2026-10-30T12:00:00Z");
  for (const status of ["DRAFT", "REVISION", "QUOTE_SENT"]) {
    assert.deepEqual(canSetExpiry(status, future, now), { ok: true });
  }
  assert.equal(canSetExpiry("APPROVED", future, now).ok, false);
  assert.equal(canSetExpiry("DRAFT", new Date("2026-10-22T12:00:00Z"), now).ok, false);
});

test("today is allowed", () => {
  assert.equal(canSetExpiry("DRAFT", new Date("2026-10-23T12:00:00Z"), now).ok, true);
});
