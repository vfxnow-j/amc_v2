import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessDays,
  CAPACITY_HOLDS_STOCK,
  computeCapacity,
  dayOf,
  type CapacityAsset,
  type CapacityOrder,
  type CapacityUnit,
} from "./capacity";
import { HOLDS_STOCK } from "@/lib/queries/order-builder";

const day = (s: string) => new Date(`${s}T12:00:00Z`);
// A Monday, clear of carrier holidays for the fortnight after it.
const TODAY = day("2026-09-28");

const units = (n: number, status: CapacityUnit["status"] = "AVAILABLE"): CapacityUnit[] =>
  Array.from({ length: n }, () => ({ status, looseCheckout: null, maintenanceReady: null }));

const order = (over: Partial<CapacityOrder>): CapacityOrder => ({
  status: "ACTIVE",
  quantity: 1,
  startDate: day("2026-09-01"),
  endDate: day("2026-09-30"),
  returnDate: null,
  returnMethod: "CUSTOMER_DROPOFF",
  returnTrackingNumber: null,
  reservationType: "RENTAL",
  billingCycleType: "ONE_TIME",
  isRecurring: false,
  termMonths: null,
  flowTermMonths: null,
  ...over,
});

const asset = (over: Partial<CapacityAsset>): CapacityAsset => ({
  assetId: "a1",
  name: "RTX A6000",
  refurbBufferDays: 0,
  units: units(1),
  orders: [],
  ...over,
});

test("business days skip the weekend", () => {
  assert.equal(dayOf(addBusinessDays(day("2026-10-02"), 1)), "2026-10-05"); // Fri → Mon
  assert.equal(dayOf(addBusinessDays(day("2026-10-02"), 0)), "2026-10-02");
});

test("an overdue return stays reserved and is never promised", () => {
  const result = computeCapacity(
    [asset({ units: units(3), orders: [order({ quantity: 2, endDate: day("2026-09-25") })] })],
    TODAY,
  );
  assert.equal(result.pool.reserved, 2);
  assert.equal(result.pool.available_now, 1);
  const wantTwo = computeCapacity(
    [asset({ units: units(3), orders: [order({ quantity: 2, endDate: day("2026-09-25") })] })],
    TODAY,
    { qty: 2 },
  );
  assert.deepEqual(wantTwo.pool.next_available, { date: null, status: "none" });
});

test("a stale approved order that never went out holds nothing", () => {
  const result = computeCapacity(
    [asset({ orders: [order({ status: "APPROVED", endDate: day("2026-09-20") })] })],
    TODAY,
  );
  assert.equal(result.pool.reserved, 0);
  assert.equal(result.pool.available_now, 1);
});

