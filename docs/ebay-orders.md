# eBay orders — specification

Asked for by the owner, 2026-09-17:

> then please add a new order type called Ebay. accessible from new orders, etc. We need to
> track items that explicitly go to ebay as we do sell a bit there time to time. This should
> be more simplistic, tag an ebay sale number in our system, but ask for ebay buyer name,
> sale amount, attach items, and ship as intended. need those items to be marked sold.

And, on the shipping step:

> if we mark ship - have a dialogue on those sale order types that then ask to mark the
> order as sold/complete, just extra confirmation.

## What it is for

Hardware sold on eBay rather than to a client. It is a real sale — the units leave and must
read `SOLD` — but almost none of the commercial machinery around a client sale applies:
there is no quote, no approval, no invoice to raise, no billing cycle, and no relationship
to manage. eBay has already taken the buyer's money by the time the order exists here.

The record exists to answer two questions later: **where did this unit go**, and **what did
we actually net for it**.

## The latent fault this work has to fix first

`completeSale(reservationId)` — `lib/actions/sales.ts:173` — is the only code in the app
that marks an order's units sold. It writes `status: SOLD`, `soldAt`, `soldPrice`,
`soldViaReservation` and `soldNotes`, auto-picking `AVAILABLE` units where a line has none.

**It has no callers.** The stage bar's "Close order" calls `completeReservation`
(`reservations.ts:3140`), which never touches unit status except to release cloud
allocations. So a SALE order closed through the UI today leaves its hardware `CHECKED_OUT`:
in the fleet, counted as out, bookable-looking forever.

The codebase already knows: `components/accounting/contract-cards.tsx:148` records that 546
of 548 sold units carry no `soldViaReservation`.

Checked against this database, 2026-09-17: **zero** units currently sit `CHECKED_OUT` on a
completed sale or rent-to-own order. The v1 import set `SOLD` directly, so the fault has not
yet produced bad data. It is dormant, and the request to have eBay items "marked sold" is
precisely what makes it reachable. It is fixed here for `SALE` as well as `EBAY`, per the
owner's decision (2026-09-17) — the alternative was building a working path beside a broken
one.

## Schema

There is no `prisma/migrations/`; the schema is applied with `prisma db push`
(`package.json:11`) followed by `prisma generate`. Per `docs/build-plan.md` and hard
experience, **the dev server must be restarted afterwards** — the Prisma client is pinned to
`globalThis`, so a new column never loads into a running process.

`ReservationType` gains `EBAY`:

```prisma
enum ReservationType { RENTAL, SALE, RENT_TO_OWN, CLOUD, EBAY }
```

Four nullable columns on `Reservation`. Nullable throughout, so no backfill:

| Column | Type | Holds |
| --- | --- | --- |
| `externalRef` | `String?` | The eBay sale number |
| `buyerName` | `String?` | Who bought it on eBay |
| `payoutAmount` | `Decimal? @db.Decimal(12,2)` | What eBay pays us, after fees |
| `payoutEstimated` | `Boolean @default(true)` | Whether that figure is a guess |
| `refundedAmount` | `Decimal? @db.Decimal(12,2)` | What we gave back on a return |
| `refundedAt` | `DateTime?` | When we gave it back |

Plus two on `ReservationItemUnit` — `returnedAt` and `returnCondition` — and both refund
columns apply to `SALE` as well as `EBAY`. See "Returns".

`externalRef` is named generically rather than `ebaySaleNumber`. The next marketplace wants
the same field, and a column named after one vendor gets a second column bolted beside it.
It is deliberately **not** `hubspotDealId`-style unique: eBay sale numbers are typed by hand
and a typo must not block saving the order.

Rejected: reusing `projectCode`. It is free and unused in the new-order flow, and it is the
cheap hack the research flagged — but a sale number sitting in a field labelled "project" is
a thing nobody finds in two years.

The fee rate is a `Setting` row, key `ebay_fee_rate`, defaulting to `13` (percent) and
editable under Settings → Business, beside the numbering patterns.

## What "more simplistic" means, concretely

An eBay order's lifecycle is **`DRAFT` → `PREPARING` → `SHIPPED`**, and shipping is what
marks the units sold and closes the order. No quote stage, no approval stage. Those exist to
get a client to agree to terms; eBay's buyer agreed to terms on eBay. See "When units become
sold" for the rule across every order type.

Note there is no `SOLD` *order* status and none is added — `ReservationStatus.COMPLETED` is
documented as "all items returned / sale fulfilled" and already covers it. "Sold" describes
the units, not the order.

