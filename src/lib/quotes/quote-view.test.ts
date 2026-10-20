import test from "node:test";
import assert from "node:assert/strict";
import { countsAsView, summariseActivity, VIEW_WINDOW_MS } from "./quote-view";

const now = new Date("2026-10-19T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const later = new Date(now.getTime() + 86_400_000);

test("a link that was never emailed does not count", () => {
  assert.equal(countsAsView({ sentAt: null, expiresAt: later, lastViewedAt: null }, now), false);
});

test("a first open of a sent, live link counts", () => {
  assert.equal(countsAsView({ sentAt: ago(1000), expiresAt: later, lastViewedAt: null }, now), true);
});

test("an expired link does not count", () => {
  assert.equal(countsAsView({ sentAt: ago(1000), expiresAt: ago(1), lastViewedAt: null }, now), false);
});

test("a reload inside the window is the same look; at the window it is a new one", () => {
  const base = { sentAt: ago(1e9), expiresAt: later };
  assert.equal(countsAsView({ ...base, lastViewedAt: ago(VIEW_WINDOW_MS - 1) }, now), false);
  assert.equal(countsAsView({ ...base, lastViewedAt: ago(VIEW_WINDOW_MS) }, now), true);
});

test("activity folds links: newest send, summed views, earliest first, latest last", () => {
  const a = { sentAt: ago(5000), sentTo: "a@x.com", firstViewedAt: ago(4000), lastViewedAt: ago(3000), viewCount: 2 };
  const b = { sentAt: ago(1000), sentTo: "b@x.com", firstViewedAt: ago(500), lastViewedAt: ago(200), viewCount: 1 };
  const never = { sentAt: null, sentTo: null, firstViewedAt: null, lastViewedAt: null, viewCount: 0 };
  const out = summariseActivity([a, never, b]);
  assert.equal(out.linksSent, 2);
  assert.equal(out.lastSentTo, "b@x.com");
  assert.equal(out.views, 3);
  assert.deepEqual(out.firstViewedAt, a.firstViewedAt);
  assert.deepEqual(out.lastViewedAt, b.lastViewedAt);
});

test("no links gives an empty summary", () => {
  const out = summariseActivity([]);
  assert.equal(out.linksSent, 0);
  assert.equal(out.views, 0);
  assert.equal(out.lastSentAt, null);
});
