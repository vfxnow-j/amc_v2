import test from "node:test";
import assert from "node:assert/strict";
import { checkEntityInput, slugPreview } from "./entity-input";

const ok = { name: "Acme Studios", modules: ["INVENTORY"] };
const msg = (r: { ok: boolean; message?: string }) => (r.ok ? "" : r.message);

test("a valid entity passes, blanks become null, slug is derived", () => {
  const r = checkEntityInput({ ...ok, email: "  ", phone: "", notes: " hi " });
  assert.ok(r.ok);
  assert.equal(r.data.slug, "acme-studios");
  assert.equal(r.data.email, null);
  assert.equal(r.data.phone, null);
  assert.equal(r.data.notes, "hi");
});
test("a missing, blank or symbol-only name is refused", () => {
  assert.equal(checkEntityInput({ modules: [] }).ok, false);
  assert.equal(msg(checkEntityInput({ ...ok, name: "   " })), "Give the entity a name.");
  assert.match(msg(checkEntityInput({ ...ok, name: "!!!" }))!, /letters or numbers/);
});
test("a bad email is refused, a good one kept", () => {
  assert.match(msg(checkEntityInput({ ...ok, email: "nope" }))!, /email/);
  assert.equal(checkEntityInput({ ...ok, email: "a@b.co" }).ok, true);
});
test("over-long fields are refused at their limit", () => {
  assert.equal(checkEntityInput({ ...ok, name: "a".repeat(121) }).ok, false);
  assert.equal(checkEntityInput({ ...ok, name: "a".repeat(120) }).ok, true);
  assert.equal(checkEntityInput({ ...ok, contactName: "a".repeat(121) }).ok, false);
  assert.equal(checkEntityInput({ ...ok, phone: "1".repeat(41) }).ok, false);
  assert.equal(checkEntityInput({ ...ok, address: "a".repeat(301) }).ok, false);
  assert.equal(checkEntityInput({ ...ok, notes: "a".repeat(2001) }).ok, false);
});
test("unavailable and unknown modules are dropped; INVENTORY is forced on", () => {
  const r = checkEntityInput({ ...ok, modules: ["OPERATE", "SERVICE_CENTER", "BOGUS"] });
  assert.ok(r.ok);
  assert.deepEqual(r.data.modules, ["INVENTORY"]);
  const none = checkEntityInput({ ...ok, modules: [] });
  assert.ok(none.ok && none.data.modules.join() === "INVENTORY");
});
test("wrong shapes and unknown fields are refused", () => {
  assert.equal(checkEntityInput(null).ok, false);
  assert.equal(checkEntityInput({ ...ok, modules: "INVENTORY" }).ok, false);
  assert.equal(msg(checkEntityInput({ ...ok, slug: "x" })), "Unexpected field: slug.");
});
test("slugPreview", () => {
  assert.equal(slugPreview("Zz Test Co"), "zz-test-co");
  assert.equal(slugPreview("???"), "");
});

test("the zz prefix is reserved so a real entity can never look like a throwaway database", () => {
  const ok = { name: "Acme", modules: [] };
  assert.equal(checkEntityInput({ ...ok, name: "ZZ Check" }).ok, false);
  assert.equal(checkEntityInput({ ...ok, name: "zz" }).ok, false);
  assert.equal(checkEntityInput({ ...ok, name: "Zzyzx Rentals" }).ok, true);
  assert.equal(checkEntityInput({ ...ok, name: "Jazz Zz" }).ok, true);
});