test("return transit and the refurb buffer push the date out", () => {
  // Ends Tue 29th, small package (5) + buffer 2 = 7 business days → Thu 8 Oct.
  const result = computeCapacity(
    [
      asset({
        refurbBufferDays: 2,
        orders: [order({ endDate: day("2026-09-29"), returnMethod: "SMALL_PACKAGE" })],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.available_now, 0);
  assert.deepEqual(result.pool.next_available, { date: "2026-10-08", status: "expected" });
});

test("an unknown return method is planned as ground", () => {
  const result = computeCapacity(
    [asset({ orders: [order({ endDate: day("2026-09-29"), returnMethod: null })] })],
    TODAY,
  );
  assert.equal(result.pool.next_available.date, "2026-10-06");
});

test("confirmed with a scheduled return date or tracking; expected on the end date alone", () => {
  const scheduled = computeCapacity(
    [asset({ orders: [order({ returnDate: day("2026-09-30") })] })],
    TODAY,
  );
  assert.deepEqual(scheduled.pool.next_available, { date: "2026-09-30", status: "confirmed" });

  const tracked = computeCapacity(
    [asset({ orders: [order({ returnTrackingNumber: "1Z999" })] })],
    TODAY,
  );
  assert.equal(tracked.pool.next_available.status, "confirmed");

  const endOnly = computeCapacity([asset({ orders: [order({})] })], TODAY);
  assert.deepEqual(endOnly.pool.next_available, { date: "2026-09-30", status: "expected" });
});

test("nothing coming back is none; something free now is today, confirmed", () => {
  const stuck = computeCapacity([asset({ units: units(1, "MAINTENANCE") })], TODAY);
  assert.deepEqual(stuck.pool.next_available, { date: null, status: "none" });

  const free = computeCapacity([asset({})], TODAY);
  assert.deepEqual(free.pool.next_available, { date: "2026-09-28", status: "confirmed" });
});

test("maintenance units are reserved, and come back on the job's date", () => {
  const result = computeCapacity(
    [
      asset({
        units: [
          ...units(1),
          { status: "MAINTENANCE", looseCheckout: null, maintenanceReady: day("2026-10-01") },
        ],
      }),
    ],
    TODAY,
    { qty: 2 },
  );
  assert.equal(result.pool.total, 2);
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 1);
  assert.deepEqual(result.pool.next_available, { date: "2026-10-01", status: "expected" });
});

test("a loose checkout (no order) is reserved; retired and sold are not fleet", () => {
  const result = computeCapacity(
    [
      asset({
        units: [
          ...units(1),
          { status: "CHECKED_OUT", looseCheckout: { expectedReturn: null }, maintenanceReady: null },
          ...units(1, "RETIRED"),
          ...units(1, "SOLD"),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.total, 2);
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 1);
});

test("quotes sent and holds are tentative", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(4),
        orders: [order({ status: "QUOTE_SENT", quantity: 1, startDate: day("2026-09-28") })],
        holds: [{ quantity: 1, from: day("2026-09-28"), to: day("2026-10-28") }],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.tentative, 2);
  assert.equal(result.pool.reserved, 0);
  assert.equal(result.pool.available_now, 2);
});

test("a pool sums its assets and takes the earliest date", () => {
  const result = computeCapacity(
    [
      asset({ assetId: "a", units: units(2), orders: [order({ quantity: 2, endDate: day("2026-10-02") })] }),
      asset({ assetId: "b", units: units(1), orders: [order({ quantity: 1, endDate: day("2026-09-30") })] }),
    ],
    TODAY,
  );
  assert.equal(result.pool.total, 3);
  assert.equal(result.pool.reserved, 3);
  assert.equal(result.pool.available_now, 0);
  assert.equal(result.pool.next_available.date, "2026-09-30");
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].next_available.date, "2026-10-02");
});

test("demand is high at 80% committed", () => {
  const at = (reserved: number) =>
    computeCapacity([asset({ units: units(5), orders: [order({ quantity: reserved })] })], TODAY).pool
      .demand;
  assert.equal(at(4), "high");
  assert.equal(at(3), "normal");
});

test("a zero-total asset is zero across the board", () => {
  const result = computeCapacity([asset({ units: [] })], TODAY);
  assert.deepEqual(result.pool, {
    total: 0,
    reserved: 0,
    tentative: 0,
    available_now: 0,
    next_available: { date: null, status: "none" },
    demand: "normal",
  });
});

test("a later window ignores what is back before it opens", () => {
  const result = computeCapacity([asset({ orders: [order({ endDate: day("2026-09-30") })] })], TODAY, {
    from: day("2026-10-05"),
    to: day("2026-10-10"),
  });
  assert.equal(result.pool.reserved, 0);
  assert.equal(result.pool.available_now, 1);
});

test("an overbooked pool repays the shortfall before promising", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({ quantity: 1, returnDate: day("2026-09-30") }),
          order({ quantity: 1, returnDate: day("2026-10-01") }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.next_available.date, "2026-10-01");
});

test("units already checked back in are not reserved", () => {
  const result = computeCapacity(
    [asset({ units: units(2), orders: [order({ quantity: 2, checkedInCount: 1, endDate: day("2026-09-20") })] })],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 1);
});

test("a one-time rental is unchanged: endDate is the return, overdue if past", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENTAL",
            billingCycleType: "ONE_TIME",
            isRecurring: false,
            endDate: day("2026-09-25"), // before TODAY: overdue
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.deepEqual(result.pool.next_available, { date: null, status: "none" });
});

