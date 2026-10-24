import test from "node:test";
import assert from "node:assert/strict";
import { criticalFlagBlock } from "./flag-gate";

test("an open critical flag blocks shipping with a reason", () => {
  assert.match(criticalFlagBlock(1) ?? "", /critical flag/i);
  assert.equal(criticalFlagBlock(0), null);
});

test("the message counts plural flags", () => {
  assert.match(criticalFlagBlock(2) ?? "", /2 critical flags open/);
});
