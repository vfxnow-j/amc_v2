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

Everything else in the rail renders a placeholder that names its v1 source.

---

## Stage 1 — Desk (check-out / check-in)

The operational core, and the merge with the most value: three v1 routes
(`checkout`, `checkin`, `checkouts`) become one two-mode screen. v1's `checkin`
is already 499 lines with a barcode scanner; treat it as the reference for
behaviour, not for layout.

**Route:** `/dashboard/desk`, redirects from all three v1 paths.

| Card | Contents | Source |
|---|---|---|
| Mode switch | Check-out / Check-in segmented control; scanner always live | new |
| Scan well | Barcode input focused by default, `html5-qrcode` fallback | `components/scanner` |
| Order context | Client, window, what's expected on this order | `Reservation` + items |
| Line table | Unit · Asset · Expected · Scanned · State, ~30px rows | `ReservationItemUnit` |
| Exceptions | Unexpected unit, wrong order, already out, damaged | `actions/checkouts` |
| Flag for service | Opens a `WorkOrder` inline, carrying reservation + unit | **blocked on Stage 4** |
| Sign-off | Signature capture + delivery note PDF | `signature-dialog`, `delivery-note-pdf` |

**Decisions:** check-in and check-out are required steps (your call) — so the
screen must make skipping impossible rather than merely discouraged. The "flag
for service" path lands disabled until Stage 4, then switches on.

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
| Unit inspector | Serial, condition, service history, current location |
| Service tab | "Service · 2" — work orders raised from this order (Stage 4) |
| Billing | Invoices raised, payments, QuickBooks sync state |
| Documents | Proposal, agreement, delivery note — signed copies retained |
| Activity | `StatusHistory` + `AuditLog` |

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
5. **Per-page nav counts** are unimplemented rather than faked; cluster counts in
   `lib/nav/counts.ts` are still the reference's illustrative figures and must be
   replaced with real queries.

## Suggested order

Stage 1 → X1 → Stage 2 → Stage 4 → Stage 3 → Stage 5 → Stage 6 → Stage 7 → Stage 8,
with X2 alongside each merge and X3 before Overview is called final.

Rationale: the Desk is where the intuitive check-in/check-out matters most, and
it exercises the shell, the scanner and the action layer in one screen. Auth
lands immediately after, before the instance carries live customer data any
further. Service Center is pulled ahead of Inventory because the Desk's
"flag for service" path depends on it.
