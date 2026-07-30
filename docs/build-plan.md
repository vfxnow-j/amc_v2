# v2 build plan — every screen, staged

Companion to `design/README.md` (the handoff) and `src/lib/nav/clusters.ts` (the
information architecture, which is the source of truth for what exists). This
document is the running order: what gets built, in what order, and what each
screen is made of.

## Definition of done, per screen

A screen is not finished until all of these hold. They come from the handoff's
copy and interaction rules, and they are the reason a screen takes longer than
it looks.

1. **Real data.** Server components reading Prisma, mutations through the ported
   `lib/actions/*` with `revalidatePath`. No client data-fetching library.
2. **A Suspense boundary per card**, so a slow aggregate never blocks a work
   queue, with skeletons at the real row height so nothing reflows.
3. **Empty states name the next action.** Never a blank table, never "No data".
4. **Counts are qualified.** "7 of 14 shown · scroll for the rest", never a bare
   number.
5. **Conflicts offer a way out**, never a dead end — the substitute/defer/override
   pattern from the handoff.
6. **Density holds**: ~30px table rows, 8px padding on 13px text.
7. **Both themes checked**, and the keyboard path works.
8. **No fabricated figures.** If the data can't support a number the design
   shows, the screen says what it can prove instead — see "Data gaps" below.

## Shipped

| Stage | What | Commit |
|---|---|---|
| 0a | Token layer, theming, fonts | `e58231d` |
| 0b | Shell: rail, accordion, header card, ⌘K palette | `e58231d` |
| 0c | v1 migration: schema, 39 actions, auth, 28 primitives, PDF renderers | `df5e599` |
| 0d | Database: `vfxnow_amc_v2` restored, env isolated | — |
| 0e | Insight → Overview against real data | `9e7593e` |
| X1 | Auth gate: proxy, session, signed-out screens | `64b8d32` |
| 1 | Operate → Today's movements | — |

Everything else in the rail renders a placeholder that names its v1 source.

**X1 was pulled ahead of Stage 1.** Every ported action gates on
`requireAuth`/`requireEditor`, so any screen that writes returns `Unauthorized`
until a session exists — building a mutating screen first would have produced
one that could not be exercised at all.

---

## Stage 1 — Today's movements ✅ shipped

**The Desk was dropped** (owner, 2026-07-30). A standalone check-out/check-in
screen duplicates the reservation record, which already holds the lines, the
assigned units, the rates and the sign-off — and v1 reached the same conclusion
on its own: its `/dashboard/checkout` is a signpost reading *"All check-outs are
now managed through reservations"* that redirects into the order.

So check-out and check-in are built **on the reservation record** (Stage 2), and
the rail slot becomes a queue that answers "what needs hands today" and hands
off to the order.

**Route:** `/dashboard/today`. Permanent redirects from `checkout` and `checkin`;
`checkouts` (v1's list of what's out) redirects to the Reservations hub.

| Card | Contents |
|---|---|
| Going out | Orders due out with units still to pull — Order · Client · Pull · Ship by |
| Coming back | Orders with units due back — Order · Client · Out · Due |

Read-only by design; every row opens its order. "Today" means *by now* in both
directions — an order three weeks past its ship date needs hands more than one
shipping this afternoon, and a screen keyed to today's date alone would hide it.

Outstanding units come from the line counts (`quantity − checkedOutCount`) rather
than from `ReservationItemUnit` rows, because a line can be ordered with no units
assigned yet — and those are exactly the ones nobody has touched.

## Stage 2 — Reservations hub + record

The hub the whole app orbits. Sub-views per the handoff: Open, Out now, Quotes,
Archive.

**List** (`/dashboard/reservations`): filter tabs, then a dense table —
Order · Client · Window · Units · Value · State. Row is the click target.

**Record** (`/dashboard/reservations/[id]`) — the design reference for this is
direction **1b** in `All directions (context).dc.html` (unit inspector +
work-order panel):

| Card | Contents |
|---|---|
| Header | Order number, client, window, state, primary action per state |
| Lines | Items and their assigned units, expandable to unit level |
| **Check-out / check-in** | **Absorbed from the dropped Desk.** Scan well always live, unit-level expected vs scanned, exceptions (unexpected unit, wrong order, already out, damaged), signature + delivery note. `checkoutByBarcode` / `checkinByBarcode` and the bulk actions already exist in `actions/reservations` |
| Unit inspector | Serial, condition, service history, current location |
| Service tab | "Service · 2" — work orders raised from this order (Stage 4) |
| Billing | Invoices raised, payments, QuickBooks sync state |
| Documents | Proposal, agreement, delivery note — signed copies retained |
| Activity | `StatusHistory` + `AuditLog` |

