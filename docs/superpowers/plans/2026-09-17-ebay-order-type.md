# eBay order type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `EBAY` order type for hardware sold on eBay, make shipping mark units `SOLD` for sale-type orders (fixing a path that has never run), and add a per-item return flow.

**Architecture:** A fifth `ReservationType` with six new nullable columns; the existing `completeSale` action wired to the ship step behind a confirmation; a new `returnSale` action beside it; an RTO ownership transfer driven by paid invoices rather than a dead counter.

**Tech Stack:** Next.js 16.2.12 (App Router, Server Components, server actions), Prisma 7.9 with the pg adapter, TypeScript, Vitest.

**Spec:** `docs/ebay-orders.md` — read it before Task 1. This plan implements it; the spec carries the reasoning.

## Global Constraints

- **Read the guide first.** `AGENTS.md`: this is not the Next.js you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- **There is no `prisma/migrations/`.** Schema changes are `prisma db push` + `prisma generate`.
- **`prisma db push` must be run by a human.** Prisma 7 refuses it when it detects an agent invoked it (documented in `scripts/refresh-from-v1.sh`). Task 1 stops and asks.
- **Restart the dev server after `prisma generate`.** The Prisma client is pinned to `globalThis`; a new column never loads into a running process.
- **A `"use server"` file may export only async functions.** Putting a const table in one typechecks, lints and runs in dev, then fails the production build. Constants go in a plain module.
- **`EBAY` must never reach HubSpot.** There is no eBay pipeline. Integrations are blank in v2, so this is a guard, not configuration.
- **v1 will never emit `EBAY`.** `lib/v1-sync/engine.ts` is safe as-is; do not add a mapping.
- **The six new columns are v2-only.** Confirm the v1 sync keeps them (Task 7).
- **Commit after each task. Do not push.**

---

### Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `ReservationType.EBAY`
- Produces: `Reservation.externalRef`, `.buyerName`, `.payoutAmount`, `.payoutEstimated`, `.refundedAmount`, `.refundedAt`
- Produces: `ReservationItemUnit.returnedAt`, `.returnCondition`

- [ ] **Step 1: Add the enum value**

In `prisma/schema.prisma:900`, change `ReservationType` to:
```prisma
enum ReservationType {
  RENTAL
  SALE
  RENT_TO_OWN
  CLOUD
  /// Sold on eBay rather than to a client: no quote, no approval, no invoice.
  /// See docs/ebay-orders.md.
  EBAY
}
```

- [ ] **Step 2: Add the `Reservation` columns**

In the `Reservation` model, after `convertedFromNumber` (around `schema.prisma:1034`):
```prisma
  // Marketplace sales (eBay today). Named for what they are rather than for
  // one vendor: the next marketplace wants the same fields, and a column named
  // after eBay gets a second column bolted beside it. See docs/ebay-orders.md.
  /// The seller's own reference — an eBay sale number. Deliberately not unique:
  /// it is typed by hand and a typo must not block saving the order.
  externalRef     String?
  /// Who bought it. Not a Client: marketplace buyers are one-off, and an
  /// account row per buyer would bury the real client list.
  buyerName       String?
  /// What the marketplace actually pays us, after its fees. Margin reads
  /// against this, not against the gross.
  payoutAmount    Decimal?  @db.Decimal(12, 2)
  /// False once the settled figure has been typed in from the marketplace.
  payoutEstimated Boolean   @default(true)

  // Returns, on any sale-type order.
  /// What left our side on a return — not what the buyer received. The
  /// marketplace's treatment of its own fee is not knowable from here.
  refundedAmount  Decimal?  @db.Decimal(12, 2)
  refundedAt      DateTime?
```

- [ ] **Step 3: Add the `ReservationItemUnit` columns**

In the `ReservationItemUnit` model (`schema.prisma:1161`), after `checkoutId`:
```prisma
  /// A sale coming back. Deliberately NOT checkedInAt: on a rental that means
  /// "the hire ended and the kit came back" and is read by the due-back and
  /// movement queries, so overloading it would fold returned sales into rental
  /// check-in figures.
  returnedAt      DateTime?
  returnCondition ReturnCondition?
```

- [ ] **Step 4: Ask the user to push the schema**

**Stop here.** Prisma 7 refuses `db push` when an agent invokes it, and the refusal lands after work has begun. Ask the user to run, in their own terminal:

```bash
npx prisma db push && npx prisma generate
```

Then ask them to **restart the dev server**, because the Prisma client is pinned to `globalThis` and the new columns will not otherwise load.

- [ ] **Step 5: Verify the columns landed**

