import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanReason,
  consumeScanOverride,
  grantScanOverride,
  hasScanOverride,
  historyNote,
  shortfallLines,
  shortfallText,
  verifySuperAdmin,
  type OverrideUser,
} from "./scan-override";

const base: OverrideUser = {
  id: "u1",
  name: "Sam Root",
  email: "sam@example.com",
  role: "SUPER_ADMIN",
  passwordHash: "hash-ok",
  disabledAt: null,
};

function deps(user: OverrideUser | null) {
  const compared: string[] = [];
  return {
    compared,
    deps: {
      findUserByEmail: async () => user,
      compare: async (password: string, hash: string) => {
        compared.push(hash);
        return hash === "hash-ok" && password === "right";
      },
    },
  };
}

test("a live super admin with the right password passes", async () => {
  const { deps: d } = deps(base);
  const out = await verifySuperAdmin(d, "Sam@Example.com", "right");
  assert.deepEqual(out, { ok: true, admin: { id: "u1", name: "Sam Root", email: "sam@example.com" } });
});

test("every failure is the same outcome", async () => {
  const cases: [OverrideUser | null, string, string][] = [
    [base, "sam@example.com", "wrong"],
    [null, "nobody@example.com", "right"],
    [{ ...base, role: "ADMIN" }, "sam@example.com", "right"],
    [{ ...base, disabledAt: new Date() }, "sam@example.com", "right"],
    [{ ...base, passwordHash: null }, "sam@example.com", "right"],
    [base, "sam@example.com", ""],
    [base, "", "right"],
  ];
  for (const [user, email, password] of cases) {
    const { deps: d } = deps(user);
    assert.deepEqual(await verifySuperAdmin(d, email, password), { ok: false });
  }
});

test("a compare runs even when the user is unusable", async () => {
  const { deps: d, compared } = deps({ ...base, role: "STAFF" });
  await verifySuperAdmin(d, "sam@example.com", "right");
  assert.equal(compared.length, 1);
  assert.notEqual(compared[0], "hash-ok");
});

test("reason must be real", () => {
  assert.equal(cleanReason("  "), null);
  assert.equal(cleanReason("ok"), null);
  assert.equal(cleanReason("  Kit left   with courier "), "Kit left with courier");
});

const missing = [
  { itemId: "a", label: "Mac Studio", parentLabel: null, ordered: 3, out: 1, missing: 2 },
  { itemId: "b", label: "RTX 4090", parentLabel: "Edit Bay", ordered: 1, out: 0, missing: 1 },
];

test("shortfall names exactly what was not scanned", () => {
  const lines = shortfallLines(missing);
  assert.deepEqual(lines[1], { item: "RTX 4090", inside: "Edit Bay", ordered: 1, scannedOut: 0, notScanned: 1 });
  assert.equal(shortfallText(lines), "2 x Mac Studio, 1 x RTX 4090 (in Edit Bay)");
  assert.equal(shortfallText([]), "nothing was outstanding");
});

test("history note is labelled and complete", () => {
  const note = historyNote({
    move: "ship",
    actor: "Pat",
    admin: "Sam Root",
    reason: "Courier took it",
    lines: shortfallLines(missing),
  });
  assert.match(note, /^SCAN OVERRIDE: shipped without scanning/);
  assert.match(note, /Authorised by super admin Sam Root, entered by Pat/);
  assert.match(note, /Reason: Courier took it/);
  assert.match(note, /3 units/);
  const self = historyNote({ move: "activate", actor: "Sam", admin: "Sam", reason: "x".repeat(5), lines: [] });
  assert.doesNotMatch(self, /entered by/);
});

test("a grant is for one order, one move, once, briefly", () => {
  const t = 1_000_000;
  grantScanOverride("o1", "ship", t);
  assert.equal(hasScanOverride("o2", "ship", t), false);
  assert.equal(hasScanOverride("o1", "activate", t), false);
  assert.equal(consumeScanOverride("o1", "ship", t + 1), true);
  assert.equal(consumeScanOverride("o1", "ship", t + 2), false);
  grantScanOverride("o3", "activate", t);
  assert.equal(consumeScanOverride("o3", "activate", t + 61_000), false);
});
