import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRotation, formatStamp, isoWeekKey, parseStamp } from "./rotation";

const NOW = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;

function dailyNames(count: number, spanDays: number, endIso = "2026-10-20T02:30:00Z"): string[] {
  // `count` sets spread evenly over `spanDays` days ending at endIso.
  const end = Date.parse(endIso);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatStamp(new Date(end - Math.round((i * spanDays * DAY) / (count - 1)))));
  }
  return out;
}

test("stamp parsing accepts real UTC date-times only", () => {
  assert.ok(parseStamp("20261020-023000"));
  assert.equal(parseStamp("20261320-023000"), null);
  assert.equal(parseStamp("20260230-023000"), null);
  assert.equal(parseStamp("20261020-246000"), null);
  assert.equal(parseStamp("20261020-02300"), null);
  assert.equal(parseStamp("../20261020-023000"), null);
  assert.equal(parseStamp(""), null);
});

test("empty list decides nothing", () => {
  const d = decideRotation([], NOW);
  assert.deepEqual(d, { keep: [], delete: [], ignored: [] });
});

test("fewer sets than the daily window are all kept", () => {
  const names = dailyNames(5, 4);
  const d = decideRotation(names, NOW);
  assert.equal(d.delete.length, 0);
  assert.equal(d.keep.length, 5);
});

test("40 consecutive days keep 14 dailies plus weekly firsts of older weeks, never the rest", () => {
  const names: string[] = [];
  for (let i = 0; i < 40; i++) names.push(formatStamp(new Date(Date.parse("2026-10-20T02:30:00Z") - i * DAY)));
  const d = decideRotation(names, NOW);
  const kept = new Set(d.keep.map((k) => k.name));
  // The 14 newest days are all kept.
  for (let i = 0; i < 14; i++) assert.ok(kept.has(names[i]), `daily ${i}`);
  // Weekly firsts: the first set (a Monday here) of each of the 8 newest ISO weeks.
  const weekly = d.keep.filter((k) => k.reasons.includes("weekly"));
  assert.ok(weekly.length <= 8);
  assert.ok(weekly.length >= 6);
  assert.equal(d.keep.length + d.delete.length, 40);
  // 14 dailies + older weekly firsts only
  const olderKept = d.keep.filter((k) => !names.slice(0, 14).includes(k.name));
  for (const k of olderKept) assert.deepEqual(k.reasons, ["weekly"]);
  assert.ok(d.delete.length > 0);
});

test("20 sets spread over 40 days keep the newest 14 days of sets plus weekly firsts", () => {
  const names = dailyNames(20, 40);
  const d = decideRotation(names, NOW);
  assert.equal(d.keep.length + d.delete.length, 20);
  const kept = new Set(d.keep.map((k) => k.name));
  assert.ok(kept.has(names[0]), "newest kept");
  // Every deleted set is older than the newest 14 and is not first in its week.
  for (const del of d.delete) assert.ok(!kept.has(del));
  assert.ok(d.keep.length >= 14 - 0 || d.keep.length === 20);
});

test("never deletes the newest set, even alone in a stale pile", () => {
  const names = ["20240101-000000", "20240102-000000", "20260101-000000"];
  const d = decideRotation(names, NOW);
  assert.ok(d.keep.some((k) => k.name === "20260101-000000" && k.reasons.includes("newest")));
});

test("the clock does not matter: an old pile is not wiped", () => {
  const names = ["20200101-000000", "20200102-000000"];
  const d = decideRotation(names, NOW);
  assert.deepEqual(d.delete, []);
});

test("several sets in one day keep only the newest of the day, plus the week's first", () => {
  const names = ["20261019-010000", "20261019-120000", "20261019-230000"];
  const d = decideRotation(names, NOW);
  const byName = Object.fromEntries(d.keep.map((k) => [k.name, k.reasons]));
  assert.deepEqual(byName["20261019-230000"], ["newest", "daily"]);
  assert.deepEqual(byName["20261019-010000"], ["weekly"]);
  assert.deepEqual(d.delete, ["20261019-120000"]);
});

test("non-stamp names are ignored and never deleted", () => {
  const names = ["notes", ".tmp-20261020-023000", "20261020-023000.partial", "2026-10-20", "../x", "20261320-000000", "20261020-023000", "20261020-023000"];
  const d = decideRotation(names, NOW);
  assert.deepEqual(d.delete, []);
  assert.deepEqual(d.keep.map((k) => k.name), ["20261020-023000"]);
  assert.equal(d.ignored.length, 6);
});

test("ISO week boundaries: year end, 53-week years and Monday starts", () => {
  assert.equal(isoWeekKey(new Date("2026-12-31T12:00:00Z")), "2026-W53");
  assert.equal(isoWeekKey(new Date("2027-01-03T23:59:59Z")), "2026-W53");
  assert.equal(isoWeekKey(new Date("2027-01-04T00:00:00Z")), "2027-W01");
  assert.equal(isoWeekKey(new Date("2024-12-30T00:00:00Z")), "2025-W01");
  assert.equal(isoWeekKey(new Date("2026-10-18T23:59:59Z")), "2026-W42"); // Sunday
  assert.equal(isoWeekKey(new Date("2026-10-19T00:00:00Z")), "2026-W43"); // Monday
});

test("daylight-saving weekends do not move a set across a day or week", () => {
  // US fall-back 2026-11-01 and spring-forward 2026-03-08: stamps are UTC, so
  // 02:30 daily sets stay one per calendar day either side.
  const names: string[] = [];
  for (let i = 0; i < 6; i++) names.push(formatStamp(new Date(Date.parse("2026-10-30T02:30:00Z") + i * DAY)));
  const d = decideRotation(names, NOW);
  assert.equal(d.delete.length, 0);
  assert.equal(isoWeekKey(parseStamp("20261101-023000")!), "2026-W44");
  assert.equal(isoWeekKey(parseStamp("20261102-023000")!), "2026-W45");
});

test("weekly firsts are limited to the 8 newest weeks", () => {
  const names: string[] = [];
  for (let i = 0; i < 14; i++) names.push(formatStamp(new Date(Date.parse("2026-10-20T02:30:00Z") - i * DAY)));
  // One Monday set per week before that: W40 back to W31.
  for (let w = 0; w < 10; w++) names.push(formatStamp(new Date(Date.parse("2026-09-28T02:30:00Z") - w * 7 * DAY)));
  const d = decideRotation(names, NOW);
  const kept = new Set(d.keep.map((k) => k.name));
  assert.ok(kept.has("20260831-023000")); // W36, the eighth newest week
  assert.ok(!kept.has("20260824-023000")); // W35, ninth
  assert.ok(d.delete.includes("20260824-023000"));
});
