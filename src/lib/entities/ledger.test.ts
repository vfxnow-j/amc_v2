import test from "node:test";
import assert from "node:assert/strict";
import { quantityProblem, MAX_QUANTITY } from "./ledger";

test("quantityProblem accepts whole numbers up to the cap", () => {
  assert.equal(quantityProblem(1), null);
  assert.equal(quantityProblem(MAX_QUANTITY), null);
});
test("quantityProblem refuses zero, negatives, fractions, unsafe and huge values", () => {
  for (const q of [0, -1, 1.5, NaN, Infinity, 2 ** 53, MAX_QUANTITY + 1, "5", null, undefined]) {
    assert.ok(quantityProblem(q), String(q));
  }
});