test("a recurring rental with no committed term and no scheduled return is never promised", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENTAL",
            billingCycleType: "MONTHLY",
            isRecurring: true,
            termMonths: null,
            startDate: day("2026-01-01"),
            // A billing-period end long past — must NOT read as overdue/stale.
            endDate: day("2026-08-30"),
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 0);
  assert.deepEqual(result.pool.next_available, { date: null, status: "none" });
});

test("a recurring rental with a committed term is promised back at the term's end", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENTAL",
            billingCycleType: "MONTHLY",
            isRecurring: true,
            termMonths: 1,
            startDate: day("2026-09-01"),
            endDate: day("2026-09-30"), // just the first period's end, not the term
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.deepEqual(result.pool.next_available, { date: "2026-10-01", status: "expected" });
});

test("a recurring rental's scheduled return still wins over the committed term", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENTAL",
            billingCycleType: "MONTHLY",
            isRecurring: true,
            termMonths: 6,
            startDate: day("2026-09-01"),
            returnDate: day("2026-09-29"),
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.deepEqual(result.pool.next_available, { date: "2026-09-29", status: "confirmed" });
});

test("rent-to-own gear never returns: reserved, and no candidate", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENT_TO_OWN",
            billingCycleType: "MONTHLY",
            isRecurring: true,
            endDate: day("2026-09-20"), // long past — must not matter either way
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.deepEqual(result.pool.next_available, { date: null, status: "none" });
});

test("a rental converted to RENT_TO_OWN never returns, even with a stale returnDate", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "RENT_TO_OWN",
            returnDate: day("2026-09-29"), // left over from when this was a rental
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.deepEqual(result.pool.next_available, { date: null, status: "none" });
});

test("a SALE order never returns, even with a stale returnDate", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "SALE",
            returnDate: day("2026-09-29"),
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.deepEqual(result.pool.next_available, { date: null, status: "none" });
});

test("a Flow order is promised back at its term end (endDate already is start + flowTermMonths)", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            reservationType: "FLOW",
            billingCycleType: "MONTHLY",
            isRecurring: true,
            flowTermMonths: 6,
            startDate: day("2026-06-01"),
            endDate: day("2026-12-01"), // start + 6 months, as the builder computes it
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.deepEqual(result.pool.next_available, { date: "2026-12-01", status: "expected" });
});

test("a unit swap keeps the order's quantity reserved and promises nothing early", () => {
  // swapReservationItemUnit bumps both checkedOutCount and checkedInCount by 1
  // per swap: a single-unit order swapped once reads out=2, in=1 — not a
  // partial return.
  const result = computeCapacity(
    [
      asset({
        units: units(1),
        orders: [
          order({
            quantity: 1,
            checkedOutCount: 2,
            checkedInCount: 1,
            endDate: day("2026-09-20"), // long past — still fully reserved
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 0);
});

test("a genuine partial return (not a swap) frees the returned unit", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(2),
        orders: [
          order({
            quantity: 2,
            checkedOutCount: 2,
            checkedInCount: 1,
            endDate: day("2026-09-20"),
          }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 1);
  assert.equal(result.pool.available_now, 1);
});

test("CAPACITY_HOLDS_STOCK is pinned to the order builder's HOLDS_STOCK", () => {
  const builderStatuses = (HOLDS_STOCK.status as { in: string[] }).in;
  assert.deepEqual([...CAPACITY_HOLDS_STOCK].sort(), [...builderStatuses].sort());
});

test("an order promising more than the fleet is capped at the fleet", () => {
  const result = computeCapacity(
    [
      asset({
        units: units(2),
        orders: [
          order({ quantity: 3, endDate: day("2026-09-20") }),
          order({ status: "QUOTE_SENT", quantity: 1, startDate: day("2026-09-28") }),
        ],
      }),
    ],
    TODAY,
  );
  assert.equal(result.pool.reserved, 2);
  assert.equal(result.pool.tentative, 0);
  assert.equal(result.pool.available_now, 0);
  assert.equal(result.pool.demand, "high");
});