| Behaviour | eBay |
| --- | --- |
| Billing cycle | `ONE_TIME` |
| `notBilled` | `true` — no invoice is ever raised |
| `isRecurring` | `false`, always |
| Term / RTO fields | none |
| `endDate` | forced to `startDate`, as `SALE` does |
| Shipping | unchanged — the existing shipping card and `saveShipping` |

`notBilled: true` is the important one. eBay collected the money; an invoice to the buyer
would be a document for a debt that does not exist, and it keeps the order off the billing
run by the mechanism that is already there for evaluation and gifted orders.

## Ownership

One client account named **eBay**, with the person who runs eBay set as its `Client.ownerId`
— "the rep who owns the relationship" (`schema.prisma:711`). His name is then on every eBay
order through the field that already means exactly this, with no new schema.

`preparedById` continues to stamp whoever presses *Start preparing*
(`order-stage.ts:316`), so a sale someone else prepped, packed and shipped records that
person on that order rather than silently crediting the owner.

The buyer is **not** a client record. They go in `buyerName`. The owner chose this over a
thin prospect `Client` per buyer (2026-09-17): eBay buyers are one-off, and an account row
for each would bury the real client list.

## Money

Items carry real per-item prices — the owner was explicit:

> need solid prices, what it sold for, and what ebay payout is either know or estimated

So the gross is the order total, built the normal way from line prices. `costBasis` per line
keeps working exactly as it does for `SALE` (`reservations.ts:723`), so margin per item
survives.

`payoutAmount` is computed at creation as `total × (1 − ebay_fee_rate / 100)` — the setting
is stored as a percentage, `13`, not a fraction — and saved with `payoutEstimated: true`.
Typing the settled figure from eBay overwrites it and clears the flag. The order screen shows three figures — **sold for**, **payout**, and the fee between
them — and labels the payout as an estimate until it is not.

**Margin reads against payout, not gross.** eBay's cut is roughly an eighth of the sale;
counting it as profit would overstate every eBay sale by that much. This is the one place
the eBay type diverges from `SALE` in a way that matters to reporting, and it is the reason
the payout column exists rather than being left to a note.

## When units become sold

Stated by the owner, 2026-09-17:

> let's just keep it simple. If we ship on a ebay or sales order, etc. it's sold. if we ship
> rent to own, it sells after the term ends, and so on

One rule per order type, and the rule is about **when ownership transfers**, not about what
stage the order happens to be at:

| Order type | Units become `SOLD` |
| --- | --- |
| `EBAY` | On ship |
| `SALE` | On ship |
| `RENT_TO_OWN` | When the term completes |
| `RENTAL` | Never — the kit comes back |
| `CLOUD` | Never — there is no hardware to transfer |

Shipping is the moment of sale for `SALE` and `EBAY`. There is no separate "complete it
later" step to forget: the hardware left, so it is sold.

### Rent-to-own

An RTO order ships like a rental — the units go out `CHECKED_OUT` and stay that way, because
the customer does not own them yet. They become `SOLD` when the term completes.

**"Completes" means the final installment is paid, not that the calendar has run out.** A
defaulted RTO must not transfer ownership just because time passed, and a date-driven rule
would do exactly that.

**The obvious field cannot be used.** `rtoInstallmentsPaid` (`schema.prisma:1043`) is set to
`0` at creation and incremented by nothing — `commercial-cards.tsx:65` already says so in as
many words: *"a counter nothing increments — no billing run"*. It is a second dead path of
exactly the kind `completeSale` turned out to be, and building the ownership transfer on it
would mean no RTO ever completed.

So the trigger counts **`PAID` invoices against the order** — a fact the invoice table
actually holds — rather than trusting the counter. When recording a payment brings that
count to `rtoTermMonths`, the order's units are marked sold through the same `completeSale`
path, with `soldPrice` from the line and `soldNotes` naming the order.

Repairing `rtoInstallmentsPaid` itself is out of scope here and belongs with the billing
run; the RTO-progress figures on the order screen and the order PDF
(`order-detail-pdf.tsx:325-355`) read that dead counter and are therefore wrong today, which
is a pre-existing fault this work neither causes nor fixes.

This is an assumption worth confirming, and it is called out rather than buried: paid-in-full
is the honest trigger, but if the business treats a term as complete on its end date
regardless of arrears, this rule inverts and the condition becomes a date comparison.

## The confirmation on ship

`markShipped` behaves as it does today. On success, for `SALE` **and** `EBAY`, a follow-on
dialog opens: *mark the order sold and complete?*

Confirming calls `completeSale`, which flips the units to `SOLD` with `soldAt`, `soldPrice`
and `soldViaReservation` — the traceability the 546 legacy units lack. Declining leaves the
order `SHIPPED`; the stage bar keeps offering the move, so nothing is stranded by saying no.