Run:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "\d reservations" | grep -E "externalRef|buyerName|payout|refunded"
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "SELECT unnest(enum_range(NULL::\"ReservationType\"));"
```
Expected: six columns listed, and the enum printing five values ending `EBAY`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat(orders): EBAY order type, marketplace and return columns

Six nullable columns on Reservation and two on ReservationItemUnit.
returnedAt is deliberately separate from checkedInAt: that column means
'the hire ended' on a rental and is read by the due-back queries.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Vocabulary — make the build pass

**Files:**
- Modify: `src/lib/reservations/status.ts:23`
- Modify: `src/lib/orders/types.ts:24,38,52,61`
- Modify: `src/lib/types.ts:28,280,286`
- Modify: `src/lib/analytics/earned-revenue.ts:19,100,149`
- Modify: `src/components/reservations/order-builder.tsx:67,75`
- Modify: `src/components/orders/order-actions.tsx:846`
- Modify: `src/lib/numbering/format.ts:20,47,61`
- Modify: `src/lib/numbering/next.ts:122`

**Interfaces:**
- Consumes: `ReservationType.EBAY` from Task 1.
- Produces: the url slug `"ebay"`, the label `"eBay"`, and numbering kind `"ebay"`.

The exhaustive `Record<ReservationType, …>` maps will not compile until this is done. That is the point of them. Work by running the typechecker and fixing what it names.

- [ ] **Step 1: Run the typechecker to get the list**

Run: `npx tsc --noEmit`
Expected: FAIL. Errors naming each exhaustive Record missing the `EBAY` key. Keep this list — it is your worklist for this task.

- [ ] **Step 2: Add the label and the copy**

`src/lib/reservations/status.ts:23` — add to `TYPE_LABEL`:
```ts
  EBAY: "eBay",
```
Lowercase `e`, capital `B`: it is a brand name and "Ebay" reads as a typo everywhere it appears.

`src/lib/types.ts` — add to the hand-written union at `:28`:
```ts
  | 'EBAY'
```
and to both Records:
```ts
// reservationTypeLabels
EBAY: 'eBay',
// reservationTypeDescriptions
EBAY: 'Sold on eBay — no quote, no invoice; shipping marks the items sold.',
```

- [ ] **Step 3: Add the filter slug and ordering**

`src/lib/orders/types.ts` — add `"ebay"` to `TYPE_FILTERS` (`:24`), map it in `FILTER_TYPE` (`:38`), label it in `TYPE_FILTER_LABEL` (`:52`) as `"eBay"`, and append `"EBAY"` to `ORDER_TYPES` (`:61`).

`ORDER_TYPES` drives both the new-order picker and the revenue cards, so the position you choose is the position it appears in both. Put it last — it is the least-used type.

- [ ] **Step 4: Add it to earned revenue**

`src/lib/analytics/earned-revenue.ts` — add `'EBAY'` to `ReservationTypeKey` (`:19`) and an `EBAY: 0` initialiser to the byType records at `:100` and `:149`.

- [ ] **Step 5: Add the builder copy**

`src/components/reservations/order-builder.tsx` — add to `DATE_LABELS` (`:67`):
```ts
  EBAY: { legend: "Sale date", start: "Sold on", end: null },
```
`end: null` hides the end-date input and sets `end = start`, exactly as `SALE` does.

Add to `TYPE_NOTE` (`:75`):
```ts
  EBAY: "eBay has already taken the buyer's money, so no quote, approval or invoice is raised. Shipping marks the items sold.",
```

- [ ] **Step 6: Add the billing cycles**

`src/components/orders/order-actions.tsx:846` — add to `CYCLES_FOR`:
```ts
  EBAY: ["ONE_TIME"],
```
And mirror it server-side in `src/lib/actions/order-stage.ts:516`, with a refusal message matching the neighbouring ones.

- [ ] **Step 7: Add the numbering kind — this one is silent**

`src/lib/numbering/next.ts:122`, `kindForOrderType`, currently falls through to `rental`. Without a case here eBay orders are stamped `RES-` numbers and nothing errors.

```ts
  if (type === "EBAY") return "ebay";
```

`src/lib/numbering/format.ts` — add `"ebay"` to `NUMBER_KINDS` (`:20`), `NUMBER_KIND_LABEL` (`:47`) as `"eBay orders"`, and `DEFAULT_NUMBERING` (`:61`):
```ts
  ebay: "EBAY-{YYYY}-{SEQ}",
```

Check `src/lib/numbering/next.ts:50` (`existing()`) — the four order kinds read `Reservation.reservationNumber`. Add `ebay` to that group so its sequence does not collide.

- [ ] **Step 8: Typecheck until clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Write the numbering test**

Create `src/lib/numbering/kind.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { kindForOrderType } from "./next";

describe("kindForOrderType", () => {
  it("gives eBay its own number kind rather than falling through to rental", () => {
    expect(kindForOrderType("EBAY")).toBe("ebay");
  });

  it("still maps the original four", () => {
    expect(kindForOrderType("SALE")).toBe("sale");
    expect(kindForOrderType("RENT_TO_OWN")).toBe("rentToOwn");
    expect(kindForOrderType("CLOUD")).toBe("cloud");
    expect(kindForOrderType("RENTAL")).toBe("rental");
  });
});
```

If Vitest is not installed (the dashboard plan installs it), install it first:
```bash
npm install --save-dev vitest@^3.2.4
```
and add `"test": "vitest run"` to `package.json` scripts plus the `vitest.config.ts` shown in `docs/superpowers/plans/2026-09-17-dashboard-out-by-category.md` Task 1 Step 2.

If `kindForOrderType` is not exported, export it.

- [ ] **Step 10: Run the test**

Run: `npm test -- kind`
Expected: PASS, 2 tests.

- [ ] **Step 11: Commit**

```bash
git add -A src package.json
git commit -m "feat(orders): eBay vocabulary, filters and numbering

