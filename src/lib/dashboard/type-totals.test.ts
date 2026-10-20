import assert from "node:assert/strict";
import { test } from "node:test";
import { totalLine, typeLine } from "./type-totals";

test("potential is earned plus weighted quoted", () => {
  assert.deepEqual(typeLine({ earned: 1000, quoted: 250.5 }), {
    earned: 1000,
    quoted: 250.5,
    potential: 1250.5,
  });
});

test("a missing row is zero, not NaN", () => {
  assert.deepEqual(typeLine(undefined), { earned: 0, quoted: 0, potential: 0 });
  assert.deepEqual(typeLine({ earned: NaN, quoted: 5 }), { earned: 0, quoted: 5, potential: 5 });
});

test("total equals the sum of the rounded rows to the cent", () => {
  const rows = [
    { earned: 0.1, quoted: 0.2 },
    { earned: 0.2, quoted: 0.004 },
    { earned: 10.005, quoted: 1 / 3 },
    undefined,
  ];
  const lines = rows.map(typeLine);
  const total = totalLine(rows);
  const c = (n: number) => Math.round(n * 100);
  assert.equal(c(total.earned), lines.reduce((s, l) => s + c(l.earned), 0));
  assert.equal(c(total.quoted), lines.reduce((s, l) => s + c(l.quoted), 0));
  assert.equal(c(total.potential), lines.reduce((s, l) => s + c(l.potential), 0));
  assert.equal(c(total.potential), c(total.earned) + c(total.quoted));
});

test("an empty period totals zero", () => {
  assert.deepEqual(totalLine([]), { earned: 0, quoted: 0, potential: 0 });
});
