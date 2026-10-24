import test from "node:test";
import assert from "node:assert/strict";
import { checkMatch, checkUnit, normalizeSerial } from "./completeness";

test("a unit with both values is complete", () => {
  assert.deepEqual(
    checkUnit({ barcode: "AMC-1", serialNumber: "C02XYZ", requiresSerial: true }),
    { complete: true },
  );
});

test("a missing serial is a gap only when the item requires one", () => {
  assert.deepEqual(
    checkUnit({ barcode: "AMC-1", serialNumber: null, requiresSerial: true }),
    { complete: false, gap: "MISSING_SERIAL" },
  );
  assert.deepEqual(
    checkUnit({ barcode: "CBL-1", serialNumber: null, requiresSerial: false }),
    { complete: true },
  );
});

test("a blank serial counts as missing", () => {
  assert.equal(
    checkUnit({ barcode: "AMC-1", serialNumber: "   ", requiresSerial: true }).complete,
    false,
  );
});

test("a missing barcode is a gap even for exempt items", () => {
  assert.deepEqual(
    checkUnit({ barcode: "", serialNumber: "S1", requiresSerial: false }),
    { complete: false, gap: "MISSING_BARCODE" },
  );
});

test("serials normalise to one form", () => {
  assert.equal(normalizeSerial("  c02 xyz\t1 "), "C02 XYZ 1");
});

test("checkMatch compares normalised, and says unknown with nothing to compare", () => {
  assert.equal(checkMatch("C02XYZ", " c02xyz "), "match");
  assert.equal(checkMatch("C02XYZ", "ZZZ"), "mismatch");
  assert.equal(checkMatch(null, "ZZZ"), "unknown");
});
