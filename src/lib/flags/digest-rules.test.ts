import test from "node:test";
import assert from "node:assert/strict";
import { digestLines, digestSubject, type DigestFlag } from "./digest-rules";

const f = (over: Partial<DigestFlag>): DigestFlag => ({
  orderNumber: "R-1", clientName: "Acme", reason: "payment_overdue", severity: "ATTENTION", ...over,
});

test("critical flags come first, then attention, then info; ties keep order number order", () => {
  const lines = digestLines([
    f({ orderNumber: "R-3", severity: "INFO" }),
    f({ orderNumber: "R-2", severity: "CRITICAL", reason: "overdue_return" }),
    f({ orderNumber: "R-1", severity: "ATTENTION" }),
  ]);
  assert.deepEqual(lines, [
    "R-2 · Acme · Overdue return · Critical",
    "R-1 · Acme · Payment overdue · Attention",
    "R-3 · Acme · Payment overdue · Info",
  ]);
});

test("an unknown reason code shows as itself", () => {
  assert.match(digestLines([f({ reason: "custom_thing" })])[0], /custom_thing/);
});

test("subject counts flags and calls out critical ones", () => {
  assert.equal(digestSubject([f({})]), "1 new order flag");
  assert.equal(digestSubject([f({}), f({ severity: "CRITICAL" })]), "2 new order flags, 1 critical");
});