The dialog is not decoration. Marking hardware sold is irreversible in practice — the
reverse path, `restoreUnit` (`assets.ts:773`), exists but is a repair, not an undo. A
confirmation earns its place on any step that permanently removes units from the fleet.

`ShipDialog` and `CompleteDialog` already exist in `components/orders/order-actions.tsx`
(`:191`, `:196`), so this follows the established pattern rather than inventing one.

The six `reservationType !== 'SALE'` guards in `sales.ts` (`:193, 487, 731, 835, 941, 1026`)
widen to accept both types.

Two details inside `completeSale` change with them. `soldPrice` is taken from the line's own
rate (`sales.ts:255`), which is exactly right now that eBay lines carry solid per-item
prices. `soldNotes` hardcodes `Sold via <number> to client` (`:264`) — on an eBay order that
is wrong twice over, so it becomes the buyer's name where there is one.

## Returns

Asked for by the owner, 2026-09-17:

> we should have the ability to return order for ebay too, it happens.

`completeSale` is one-way: once units are `SOLD` the only route back is `restoreUnit`
(`assets.ts:773`), which is a per-unit repair reached from the retired-units screen and
knows nothing about the order it reverses. A returned eBay sale needs the order to change
too, so this is a proper flow rather than a tidy-up.

It applies to **`SALE` and `EBAY` alike** (owner, 2026-09-17), for the same reason the
`completeSale` fix does: a client sale can come back, and a return path built for one type
leaves the other with the gap we just finished closing.

### Per item, not per order

Units are picked individually. A whole-order return is the case where every unit is ticked.
A two-item lot where one comes back is common enough on eBay that a whole-order-only flow
would be worked around by hand, and worked around badly.

### Condition decides where the unit lands

The return asks for a `ReturnCondition` — the enum already exists (`schema.prisma:803`:
`EXCELLENT`, `GOOD`, `FAIR`, `DAMAGED`).

| Condition | Unit becomes |
| --- | --- |
| Excellent, Good, Fair | `AVAILABLE` |
| Damaged | `MAINTENANCE` |

Damaged stock must not land back in the bookable pool, where the next order would promise
it to someone. Routing it to `MAINTENANCE` keeps it in the fleet — it is still capacity, it
just is not promisable — which is the distinction `lib/inventory/availability.ts` already
draws between `IN_FLEET` and `BOOKABLE`.

**A damaged return must create its own `MaintenanceRecord`.** Setting
`AssetUnit.status = 'MAINTENANCE'` alone produces a unit that never appears on the
maintenance page; `reconcileOrphanMaintenanceUnits` (`maintenance.ts:92`) exists precisely
to sweep up units left in that state. Relying on a reconciler to notice our own write would
be writing a bug and scheduling its cleanup.

### The money

The sale is kept and a refund is recorded against it. Nothing is erased: the order still
says what it sold for, and reports net the two. That makes a partial refund expressible —
a buyer who keeps the item at a discount, or a restocking fee withheld — which zeroing the
order out could not represent.

Two new columns on `Reservation`:

| Column | Type | Holds |
| --- | --- | --- |
| `refundedAmount` | `Decimal? @db.Decimal(12,2)` | What we actually gave back |
| `refundedAt` | `DateTime?` | When |

`refundedAmount` is **what left our side**, not what the buyer received. eBay's treatment of
its own fee on a refund varies by case and is not knowable from here, so the field records
the figure we can actually observe from the payout. Where that differs from the buyer's
refund, the difference is eBay's business and not ours to model. Stated plainly because a
column called "refunded" invites the other reading.

Net for the order is `payoutAmount − refundedAmount`. A fully refunded sale nets zero
without pretending it never happened.

### Recording which units came back

Two new columns on `ReservationItemUnit`:

| Column | Type |
| --- | --- |
| `returnedAt` | `DateTime?` |
| `returnCondition` | `ReturnCondition?` |

Deliberately **not** reusing `checkedInAt`, which already sits on that model. On a rental
`checkedInAt` means "the hire ended and the kit came back", and it is read by the rental
movement and due-back queries. A sale coming back is a different event with different
accounting, and overloading one column would quietly fold returned sales into rental
check-in figures.

### The action

`returnSale(reservationId, { units: [{ id, condition }], refundAmount, notes })`, beside
`completeSale` in `lib/actions/sales.ts`, in one transaction:

1. For each unit: clear `soldAt`, `soldPrice`, `soldViaReservation`, `soldNotes`; set status
   from the condition table above.
