import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLifecycle, type LifecycleInput } from "./sale-lifecycle";

const base: LifecycleInput = {
  cost: 6000,
  purchaseDate: new Date("2024-01-10T00:00:00Z"),
  receivedDate: new Date("2024-01-15T00:00:00Z"),
  soldAt: new Date("2026-01-20T12:00:00Z"),
  soldPrice: 3000,
  saleFees: 400,
  rentalRevenue: 5000,
  depreciationMethod: "STRAIGHT_LINE",
  usefulLifeMonths: 60,
  salvageValue: 0,
  checkouts: [
    {
      checkoutDate: new Date("2024-02-01T00:00:00Z"),
      actualReturn: new Date("2024-03-02T00:00:00Z"),
      reservationId: "r1",
      reservationNumber: "RES-1",
      clientName: "Acme",
    },
  ],
};

test("net, book value and total return over the unit life", () => {
  const r = buildLifecycle(base);
  assert.equal(r.net, 2600);
  assert.equal(r.monthsOwned, 24);
  assert.equal(r.bookValueAtSale, 3600);
  assert.equal(r.gainVsBook, -1000);
  assert.equal(r.totalReturn, 1600); // 5000 + 2600 - 6000
  assert.equal(r.returnPct, 26.67);
  assert.equal(r.rentals, 1);
  assert.equal(r.daysOnRent, 30);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.timeline.map((e) => e.kind), ["ACQUIRED", "OUT", "SOLD"]);
});

test("an import-stamp purchase date leaves age and book value unknown", () => {
  const r = buildLifecycle({
    ...base,
    receivedDate: null,
    purchaseDate: new Date("2026-02-07T00:00:00Z"),
    soldAt: new Date("2026-05-01T12:00:00Z"),
  });
  assert.equal(r.acquiredUnknown, true);
  assert.equal(r.monthsOwned, null);
  assert.equal(r.bookValueAtSale, null);
  assert.equal(r.totalReturn, 1600);
});

test("missing fees count as zero but are flagged", () => {
  const r = buildLifecycle({ ...base, saleFees: null });
  assert.equal(r.net, 3000);
  assert.ok(r.flags.some((f) => f.startsWith("Fees not recorded")));
});

test("an open checkout at sale is clipped to the sale date", () => {
  const r = buildLifecycle({
    ...base,
    checkouts: [
      {
        checkoutDate: new Date("2026-01-10T12:00:00Z"),
        actualReturn: null,
        reservationId: null,
        reservationNumber: null,
        clientName: null,
      },
    ],
  });
  assert.equal(r.daysOnRent, 10);
});

test("no price or cost leaves return figures empty", () => {
  const r = buildLifecycle({ ...base, soldPrice: null, cost: null });
  assert.equal(r.net, null);
  assert.equal(r.totalReturn, null);
  assert.equal(r.bookValueAtSale, null);
});

test("a method with no schedule gives no book value rather than the price", () => {
  const r = buildLifecycle({ ...base, depreciationMethod: "SUM_OF_YEARS" });
  assert.equal(r.bookValueAtSale, null);
  assert.equal(r.gainVsBook, null);
});
