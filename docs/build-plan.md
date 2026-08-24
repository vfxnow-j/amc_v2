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

Snapshot taken 2026-08-03, with every stage in. `npx tsx scripts/smoke-routes.ts`
is the live answer — it walks all 65 reachable pages with a real session and
reports built / placeholder / broken. Trust it over this table.

| Stage | What | Commit |
|---|---|---|
| 0a | Token layer, theming, fonts | `e58231d` |
| 0b | Shell: rail, accordion, header card, ⌘K palette | `e58231d` |
| 0c | v1 migration: schema, 39 actions, auth, 28 primitives, PDF renderers | `df5e599` |
| 0d | Database: `vfxnow_amc_v2` restored, env isolated | — |
| 0e | Insight → Overview against real data | `9e7593e` |
| X1 | Auth gate: proxy, session, signed-out screens | `64b8d32` |
| 1 | Operate → Today's movements | `5bd1cdb` |
| 2 | Reservations hub, record, check-in/out, order builder | `1844502`…`f16a39f` |
| 4 | Service Center | `eacc010` |
| 3 | Inventory | `bac454c` |
| 5 | Revenue | `e72e0da` |
| 6 | Clients | `7db30a8` |
| 1b | The last six rail placeholders: calendar, mobile, packages, cloud, services, maintenance | `eec1f6e` |
| — | MFA behind `AUTH_MFA` so the restored users can sign in | `4efa954` |
| — | Accounts record + the shared record kit (`components/record`) | `0312490` |
| — | Route smoke harness | `8e0889f`, `65dc8ce` |
| 6b | Lead record (v1's kanban dropped) | `6e8b194` |
| 5b | Invoice record; payments question settled | `893d1de` |
| 3b | Asset and Unit records | `810e9e4` |
| 5c | Purchase order record + receive flow | `89eaf8c` |
| 7a | Insights | `28dc77a` |
| 8a | Settings index + first six children | `dd8351c` |
| 3c | Vendor record | `2f58d8f` |
| 5d | Contract record, over both sale/RTO and Lease | `8b4ffb1` |
| 3d | Locations finished + the audit scan session | `a3e564b` |
| 7b | Notifications: producer, bell, feed, preferences, digest cron | `8b4ffb1`, `db7dbef`, `a29f43a` |
| 5e | Rate card record + bulk repricing moved onto it | `5124ac4` |
| 7c | Reports — index and six children | `a8aa184` |
| 8b | QuickBooks, Integrations and the OAuth routes | `05cab74` |

**`8b4ffb1` is mis-titled.** It reads "feat(revenue): build the contract record"
and does contain that, but it also swept up the whole notifications system and
Settings' documents and imports: three agents were building in parallel against
one git index, and staging and committing were two separate critical sections
rather than one. Nothing was lost and the code is unchanged; the history is
simply wrong about who did what, and rewriting it under agents still committing
would have risked their work. `b212d07` records the same thing from the other
side.

**X1 was pulled ahead of Stage 1.** Every ported action gates on
`requireAuth`/`requireEditor`, so any screen that writes returns `Unauthorized`
until a session exists — building a mutating screen first would have produced
one that could not be exercised at all.

**Every screen in the rail now renders** — 65 of 65 routes, against real data.
What remains is listed under "Still open" at the bottom of this document, and it
is verification, wiring and decisions rather than screens.

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

**Behavior:** opening a work order takes the unit out of bookable stock;
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
| X3 | **`MetricSnapshot` + nightly rollup** | Utilization delta, revenue vs target | See "Data gaps" |
| X4 | **API handlers** — `/api/v1/*`, integrations, cron | HubSpot / Zapier / JustCall inbound already flowing in v1 | Drop `cron/knowledge` and `cron/market-prices` (owner, 2026-08-12 — prices are maintained by hand); `cron/insights` needs its `refreshKnowledge` import removed |
| X5 | **Lint burn-down** | — | 116 inherited `any`s, scoped per ported path; clear a module as its screen is rebuilt |
| X6 | **Design asks** | — | SVG mark, light-ground logo, and sign-off on the invented `--danger`/`--success`/`--warning` tokens |

## Data gaps — where the design asks for what the database can't say

These need a product decision, not more code.

1. **Utilization delta ("+2.1 pts").** Nothing snapshots utilization over time.
   Needs X3, a nightly `MetricSnapshot` row. Until then the card shows the ratio.
2. ~~**Revenue target ("64% of target").** No target exists in the schema.~~
   **Narrowed 2026-08-03.** The mechanism was already ported and nobody had
   looked: `Setting` rows keyed `kpi_YYYY-MM`, with `getKpiTargets` and
   `saveKpiTargets` both present. Only the numbers are missing, and Reports now
   carries the form to enter them. This was never a schema gap — it was an empty
   table read as an absent feature.
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

7. **`AssetUnit.loanAmount` is the whole lease, copied onto every unit.** Found
   2026-08-03 while building the contract record. It is not a per-unit share of
   the financing, which is what the field name and the Stage 5 plan both imply.

   **Root cause is live code, not the import.** `lib/actions/leases.ts:148`
   stamps `loanAmount: data.totalAmount` onto every unit when a lease is
   created, and `:222`/`:239` reapply it on update. `amortizationEndDate` and
   `fundingBusiness` are likewise copies of the lease's own `endDate` and
   `lender`.

   **What it costs.** FCB REFI 2024 carries `totalAmount` $1,353,495.37 across
   555 units, each holding the full amount — summing them gives **$751,189,930**.
   Across the fleet, `lib/actions/exports.ts:977` does exactly that sum
   (`totalLoanBalance += Number(u.loanAmount)` over `ownershipType === 'LOAN'`)
   and would report **$762,539,766** against 765 units. The real figure — every
   lease's `totalAmount` added up — is **$1,765,175**. That is a 432×
   overstatement in a ported export, sitting behind a plausible label.

   **Why it isn't just a bad number.** Any roll-up of `loanAmount` across units
   is meaningless while the column is a denormalized copy. Per-unit financing
   cannot be recovered from what is stored: nothing records how the lease was
   apportioned, and dividing by unit count would be a guess dressed as a figure.

   **Not repaired.** Reported on the contract record instead. The decision the
   owner has to make is which the field is meant to be — a per-unit share
   (needs a real apportionment, and every writer above fixed) or a convenience
   copy of the lease total (then nothing may ever sum it, and the export is
   wrong). Same shape as the movement-log counters: a derived copy that no
   longer agrees with the thing it was copied from.

   Also: 15 of 20 leases carry `monthlyPayment` 0 — placeholders from
   `seedLeasesFromNotOwned` with no amount, payment or lender.

## Still open — 2026-08-03

**Every screen in the rail is built.** 65 of 65 routes render against the
restored database; `npm run build` and `tsc` are clean. Run
`scripts/smoke-routes.ts` — it is the live answer and beats this document.

What remains is not screens. It is verification, wiring, and decisions.

**Built but never exercised.** Not bugs — unfinished proof, and recording them
as shipped would bury that.
- `service/work-orders/[id]` — the `WorkOrder` table is empty, so it has never
  rendered against a real row. The Service Center's mutating lifecycle
  (open → file runs → close → unit status) is still unproven end to end.
- **Every write path built during the Stage 3–8 push.** Record payment, receive
  a PO, assign a lead, convert a lead, log activity, run an import. They render,
  gate and refuse correctly, but a server action cannot be driven from a script,
  and exercising them means writing real rows into restored customer data. The
  three importers were deliberately never run: testing a bulk loader against
  production data to see what happens is the one thing not to do with it.
- QuickBooks OAuth — `QB_CLIENT_ID`/`QB_CLIENT_SECRET` are blank. Every refusal
  path *was* exercised (`not_configured`, `invalid_state`, the session gate).
- The notification digest — composed and rendered end to end, and the send was
  made and refused, because `RESEND_API_KEY` is blank. Composition and routing
  are verified; delivery is not.

**Wiring that does not exist yet**
- **Nothing schedules the daily digest.** The handler exists and is callable.
- **The recurring-billing job does not run in v2.** 8 of 9 live recurring orders
  have a `nextBillingDate` in the past — $60,002/cycle of contracted income
  absent from the forecast. A job, not a report.
- **Zapier's inbound handler was never carried across** (X4), so a secret set on
  the Integrations screen has nothing listening. The screen says so.
- **The `documents/` tree was never copied to v2.** All 93 `Document` rows point
  at files that exist only on v1's box.

**Needs a decision, not more code**
- **`AssetUnit.loanAmount`** — data gap 7 above. A ported export overstates debt
  by 432×.
- **No invoice has ever been marked paid** (32 draft, 2 sent, 1 void). Reports
  moved to earned-revenue; confirm whether that is real or a restore artefact.
- ~~**Insights contradicts itself on market prices.**~~ **Settled 2026-08-12
  (owner): market prices are maintained by hand.** v1's price scraper is not
  ported — its sources were too inconsistent to price hardware against, so what
  is stored is what we have and it changes when somebody changes it. `cron/
  market-prices` is a decision now, not an outstanding task; do not port it.

  That retired the contradiction rather than tuning it. The scraper stamped its
  origin into `marketPriceSource`, so `lib/market-price.ts` is the one place
  that says what makes a price worth acting on: a figure a person entered, not
  one a crawler landed on. 113 of the 114 are the latter — all written in a
  single run on 2026-02-20, which is why every one of them tripped the old
  30-day rule.

  Insight 10a no longer asks for a refresh no job can perform; 10b and 10c are
  gated on confirmed prices. High-priority pricing insights fell from **55 to
  1**, the survivor being the one asset priced by hand. 10c also refuses a
  suggestion above 5× the current rate — the price is what is wrong at that
  point, not the rate. The pricing report's separate 30-day rule was folded into
  the same definition rather than left to drift.
- **The default rate card would reprice laptops ~4×**, and prices 1 of 30
  categories. Decide whether the card or the catalog is right before anyone
  uses the bulk apply.
- **Four units are retired and bookable at once** — the fleet is offering
  hardware the record says has left.
- **HubSpot's outbound half is live**: setting a token starts pushing deals from
  a restored database immediately.
- **Send-invoice was not built.** With mail off it would flip DRAFT→SENT and log
  a warning, leaving the app claiming money was asked for that never was.
- **MFA re-enrolment** across all accounts, once email and the key are settled.

**Cross-cutting:** X3 (`MetricSnapshot` rollup), X4 (API/cron handlers),
X5 (lint burn-down), X6 (design asks: SVG mark, light-ground logo, sign-off on
the invented `--danger`/`--success`/`--warning` tokens).

**Owner's call, still pending:** the movement-log schema change (drop the three
counters, make `Checkout` the append-only truth) and the nav label renames.

## Suggested order

X1 ✅ → Stage 1 ✅ → Stage 2 → Stage 4 → Stage 3 → Stage 5 → Stage 6 → Stage 7 →
Stage 8, with X2 alongside each merge and X3 before Overview is called final.

Rationale: auth first, because nothing that writes works without it and the
instance already carries real customer data on the LAN. Then the queue, which
is read-only and proves the Operate cluster end to end. Then Reservations, which
now carries the check-out/check-in flow the Desk was going to hold, and is the
hub the whole app orbits. Service Center stays ahead of Inventory because the
record's "flag for service" path depends on it.