The exhaustive Record<ReservationType, ...> maps refused to compile until
EBAY was added, which is the good kind of breakage. kindForOrderType is the
one that would not have: without a case it silently stamps eBay orders with
RES- numbers, so it gets a test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The silent branches

**Files:**
- Modify: `src/lib/orders/recurring.ts:21`
- Modify: `src/lib/orders/lifecycle.ts:154-166`
- Modify: `src/lib/actions/reservations.ts:590,674`
- Modify: `src/lib/queries/operate.ts:156,168`
- Modify: `src/lib/integrations/hubspot.ts:26,174`
- Modify: `src/components/leads/lead-resolve.tsx:26`
- Modify: `src/lib/actions/leads.ts:423,510`
- Modify: `src/lib/format.ts:67-69`
- Modify: `src/lib/email/templates.ts:152`
- Modify: `src/lib/actions/documents.ts:419`
- Create: `src/lib/orders/ebay.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `export const SALE_TYPES: ReservationType[] = ["SALE", "EBAY"]` in `src/lib/orders/types.ts`

None of these produce a compile error. Each must be changed deliberately.

- [ ] **Step 1: Add the shared "is a sale" list**

In `src/lib/orders/types.ts`, add:
```ts
/**
 * Order types where the hardware changes hands and does not come back.
 *
 * One list, because "is this a sale" is asked by the ship step, the return
 * flow, the calendar and the billing rules — and they have to agree. RENT_TO_OWN
 * is NOT here: it sells at the end of its term, not on ship, so it is a sale
 * eventually but never a sale on shipping day.
 */
export const SALE_TYPES: ReservationType[] = ["SALE", "EBAY"];
```

- [ ] **Step 2: Make eBay never recur**

`src/lib/orders/recurring.ts:21` — `recurringFor` returns false for `SALE`; extend that to `SALE_TYPES.includes(type)`.

- [ ] **Step 3: Relabel the closing move**

`src/lib/orders/lifecycle.ts:154-166` — `movesFor` relabels "Complete order" to "Close order" for `SALE`. Use `SALE_TYPES.includes(type)`.

- [ ] **Step 4: Force the cycle and collapse the dates**

`src/lib/actions/reservations.ts:590` (end-date collapse) and `:674` (`ONE_TIME`, `nextBillingDate: null`) — both currently test `=== 'SALE'`. Use `SALE_TYPES.includes(...)`.

At `:674`, also set `notBilled: true` when the type is `EBAY` only — a normal SALE still raises an invoice, eBay never does.

- [ ] **Step 5: Keep eBay off the calendar's movement rows**

`src/lib/queries/operate.ts:156,168` — SALE is excluded from movements and only RENTAL shows returns. Extend the SALE exclusion to `SALE_TYPES`.

- [ ] **Step 6: Guard HubSpot**

`src/lib/integrations/hubspot.ts:26` is a pipeline id per type and `:174` is a label map. There is no eBay pipeline. Add `EBAY` to both, with the pipeline id `null`, and make the sync skip an order whose pipeline id is null rather than sending it to a missing pipeline.

Add a comment stating that this is a deliberate guard and not a missing configuration.

- [ ] **Step 7: Keep eBay out of the lead conversion**

`src/components/leads/lead-resolve.tsx:26` is a second hardcoded type picker and `src/lib/actions/leads.ts:423,510` is the conversion. A lead does not become an eBay sale. Leave the picker's four options alone and add a comment at `lead-resolve.tsx:26` saying `EBAY` is excluded on purpose, so the next person does not "fix" the omission.

- [ ] **Step 8: Wording**

`src/lib/format.ts:67-69` (`windowLabel`), `src/lib/email/templates.ts:152` (`orderDates`), `src/lib/actions/documents.ts:419` — each special-cases `SALE` for a one-day window. Extend to `SALE_TYPES`.

- [ ] **Step 9: Write the tests**

Create `src/lib/orders/ebay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SALE_TYPES } from "./types";
import { recurringFor } from "./recurring";

describe("SALE_TYPES", () => {
  it("covers the types where hardware changes hands on shipping", () => {
    expect(SALE_TYPES).toEqual(["SALE", "EBAY"]);
  });

  it("excludes rent-to-own, which sells at the end of its term", () => {
    expect(SALE_TYPES).not.toContain("RENT_TO_OWN");
  });
});

