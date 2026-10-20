import test from "node:test";
import assert from "node:assert/strict";
import { parseOccurredAt } from "./dates";

const now = new Date("2026-10-20T20:00:00Z");
const bad = (s: string) => assert.equal(parseOccurredAt(s, now).ok, false, s);

test("garbage and lax strings are refused", () => {
  for (const s of ["", "garbage", "1", "2001", "10/20/2026", "Oct 20 2026", "2026-10", "2026-10-20 10:00", "2026-10-20T10:00"]) bad(s);
});
test("impossible calendar days are refused", () => {
  bad("2026-02-31");
  bad("2026-13-01");
  bad("2026-00-10");
});
test("bounds", () => {
  bad("1999-12-31");
  bad("9999-12-31");
  bad("2026-10-23");
  bad("2026-10-21T21:00:00Z");
  assert.ok(parseOccurredAt("2000-01-01", now).ok);
  assert.ok(parseOccurredAt("2026-10-21", now).ok);
  assert.ok(parseOccurredAt("2026-10-21T19:00:00Z", now).ok);
});
test("a date-only value is noon UTC on that day; a datetime keeps its instant", () => {
  const d = parseOccurredAt("2026-10-20", now);
  assert.ok(d.ok && d.date.toISOString() === "2026-10-20T12:00:00.000Z");
  const t = parseOccurredAt("2026-10-20T14:30:00-07:00", now);
  assert.ok(t.ok && t.date.toISOString() === "2026-10-20T21:30:00.000Z");
});

test("datetimes with impossible days, hour 24 or wild offsets are refused", () => {
  for (const s of ["2026-02-30T10:00:00Z", "2025-02-29T10:00Z", "2026-04-31T10:00:00-07:00", "2026-10-20T24:00:00Z", "2026-10-20T10:60:00Z", "2026-10-20T10:00:00+14:30", "2026-10-20T10:00:00-15:00", "2026-10-20T10:00:00+05:60"]) bad(s);
});
test("valid leap-day and edge offsets are accepted", () => {
  assert.ok(parseOccurredAt("2028-02-29T10:00:00Z", new Date("2030-01-01Z")).ok);
  assert.ok(parseOccurredAt("2026-10-20T10:00:00+14:00", now).ok);
  assert.ok(parseOccurredAt("2026-10-20T10:00:00-12:00", now).ok);
});