Check-in and check-out are required steps (owner's call), so the record must
make skipping impossible rather than merely discouraged. "Flag for service"
lands disabled until Stage 4, then switches on.

**New order builder** (`/dashboard/reservations/new`): direction **1c** is the
reference, and its conflict-resolution pattern is the rule for the whole app —
*"No unit is free for the whole window — all 6 are out until Aug 2,"* with
**Substitute** / **Start this line Aug 2** / **Book anyway, flag ops**.

## Stage 3 — Inventory

| Screen | Cards |
|---|---|
| Assets | List + filter tabs (active / **retired**), category filter, **register** action, bulk select |
| Asset record | Detail, units table, rates, market price, revenue to date, depreciation |
| Units | New in v2: flat serialized list — Unit · Asset · Status · Location · Client · Revenue |
| Unit record | Status timeline, service history, coverage, transfers, depreciation |
| Locations & transfers | Location list + in-flight `AssetTransfer` queue |
| Audits & scan lists | Merge: one screen, two tabs; scan session UI shares the Desk's scanner |
| Vendors | List + record; v1's duplicate settings copy is not rebuilt |

## Stage 4 — Service Center *(new feature)*

Fills the empty card on Overview and unblocks the Desk's "flag for service".

**Schema first:** `WorkOrder` (assetUnitId, openedFromReservationId, openedById,
assignedTechId, status `OPEN|IN_TEST|AWAITING_PARTS|RMA|CLOSED_PASS|CLOSED_SCRAP`,
fault, billable, openedAt, closedAt, notes) and `QcTestRun` (workOrderId,
testName, result `PASS|FAIL|RUNNING|QUEUED`, ranAt, durationSec, logUrl, output).

| Screen | Cards |
|---|---|
| Work orders | Queue by status; row → record |
| Work order record | Fault, unit, tech, billable flag, QC run table, close actions |
| QC test runs | Cross-order run list, filterable by result |
| Maintenance log | Existing `MaintenanceRecord`; a closed work order writes one |
| Coverage & RMA | `ServiceCoverage` expiry tracking, RMA state |

**Behaviour:** opening a work order takes the unit out of bookable stock;
`CLOSED_PASS` returns it, `CLOSED_SCRAP` retires it. A key-authenticated
`POST /api/v1/service/qc-runs` lets the bench rig file results — reuse
`lib/api-auth.ts` + `utils/rate-limit.ts`. Manual entry and log attachment must
work too.

**Then:** revisit the Overview Service card to show the real four-row queue.

## Stage 5 — Revenue

| Screen | Cards / notes |
|---|---|
| Invoices | List, record, generate-billing run, PDF, QuickBooks sync state |
| Payments | New: `Payment` list, allocation to invoices, QB reconciliation |
| Contracts | Merge of `sales` + `rent-to-own` + `leases`, filtered by type |
| — lease view | **Own view, not a filter chip:** hardware bought on a lease, with revenue tracked against paying it down. `AssetUnit` already carries `loanAmount`, `amortizationEndDate`, `fundingBusiness` |
| Rate cards | New list from `RateCard`/`Rate`; absorbs bulk rate updates |
| Purchase orders | List, record, receive flow, PO PDF |

## Stage 6 — Clients

| Screen | Cards |
|---|---|
| Accounts | List, record: contacts, orders, invoices, credit position, documents |
| Leads | List + kanban (v1 has both), lead activity, conversion to client |
| Quotes | Reservations filtered to `QUOTE_SENT`; expiry countdown, resend, approve. Public portal `/quote/[token]` stays as-is |

## Stage 7 — Insight, and notifications in marketing's place

| Screen | Cards |
|---|---|
| Overview | ✅ shipped — revisit for the Service card and any snapshot-backed deltas |
| Reports | Index + six children: forecast, inventory, pricing, stock-count, traffic, unpriced |
| Insights | `lib/analytics/insights.ts` full surface, grouped by priority |
| **Notifications** | New, replacing marketing: `Notification` model + `NotificationType` + `settings/notifications` + the `cron/daily-digest` job already exist. Needs a bell in the shell, a feed, per-type preferences, and digest email |

## Stage 8 — Settings

Fourteen children carried across unchanged: ai*, api-keys, audit-log, categories,
cloud-products, documents, import (assets / ratecard / retired), integrations,
locations*, notifications, profile, quickbooks, users, vendors*.

*`ai` is dropped with Nowbot; `locations` is promoted into Inventory; `vendors`
is the duplicate that isn't rebuilt.*

**QuickBooks is demo-tested against the QB sandbox** — treat `settings/quickbooks`
+ the OAuth routes as a first-class deliverable of this stage, not a leftover.

---

## Cross-cutting workstreams

Run alongside the stages; each is a prerequisite for something above.

| # | Work | Blocks | Notes |
|---|---|---|---|
| X1 | **Auth gate** — port `(auth)` screens, gate the shell layout, real session in the user pod | Everything, before real customer data is exposed on :3001 | Also switches `getDecisions()` to the auth-checked `getInsights()`, and feeds the per-user theme + role default the shell already has seams for |
| X2 | **Redirects** for the three merges | Stages 1, 3, 5 | Old URLs are in `NavPage.from` |
| X3 | **`MetricSnapshot` + nightly rollup** | Utilisation delta, revenue vs target | See "Data gaps" |
| X4 | **API handlers** — `/api/v1/*`, integrations, cron | HubSpot / Zapier / JustCall inbound already flowing in v1 | Drop `cron/knowledge`; `cron/insights` needs its `refreshKnowledge` import removed |
| X5 | **Lint burn-down** | — | 116 inherited `any`s, scoped per ported path; clear a module as its screen is rebuilt |
| X6 | **Design asks** | — | SVG mark, light-ground logo, and sign-off on the invented `--danger`/`--success`/`--warning` tokens |

## Data gaps — where the design asks for what the database can't say

These need a product decision, not more code.

1. **Utilisation delta ("+2.1 pts").** Nothing snapshots utilisation over time.
   Needs X3, a nightly `MetricSnapshot` row. Until then the card shows the ratio.
2. **Revenue target ("64% of target").** No target exists in the schema. Needs a
   target per period, probably in settings.
3. **Overdue means recurring-excluded.** Recurring orders' `endDate` is a billing
   period end, not a return date; including them read 214 overdue instead of 35.
   Confirm with whoever runs the desk.
4. **Short-window revenue excludes recurring**, because cycle boundaries dwarf
   trading. The Overview labels those windows "Rentals & sales".
5. ~~**Per-page nav counts**~~ — cluster counts are real as of `d5f8515`
   (`lib/queries/nav-counts.ts`). Per-page counts stay unimplemented rather than
   faked; the reference specifies none.
6. **Doubled order quantities on the custody import.** 48 asset lines carry an
   ordered quantity and a `checkedOutCount` at exactly twice the units attached
   to them. No units are missing: `Checkout` (575 rows) and `ReservationItemUnit`
   agree exactly at 339 out, and every one of the 48 has precisely one `Checkout`
   row per unit.

   **Root cause.** Not two import runs — one run, in one second. The custody
   import created each line with `checkedOutCount` already set to the quantity,
   then *also* drove the normal check-out path for each unit. That path
   auto-expands (`reservations.ts:3803`, and again in `checkoutByBarcode` at
   `:4568`):

   ```ts
   if (item.checkedOutCount >= item.quantity) {
     quantity: item.checkedOutCount + 1,
     subtotal: computeItemSubtotal(rate, item.checkedOutCount + 1, periods),
   }
   ```

   Because the import had already made `checkedOutCount === quantity`, the very
   first scan trips the condition, and from then on quantity and counter climb
   together, one per unit — landing at exactly 2×. 46 of the 48 lines carry
   "Auto-created from custody import".

   **This is the v1 logic that is wrong.** A barcode scan silently rewrites what
   the client ordered *and reprices the line*. Mostly invisible here because
   custody lines are $0, but 4 priced lines went through it and overstate two
   orders by **$1,430** — `RES-2026-00001` by $800 and `RES-2026-00003` by $630.
   Scanning a unit must never change an order's commercial terms; the conflict
   belongs in front of a person (the substitute/defer/override pattern), not in
   a silent `UPDATE`.

   **Not backfilled, by decision (owner, 2026-07-30):** a repair picked by
   guesswork would bury the evidence. Reported instead — per-line on the order
   record, per-order as a system flag from `lib/analytics/data-integrity.ts`,
   which surfaces on Insights in Stage 7.

## Suggested order

X1 ✅ → Stage 1 ✅ → Stage 2 → Stage 4 → Stage 3 → Stage 5 → Stage 6 → Stage 7 →
Stage 8, with X2 alongside each merge and X3 before Overview is called final.

Rationale: auth first, because nothing that writes works without it and the
instance already carries real customer data on the LAN. Then the queue, which
is read-only and proves the Operate cluster end to end. Then Reservations, which
now carries the check-out/check-in flow the Desk was going to hold, and is the
hub the whole app orbits. Service Center stays ahead of Inventory because the
record's "flag for service" path depends on it.