2. Stamp `returnedAt` and `returnCondition` on the junction row.
3. Create a `MaintenanceRecord` for each damaged unit.
4. Recompute `Asset.totalQuantity` — `completeSale` decremented it (`sales.ts:269`), so a
   return that skipped this would leave the count permanently short.
5. Write `refundedAmount` and `refundedAt` on the order.
6. Write `StatusHistory` / `AuditLog`, so the reversal is as traceable as the sale.

The order **stays `COMPLETED`**. No `RETURNED` status is added: it would have to be threaded
through every status map, every filter and every badge, to express something the refund
fields already say. A fully returned order reads as completed with a full refund, which is
what happened.

### Guarding it

A unit may only be returned if it is `SOLD` and its `soldViaReservation` points at this
order. That is the check `restoreUnit` cannot make, and it is the reason this is an
order-level action rather than a loop over the per-unit repair.

## Change surface

The research pass mapped this. Roughly twelve exhaustive `Record<ReservationType, …>` maps
will not compile until `EBAY` is added, which is the good kind of breakage:

`lib/reservations/status.ts:23` (`TYPE_LABEL`), `lib/orders/types.ts:38,52` plus the
`TYPE_FILTERS:24` slug and `ORDER_TYPES:61` ordering, `components/reservations/order-builder.tsx:67,75`
(`DATE_LABELS`, `TYPE_NOTE`), `components/orders/order-actions.tsx:846` (`CYCLES_FOR`),
`lib/types.ts:280,286`, `lib/analytics/earned-revenue.ts:19,100,149`.

The silent-default spots have no compile error and must be handled deliberately. In
priority order:

1. **`lib/numbering/next.ts:122` (`kindForOrderType`)** — without an `EBAY` case, eBay
   orders are silently stamped `RES-` numbers. New kind `ebay`, default pattern
   `EBAY-{YYYY}-{SEQ}`, added to `NUMBER_KINDS`, `NUMBER_KIND_LABEL` and `DEFAULT_NUMBERING`
   in `numbering/format.ts`.
2. `lib/orders/recurring.ts:21` — eBay never recurs.
3. `lib/orders/lifecycle.ts:158` — the stage moves, and the "Close order" relabel.
4. `lib/actions/order-stage.ts:516` — allowed cycles, server side.
5. `lib/actions/reservations.ts:590,674` — end-date collapse and cycle forcing.
6. `lib/queries/operate.ts:156,168` — the calendar excludes sales from movements; eBay
   follows.
7. `components/orders/revenue-strip.tsx:9` — a card per order type.
8. `lib/format.ts:68`, `lib/email/templates.ts:152`, `lib/actions/documents.ts:419` — date
   and window wording.
9. `lib/integrations/hubspot.ts:26,174` — there is no eBay pipeline; eBay orders must not
   sync. Integrations are blank in v2, so this is a guard, not a configuration.
10. `components/leads/lead-resolve.tsx:26` and `lib/actions/leads.ts:423,510` — a second
    hardcoded type picker. eBay is not a lead outcome and is excluded there.

`lib/v1-sync/engine.ts:79-92` hardcodes `'SALE'` in SQL. v1 will never emit `EBAY`, so this
is safe — noted so the next person does not have to re-derive that it is safe.

Invoicing needs no type branching: `lib/actions/invoices.ts` is driven by billing cycle and
status, and `notBilled: true` keeps eBay out of it.

## Testing

`completeSale` has never run in production. It is being wired to a button that permanently
marks hardware sold, so it is covered before that happens:

- units move `CHECKED_OUT → SOLD` with all four sold fields written
- `soldViaReservation` points at the order, which is the whole traceability argument
- `Asset.totalQuantity` is recomputed (`sales.ts:269`)
- a line with no unit picked auto-picks `AVAILABLE` ones, and fails honestly when there
  are not enough
- declining the dialog leaves the order `SHIPPED` and every unit untouched
- an `EBAY` order raises no invoice and never appears on the billing run

## Open, deliberately

**Refresh from v1.** Per `docs/build-plan.md` the v1 refresh is becoming a data-only import
into the v2 schema. `EBAY` is v2-only and v1 cannot produce it, so no mapping is needed —
but a refresh must not drop the four new columns. Flagged for whoever rewrites that import.

**The 546 legacy sold units** carry no `soldViaReservation` and this work does not backfill
them. The information to do it does not exist in v2; it may exist in v1, and the owner said
(2026-09-17) they may have historical sheets to reference. So the backfill is deferred
rather than declared impossible — but it is a separate piece of work with its own source
data, and nothing here should be read as having fixed it.
