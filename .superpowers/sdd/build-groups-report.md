# Build groups: v1 -> v2 gap report

Base note: the worktree was created on the scaffold commits, not feat/design-tokens; I reset it to feat/design-tokens (0834eb8) before starting. Scope was narrowed by the coordinator to what the user can see; backend that already exists was not re-ported.

## Gap table (v1 behaviour -> v2)
| v1 behaviour | v2 | Where |
|---|---|---|
| Data: ReservationItem.isGroup, parentId reuse | HAS | prisma/schema.prisma:1243; prisma/manual/2026-10-19-sales-features.sql |
| Reservation.hideBuildPartPrices column | HAS | schema.prisma:1144; same SQL file |
| Pure math (rollup, per-machine qty, rescale, checkout lines, arrange) | HAS | src/lib/pricing/build-groups.ts + .test.ts |
| Actions: add group, group qty, part qty, move in/out, duplicate, toggle | HAS | src/lib/actions/build-groups.ts |
| Add part to a build (asset/service/manual) | HAS | AddLine `group` prop, order-stage addOrderLine groupId |
| Order page UI: add build, machines, part editor, move select, duplicate, hide-prices toggle | HAS | components/orders/build-groups.tsx, components/reservations/record-cards.tsx |
| Nested-dialog bug (1d3e8bd) | N/A: v2 uses inline forms, no dialog nesting | |
| Totals/tax/margin without double counting | HAS | reprice() in actions; margin.ts/dashboard.ts/order-builder.ts filters |
| Duplicate order keeps groups | HAS | lib/orders/duplicate.ts; package copy in reservations.ts |
| Invoice from groups | HAS | actions/invoices.ts:558 |
| Quote PDF | HAS | lib/documents/signed-quote.ts (arrangeBuildGroups) |
| Online quote, spec-list when prices hidden | HAS | actions/quote-tokens.ts, components/quote/quote-portal.tsx |
| Start Preparing + stock checkout before completion | HAS (via v2 lifecycle) | prepareOrder; shipOrder/activate gate on handoverShortfall (lib/orders/handover.ts), which counts group parts (assetId set) and skips headings; maybeAutoInvoice uses isCheckoutLine |
| Reorder arrows (c06a7e3) | WAS MISSING -> BUILT | moveOrderLine action, MoveLineArrows, wired in record-cards |
| Build creation inside the New-order builder form (v1 reservation-form) | MISSING, not built (out of narrowed scope) | builds are added from the order page |
| v1 proposal page / order-detail PDF | No v2 equivalent screens; nothing to port | |

## What I changed
- `movedWithin` pure helper (+ test) in src/lib/pricing/build-groups.ts.
- `moveOrderLine` server action (requireEditor, SALE only, not on closed orders, renumbers the sibling run, never reprices) in src/lib/actions/build-groups.ts.
- `MoveLineArrows` component; arrows on every top-level line of a sale and on a build's parts (parts travel with their build as children).
Order is presentation only, so no totals are touched.

## SQL needed
None. (The earlier isGroup / hideBuildPartPrices columns are already in prisma/manual/2026-10-19-sales-features.sql; apply that if not yet applied.)

## Verification
- `npx tsc --noEmit`: no errors in touched files; only pre-existing `RouteContext` errors in src/app/api/requirements (need next typegen).
- eslint on touched files: clean.
- `npm test`: 498 tests, 498 pass (build-groups.test.ts now 8 tests incl. movedWithin).
- Not run in a browser; no database touched.

## Open questions
1. Sales completion: v1 blocked Complete Sale until stock was checked out; v2 gates Ship/Activate on scan-out instead (handoverShortfall). I kept v2's gate. Is that the desired equivalent?
2. Reorder is allowed after Preparing (presentation only), unlike structural edits. Conservative alternative: restrict to BUILD_EDITABLE_STATUSES.
3. Builds inside the New-order builder form are not offered; add if wanted.
4. Reorder is restricted to SALE orders.

## Round 2 (owner answers, 2026-10-20)
1. Complete gate: completeOrder now runs the same scan-out gate as ship/activate for SALE orders (gateApplies in src/lib/orders/handover-rules.ts; handoverShortfall counts build parts, skips headings). Refusal is a `blocked` outcome with move "complete", named in words by shortfallMessage; the order screen's Close order button opens the NotReady dialog ("Can't complete yet", lists each line missing, "Back to scanning"), as does the scan desk. No super-admin override for completing a sale (kept crisp; ship/activate overrides unchanged). Rentals/RTO/Flow/Cloud complete as before (their check-in rule). Tests: src/lib/orders/handover.test.ts, added to the npm test glob.
2. Reorder lock: REORDER_STATUSES = DRAFT, REVISION only, enforced in moveOrderLine and used to hide the arrows. Test added.
3. No change to the New-order builder.

### Who may edit what (BUILD_EDITABLE_STATUSES = DRAFT, QUOTE_SENT, REVISION, APPROVED) - OWNER DECISION
| Action | Allowed statuses |
|---|---|
| moveOrderLine (reorder) | DRAFT, REVISION |
| addBuildGroup, setBuildGroupQuantity, setBuildPartQuantity, moveLineToBuild, duplicateBuildGroup | DRAFT, QUOTE_SENT, REVISION, APPROVED (unchanged) |
| setHideBuildPartPrices | any status (SALE only; no status check) |
| Add part / remove part / set part price (addOrderLine, removeOrderLine, setLineRate) | the generic line editor's rules, not the build list |
So after a quote is sent, builds, quantities and part moves can still change in QUOTE_SENT/APPROVED, and the hide-prices toggle at any time. Not changed; decide whether these should lock like reorder.

Verification: tsc clean (apart from pre-existing RouteContext), eslint clean, npm test 509/509.