describe("recurringFor", () => {
  it("never makes an eBay order recur", () => {
    expect(recurringFor("EBAY", "ONE_TIME")).toBe(false);
    expect(recurringFor("EBAY", "MONTHLY")).toBe(false);
  });
});
```

Check `recurringFor`'s real signature before writing this and match it.

- [ ] **Step 10: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src
git commit -m "feat(orders): handle EBAY in the branches that fail silently

None of these produce a compile error, so each is deliberate: recurrence,
the closing move's label, the ONE_TIME cycle and date collapse, the
calendar's movement rows, the one-day window wording.

EBAY is guarded out of HubSpot (no pipeline exists) and out of lead
conversion (a lead does not become an eBay sale), both with comments so the
omissions are not later 'fixed'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The order builder

**Files:**
- Modify: `src/components/reservations/order-builder.tsx`
- Modify: `src/lib/actions/order-builder.ts:108-175`
- Modify: `src/lib/settings/business.ts` (the `ebay_fee_rate` setting)
- Modify: `src/components/settings/business-billing-form.tsx`
- Create: `src/lib/orders/payout.ts`
- Create: `src/lib/orders/payout.test.ts`

**Interfaces:**
- Consumes: `SALE_TYPES` from Task 3.
- Produces: `export function estimatePayout(total: number, feePercent: number): number` in `src/lib/orders/payout.ts`
- Produces: `createOrder` accepting `externalRef?: string` and `buyerName?: string`.

- [ ] **Step 1: Write the payout test**

Create `src/lib/orders/payout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { estimatePayout } from "./payout";

describe("estimatePayout", () => {
  it("takes the fee percentage off the gross", () => {
    expect(estimatePayout(1000, 13)).toBe(870);
  });

  it("rounds to whole cents", () => {
    expect(estimatePayout(99.99, 13)).toBe(86.99);
  });

  it("returns the gross when the fee is zero", () => {
    expect(estimatePayout(500, 0)).toBe(500);
  });

  it("never returns a negative payout", () => {
    expect(estimatePayout(100, 150)).toBe(0);
  });

  it("treats the rate as a percentage, not a fraction", () => {
    expect(estimatePayout(100, 0.13)).toBe(99.87);
  });
});
```

That last case is the trap the spec calls out: the setting stores `13`, not `0.13`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- payout`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/orders/payout.ts`:
```ts
/**
 * What a marketplace actually pays us, after its cut.
 *
 * `feePercent` is a percentage — 13, not 0.13. The setting stores it that way
 * because that is how eBay quotes it, and a fraction typed into a field
 * labelled "%" is the likelier mistake.
 *
 * Pure, so the arithmetic is testable without a database or a Decimal.
 */
export function estimatePayout(total: number, feePercent: number): number {
  const kept = 1 - feePercent / 100;
  if (kept <= 0) return 0;
  return Math.round(total * kept * 100) / 100;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- payout`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the fee setting**

Add `ebay_fee_rate` to `src/lib/settings/business.ts` with a default of `13`, following the shape of the settings already there. Surface it in `src/components/settings/business-billing-form.tsx` as a percentage input labelled "eBay fee rate", with the helper text: *"Used to estimate the payout on a new eBay order. Type the settled figure on the order itself once eBay reports it."*

- [ ] **Step 6: Add the builder fields**

In `src/components/reservations/order-builder.tsx`, when the selected type is `EBAY`, show two inputs above the dates:

- **eBay sale number** → `externalRef`, optional, free text.
- **Buyer name** → `buyerName`, optional, free text.

Both optional: an order must be recordable before the sale number has been copied across, and forcing a value produces placeholder text nobody corrects. Follow the existing "Project" field's markup for both.

- [ ] **Step 7: Accept them in the action**

In `src/lib/actions/order-builder.ts`, extend `createOrder`/`createOrderAndOpen` input with `externalRef?: string` and `buyerName?: string`, trim them, and pass through to `createReservation`. Store `undefined` rather than `""` so an untouched field stays null.

In `createReservation` (`src/lib/actions/reservations.ts:568`), when the type is `EBAY`, compute and store:
```ts
payoutAmount: estimatePayout(Number(total), feePercent),
payoutEstimated: true,
```
reading `feePercent` from the `ebay_fee_rate` setting.

- [ ] **Step 8: Create the eBay house account**

Create `prisma/manual/2026-09-17-ebay-account.sql`:
```sql
-- The house account every eBay order hangs off.
--
-- Reservation.clientId is not nullable and a marketplace buyer is not a client,
-- so eBay orders belong to one account named for the channel. The buyer's own
-- name lives on the order in buyerName. See docs/ebay-orders.md.
--
-- Idempotent: does nothing if an account called 'eBay' already exists. The
-- owner (the person who runs eBay sales) is set through the UI afterwards.

INSERT INTO clients (id, name, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'eBay', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name = 'eBay');
```

Before running it, check the real `clients` table for `NOT NULL` columns without defaults and add them:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "\d clients"
```
Do not guess the column list — read it.

Apply:
```bash
docker exec -i vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 < prisma/manual/2026-09-17-ebay-account.sql
```
Expected: `INSERT 0 1`. Run it twice; the second reports `INSERT 0 0`.

- [ ] **Step 9: Create an eBay order by hand**

In the app: `/dashboard/orders/new`, choose **eBay**, pick the eBay account, type a sale number and a buyer name, add one line with a real price, save.

Expected:
- the order number starts `EBAY-`, not `RES-`
- no end-date input was shown
- the order screen shows the sale number and buyer name
- `payoutAmount` is about 87% of the total and is labelled an estimate

Verify in the database:
```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "SELECT \"reservationNumber\", \"externalRef\", \"buyerName\", total, \"payoutAmount\", \"payoutEstimated\", \"notBilled\", \"billingCycleType\" FROM reservations WHERE \"reservationType\" = 'EBAY';"
```
Expected: `notBilled` true, `billingCycleType` `ONE_TIME`.

- [ ] **Step 10: Commit**

```bash
git add -A src prisma/manual docs
git commit -m "feat(orders): create eBay orders with sale number, buyer and payout

estimatePayout is pure and tested, including the case the spec warns about:
the setting stores 13, not 0.13, and a fraction typed into a percent field
would otherwise silently pay out 99.87% of gross.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Shipping marks it sold

**Files:**
- Modify: `src/lib/actions/sales.ts:193,258-266,487,731,835,941,1026`
- Modify: `src/components/orders/order-actions.tsx`
- Create: `src/lib/actions/sales.sold.test.ts`

**Interfaces:**
- Consumes: `SALE_TYPES` from Task 3.
- Produces: `completeSale` accepting `SALE` and `EBAY`.

`completeSale` has **never run**. It is about to be wired to a button that permanently marks hardware sold, so it is tested first.

- [ ] **Step 1: Widen the type guards**

In `src/lib/actions/sales.ts`, the six `reservationType !== 'SALE'` guards at `:193, 487, 731, 835, 941, 1026` become `!SALE_TYPES.includes(reservationType)`.

- [ ] **Step 2: Fix the sold note**

`sales.ts:264` hardcodes:
```ts
soldNotes: `Sold via ${reservation.reservationNumber} to client`,
```
On an eBay order that is wrong twice. Replace with:
```ts
soldNotes: `Sold via ${reservation.reservationNumber} to ${
  reservation.buyerName ?? reservation.client.name
}`,
```
Confirm `buyerName` and `client.name` are both in the query's `select` before using them — add them if not.

- [ ] **Step 3: Write the test**

Create `src/lib/actions/sales.sold.test.ts`. This test touches the database, so it creates its own fixtures and removes them.

```ts
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeSale } from "./sales";

