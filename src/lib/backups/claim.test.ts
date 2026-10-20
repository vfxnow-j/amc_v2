import assert from "node:assert/strict";
import { test } from "node:test";
import { claimAlerts, type AlertStore } from "./claim";

const NOW = new Date("2026-10-20T12:00:00Z");
const P = [{ key: "backup:failed", text: "x" }];

function fakeStore(failWrite = false): AlertStore & { value: Record<string, string>; version: number } {
  const s = {
    value: {} as Record<string, string>,
    version: 0,
    async read() { return { sent: { ...s.value }, version: String(s.version) }; },
    async swap(version: string | null, next: Record<string, string>) {
      if (failWrite) throw new Error("db down");
      if (version !== String(s.version)) return false;
      s.value = next; s.version += 1; return true;
    },
  };
  return s;
}

test("the first caller owns the alert, the second gets nothing", async () => {
  const store = fakeStore();
  assert.equal((await claimAlerts(store, P, NOW)).length, 1);
  assert.equal((await claimAlerts(store, P, NOW)).length, 0);
});

test("two overlapping callers: only one wins the swap", async () => {
  const store = fakeStore();
  const [a, b] = await Promise.all([claimAlerts(store, P, NOW), claimAlerts(store, P, NOW)]);
  assert.equal(a.length + b.length, 1);
});

test("a failed write sends nothing", async () => {
  assert.equal((await claimAlerts(fakeStore(true), P, NOW)).length, 0);
});

test("nothing due and nothing to forget writes nothing", async () => {
  const store = fakeStore();
  assert.equal((await claimAlerts(store, [], NOW)).length, 0);
  assert.equal(store.version, 0);
});

test("alerts again after 24h", async () => {
  const store = fakeStore();
  await claimAlerts(store, P, NOW);
  assert.equal((await claimAlerts(store, P, new Date(NOW.getTime() + 25 * 3_600_000))).length, 1);
});