const made: { reservations: string[]; assets: string[]; clients: string[] } = {
  reservations: [],
  assets: [],
  clients: [],
};

afterEach(async () => {
  await prisma.reservation.deleteMany({ where: { id: { in: made.reservations } } });
  await prisma.assetUnit.deleteMany({ where: { assetId: { in: made.assets } } });
  await prisma.asset.deleteMany({ where: { id: { in: made.assets } } });
  await prisma.client.deleteMany({ where: { id: { in: made.clients } } });
  made.reservations = [];
  made.assets = [];
  made.clients = [];
});

describe("completeSale", () => {
  it("marks an eBay order's units SOLD with the buyer's name and a link back", async () => {
    // Build: one client, one asset with one AVAILABLE unit, one EBAY order
    // with a single line at a known price, status SHIPPED.
    // (Fill in using the fixture helpers this repo grows in Step 4.)
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });

    await completeSale(reservationId);

    const unit = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe("SOLD");
    expect(unit.soldViaReservation).toBe(reservationId);
    expect(Number(unit.soldPrice)).toBe(250);
    expect(unit.soldAt).toBeInstanceOf(Date);
    expect(unit.soldNotes).toContain("Jane Buyer");
    expect(unit.soldNotes).not.toContain("to client");
  });

  it("leaves the order COMPLETED", async () => {
    const { reservationId } = await makeShippedEbayOrder({ price: 100 });
    await completeSale(reservationId);
    const order = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(order.status).toBe("COMPLETED");
  });

  it("recomputes the asset's totalQuantity so the count is not left short", async () => {
    const { reservationId, assetId } = await makeShippedEbayOrder({ price: 100 });
    await completeSale(reservationId);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.totalQuantity).toBe(0);
  });

  it("refuses a RENTAL order", async () => {
    const { reservationId } = await makeShippedEbayOrder({ price: 100, type: "RENTAL" });
    await expect(completeSale(reservationId)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Write the fixture helper**

Create `src/lib/actions/__fixtures__/orders.ts` with `makeShippedEbayOrder({ price, type })` that creates a client named `TEST eBay`, an asset with `totalQuantity: 1` and one `AVAILABLE` unit with a unique barcode (`TEST-${Date.now()}`), and a reservation of the given type (default `EBAY`) at status `SHIPPED` with `buyerName: "Jane Buyer"`, one `ReservationItem` at the given rate, and a `ReservationItemUnit` joining the two. Return `{ reservationId, assetId, unitId, clientId }` and push the ids onto the `made` record.

Read `createReservation` in `src/lib/actions/reservations.ts:568` for the exact required fields rather than guessing them.

**This writes to the v2 database.** That is acceptable — v2's data is expendable during the build and v1 is never touched — but the fixtures are prefixed `TEST` and removed in `afterEach` so a failed run is identifiable.

- [ ] **Step 5: Run the tests**

Run: `npm test -- sales.sold`
Expected: PASS, 4 tests. If `completeSale` throws on the RENTAL case for the wrong reason, read the error — the guard must reject on type, not on a missing field.

- [ ] **Step 6: Wire the ship step**

In `src/components/orders/order-actions.tsx`, after `markShipped` succeeds, if the order's type is in `SALE_TYPES`, open a confirmation dialog:

- Title: **Mark this order sold?**
- Body: *"Shipping an eBay or sale order transfers the hardware. Confirming marks every unit on it as sold and closes the order. This is not easily undone — a return is recorded separately."*
- Confirm: **Mark sold and close**
- Cancel: **Not yet**

Confirming calls `completeSale`. Cancelling leaves the order `SHIPPED`; the stage bar keeps offering the move, so nothing is stranded. Follow `CompleteDialog` at `:196` for the markup and the busy/error handling.

- [ ] **Step 7: Try it in the app**

Take the eBay order from Task 4 Step 9 through Preparing and Ship. Confirm the dialog appears, confirm it, then check:

```bash
docker exec vfxnow-amc-db-1 psql -U postgres -d vfxnow_amc_v2 -c "SELECT u.barcode, u.status, u.\"soldPrice\", u.\"soldNotes\" FROM asset_units u WHERE u.\"soldViaReservation\" IS NOT NULL ORDER BY u.\"soldAt\" DESC LIMIT 5;"
```
Expected: the units `SOLD`, priced, and the note naming the buyer.

Also re-open `/dashboard?view=business` and confirm the Out by category tile's fleet total dropped by the number of units sold — sold hardware is not fleet.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat(orders): shipping a sale or eBay order marks its units sold

completeSale existed and had no callers: the stage bar's Close order went to
completeReservation, which never touched unit status, so a sale closed
through the UI left its hardware CHECKED_OUT. It is now wired to the ship
step behind a confirmation, and tested first — it had never run.

Also fixes soldNotes, which hardcoded 'to client'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rent-to-own sells at the end of its term

**Files:**
- Create: `src/lib/orders/rto-complete.ts`
- Create: `src/lib/orders/rto-complete.test.ts`
- Modify: `src/lib/actions/payments.ts` (wherever an invoice is marked `PAID`)

**Interfaces:**
- Produces: `export function rtoTermComplete(paidInvoices: number, termMonths: number | null): boolean`

**The obvious field cannot be used.** `rtoInstallmentsPaid` is set to `0` and incremented by nothing — `components/orders/commercial-cards.tsx:65` says so outright. Building on it would mean no RTO ever completed.

- [ ] **Step 1: Write the test**

Create `src/lib/orders/rto-complete.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rtoTermComplete } from "./rto-complete";

describe("rtoTermComplete", () => {
  it("is complete when paid invoices reach the term", () => {
    expect(rtoTermComplete(12, 12)).toBe(true);
  });

  it("is complete when they exceed it", () => {
    expect(rtoTermComplete(13, 12)).toBe(true);
  });

  it("is not complete one payment short", () => {
    expect(rtoTermComplete(11, 12)).toBe(false);
  });

  it("is never complete without a term", () => {
    expect(rtoTermComplete(99, null)).toBe(false);
  });

  it("is never complete on a zero-month term", () => {
    expect(rtoTermComplete(0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- rto-complete`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/orders/rto-complete.ts`:
```ts
/**
 * Whether a rent-to-own term has been served out.
 *
 * Counted from PAID invoices, not from `Reservation.rtoInstallmentsPaid`: that
 * column is written once as 0 and incremented by nothing in this codebase —
 * see components/orders/commercial-cards.tsx:65. An ownership transfer built on
 * it would never fire.
 *
 * Paid-in-full rather than calendar-elapsed, deliberately: a defaulted RTO must
 * not transfer ownership merely because time passed.
 */
export function rtoTermComplete(
  paidInvoices: number,
  termMonths: number | null,
): boolean {
  if (!termMonths || termMonths <= 0) return false;
  return paidInvoices >= termMonths;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- rto-complete`
Expected: PASS, 5 tests.

- [ ] **Step 5: Find where an invoice becomes PAID**

Run:
```bash
grep -rn "'PAID'\|\"PAID\"" src/lib/actions/ | grep -v generated
```
Read the action that records a payment and identify the single place an invoice's status becomes `PAID`.

- [ ] **Step 6: Trigger the transfer there**

After an invoice is marked `PAID`, if its reservation is `RENT_TO_OWN`, count that reservation's `PAID` invoices and call `rtoTermComplete`. When it returns true, call `completeSale` for that reservation.

Widen the `completeSale` guard from Task 5 to accept `RENT_TO_OWN` as well — but **only** through this path. Shipping an RTO order must not mark it sold: the customer does not own it yet. Assert this with a test:

```ts
it("does not mark a rent-to-own order sold on ship", async () => {
  const { reservationId, unitId } = await makeShippedEbayOrder({
    price: 100,
    type: "RENT_TO_OWN",
  });
  // The ship step only calls completeSale for SALE_TYPES.
  const unit = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitId } });
  expect(unit.status).not.toBe("SOLD");
});
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat(orders): rent-to-own transfers ownership when its term is paid off

Counted from PAID invoices rather than Reservation.rtoInstallmentsPaid,
which is set to 0 at creation and incremented by nothing — a second dead
path of the same kind completeSale turned out to be.

Paid-in-full, not calendar-elapsed: a defaulted RTO must not transfer
ownership just because time passed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Returns

**Files:**
- Modify: `src/lib/actions/sales.ts` (add `returnSale`)
- Create: `src/lib/actions/sales.return.test.ts`
- Create: `src/components/orders/return-dialog.tsx`
- Modify: `src/components/orders/order-actions.tsx`
- Modify: `src/lib/queries/reservation-record.ts`

**Interfaces:**
- Consumes: `SALE_TYPES`, `completeSale` fixtures.
- Produces:
```ts
export async function returnSale(
  reservationId: string,
  input: {
    units: { id: string; condition: ReturnCondition }[];
    refundAmount?: number;
    notes?: string;
  },
): Promise<{ returned: number }>
```

- [ ] **Step 1: Write the test**

Create `src/lib/actions/sales.return.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeSale, returnSale } from "./sales";

describe("returnSale", () => {
  it("puts a good unit back as AVAILABLE and clears every sold field", async () => {
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "GOOD" }],
      refundAmount: 250,
    });

    const unit = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe("AVAILABLE");
    expect(unit.soldAt).toBeNull();
    expect(unit.soldPrice).toBeNull();
    expect(unit.soldViaReservation).toBeNull();
    expect(unit.soldNotes).toBeNull();
  });

  it("sends a damaged unit to MAINTENANCE, not back into the bookable pool", async () => {
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "DAMAGED" }],
    });

    const unit = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitId } });
    expect(unit.status).toBe("MAINTENANCE");
  });

  it("gives a damaged unit its own maintenance record so it reaches the service page", async () => {
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "DAMAGED" }],
    });

    const records = await prisma.maintenanceRecord.findMany({
      where: { assetUnitId: unitId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    });
    expect(records).toHaveLength(1);
  });

  it("records the refund against the order without erasing what it sold for", async () => {
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "GOOD" }],
      refundAmount: 200,
    });

    const order = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(Number(order.refundedAmount)).toBe(200);
    expect(order.refundedAt).toBeInstanceOf(Date);
    expect(Number(order.total)).toBe(250);
    expect(order.status).toBe("COMPLETED");
  });

  it("stamps the junction row with when and in what condition", async () => {
    const { reservationId, unitId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "FAIR" }],
    });

    const junction = await prisma.reservationItemUnit.findFirstOrThrow({
      where: { assetUnitId: unitId },
    });
    expect(junction.returnCondition).toBe("FAIR");
    expect(junction.returnedAt).toBeInstanceOf(Date);
  });

  it("restores the asset's totalQuantity", async () => {
    const { reservationId, unitId, assetId } = await makeShippedEbayOrder({ price: 250 });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitId, condition: "GOOD" }],
    });

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.totalQuantity).toBe(1);
  });

  it("refuses a unit that was sold via a different order", async () => {
    const a = await makeShippedEbayOrder({ price: 100 });
    const b = await makeShippedEbayOrder({ price: 100 });
    await completeSale(a.reservationId);
    await completeSale(b.reservationId);

    await expect(
      returnSale(a.reservationId, {
        units: [{ id: b.unitId, condition: "GOOD" }],
      }),
    ).rejects.toThrow();
  });

  it("returns only the units named, leaving the rest sold", async () => {
    const { reservationId, unitIds } = await makeShippedEbayOrder({
      price: 100,
      unitCount: 2,
    });
    await completeSale(reservationId);

    await returnSale(reservationId, {
      units: [{ id: unitIds[0], condition: "GOOD" }],
    });

    const first = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitIds[0] } });
    const second = await prisma.assetUnit.findUniqueOrThrow({ where: { id: unitIds[1] } });
    expect(first.status).toBe("AVAILABLE");
    expect(second.status).toBe("SOLD");
  });
});
```

Extend the Task 5 fixture helper with a `unitCount` option returning `unitIds`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- sales.return`
Expected: FAIL — `returnSale` is not exported.

- [ ] **Step 3: Implement `returnSale`**

Add to `src/lib/actions/sales.ts`, beside `completeSale`. One transaction:

1. Load the reservation with its items and their units. Refuse unless its type is in `SALE_TYPES` or is `RENT_TO_OWN`.
2. For each named unit: refuse unless its status is `SOLD` **and** `soldViaReservation === reservationId`. This is the check `restoreUnit` cannot make, and it is why this is an order-level action.
3. Clear `soldAt`, `soldPrice`, `soldViaReservation`, `soldNotes`; set `status` to `MAINTENANCE` when the condition is `DAMAGED`, otherwise `AVAILABLE`.
4. For each damaged unit, create a `MaintenanceRecord` with status `SCHEDULED` and a description naming the order. Read `src/lib/actions/maintenance.ts:96` for the required fields — a unit set to `MAINTENANCE` with no record never reaches the maintenance page, which is why `reconcileOrphanMaintenanceUnits` exists.
5. Stamp `returnedAt` and `returnCondition` on each `ReservationItemUnit`.
6. Recompute `Asset.totalQuantity` for every affected asset, the same way `completeSale` does at `sales.ts:269`.
7. When `refundAmount` is given, add it to `refundedAmount` (do not overwrite — a second partial return adds to the first) and set `refundedAt`.
8. Write `StatusHistory` and `AuditLog` entries.

Leave the order `COMPLETED`. No `RETURNED` status exists and none is added.

- [ ] **Step 4: Run the tests**

Run: `npm test -- sales.return`
Expected: PASS, 8 tests.

- [ ] **Step 5: Build the dialog**

Create `src/components/orders/return-dialog.tsx`: a table of the order's sold units (barcode, asset name, what it sold for), a tickbox per unit, a `ReturnCondition` select per ticked unit defaulting to `GOOD`, a refund amount input defaulting to the summed price of the ticked units, and a notes field.

Copy under the condition select: *"Damaged units go to service rather than back on the shelf."*

Wire it into `src/components/orders/order-actions.tsx` as a **Return** action, shown only on a `COMPLETED` order of a sale type that has at least one unit still sold to it.

- [ ] **Step 6: Surface it on the order**

In `src/lib/queries/reservation-record.ts`, include `refundedAmount`, `refundedAt`, and each unit's `returnedAt` / `returnCondition`. Show on the order screen: the refund beneath the total, and a returned marker per unit.

For an eBay order, show the three figures the spec asks for — **sold for**, **payout**, and the fee between them — with the payout labelled an estimate while `payoutEstimated` is true, and net as `payoutAmount − refundedAmount`.

- [ ] **Step 7: Try it in the app**

Return one unit from the eBay order as `DAMAGED`. Confirm:
- the unit reads `MAINTENANCE` and appears on `/dashboard/service`
- the order still shows what it sold for, with the refund beneath
- the Out by category tile's fleet total went back up

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat(orders): return a sale, per item, with condition and refund

Damaged returns go to MAINTENANCE with their own MaintenanceRecord rather
than back into the bookable pool — a unit set to MAINTENANCE without a
record never reaches the service page.

The sale is kept and the refund recorded against it, so a partial refund
stays expressible and the history stays true.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Protect the new columns from the v1 sync

**Files:**
- Modify: `src/lib/v1-sync/engine.ts` (only if the check in Step 2 fails)
- Create: `docs/superpowers/plans/notes-ebay-v1-sync.md` (only if a change was needed)

The six new `Reservation` columns and two `ReservationItemUnit` columns exist only in v2. A sync that overwrote them would erase every eBay sale number, buyer and payout.

- [ ] **Step 1: Read how the engine treats v2-only columns**

Read `src/lib/v1-sync/engine.ts` around the `keptV2Only` counter (`:137`, `:288`) and the `unmapped` collection (`:231`). Establish whether v2-only columns are preserved automatically (because the update only sets columns v1 has) or by an explicit list.

- [ ] **Step 2: Prove it with a dry run**

Run:
```bash
npx tsx scripts/sync-from-v1.ts --only reservations
```
Expected: a dry run reporting what would change. Confirm the `v2-only kept` column is non-zero for `reservations` and that none of the six new columns appear under "v1 columns v2 has no field for".

- [ ] **Step 3: Prove it against real data**

Create an eBay order (or reuse the one from Task 4), note its `externalRef`, run the dry run again, and confirm the engine does not report that row as an update that would blank those fields.

If the engine preserves them automatically, **make no change** — record the finding in the commit message and stop.

If it does not, add the eight columns to whatever mechanism the engine uses to keep v2-only data, and add a test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(v1-sync): confirm the eBay columns survive a sync

The six Reservation columns and two ReservationItemUnit columns are v2-only;
a sync that overwrote them would erase every eBay sale number and payout.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification

- [ ] `npm test` — every test passes
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — no new errors
- [ ] `npm run build` — passes (catches the `"use server"` const-export trap, which dev does not)
- [ ] `npx tsx scripts/smoke-routes.ts` — no route regressed
- [ ] An eBay order numbers `EBAY-…`, not `RES-…`
- [ ] Shipping it marks its units `SOLD` after the confirmation
- [ ] Declining the confirmation leaves it `SHIPPED` with units untouched
- [ ] A rent-to-own order shipped does **not** mark units sold
- [ ] Returning a damaged unit puts it in `MAINTENANCE` with a maintenance record
- [ ] An eBay order raises no invoice and never appears on the billing run
- [ ] A v1 sync dry run does not blank the new columns

## Out of scope, recorded

- **Backfilling the 546 legacy sold units** with `soldViaReservation`. The owner may have historical sheets; that is separate work with its own source data.
- **Repairing `rtoInstallmentsPaid`.** It belongs with the billing run. The RTO progress figures on the order screen and the order PDF read that dead counter and are wrong today — pre-existing, neither caused nor fixed here.
