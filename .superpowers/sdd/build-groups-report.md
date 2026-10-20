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

## Round 3: lock the build structure once the quote is sent
- One shared rule in src/lib/pricing/build-groups.ts: BUILD_EDITABLE_STATUSES = DRAFT, REVISION; buildStructureEditable(status); BUILD_LOCKED_MESSAGE ("Builds can only be changed on a draft or a revision. Request a revision to change this."). REORDER_STATUSES removed; the order page and every action use the helper.
- Now locked server-side: addBuildGroup, setBuildGroupQuantity, setBuildPartQuantity, moveLineToBuild, duplicateBuildGroup, moveOrderLine, setHideBuildPartPrices (previously no status check), and addOrderLine when it adds a part to a build (groupId). Still sale-only.
- UI: add build, hide-prices toggle, per-build machine/part quantity, move select, duplicate, add part, part price and arrows are hidden or disabled outside DRAFT/REVISION.
- Revision paths verified by reading the code, not run:
  (a) staff: the "Request revision" button (lifecycle MOVES on QUOTE_SENT and APPROVED) -> reviseOrder -> requestRevision sets status REVISION, actionRequired, and the note; status history recorded.
  (b) client: online quote "Request changes" -> requestQuoteChanges claims the link and sets REVISION with actionRequiredNote = the client's message, history "Client requested changes: ...", staff notified by email. No fix needed.
  REVISION offers "Send revised quote" and "Mark approved", neither touched by the lock, so re-sending and approval are unaffected.
- Not locked, owner may want to decide: removing a part from a build (RemoveLine -> removeOrderLine) and the generic setLineRate action are generic line edits that still work in QUOTE_SENT/APPROVED (the UI rate field for build parts is disabled when locked, the server action is not gated). The same holds for ordinary non-build lines, which were out of scope.
- Verification: tsc clean (pre-existing RouteContext only), eslint 0 errors, npm test 510/510.

## Round 4: the quote lock extends to every order and every quote-changing edit
Owner: "Only if in revision can a sent quote be changed." One rule in src/lib/orders/quote-lock.ts (pure; `quoteEditable`, `QUOTE_LOCKED_MESSAGE` = "This quote has been sent. Request a revision to change it.", `mayChange(category, status, type)`, `updateChangesQuote`), enforced by src/lib/orders/quote-lock-server.ts (`assertQuoteEditable`, `assertQuoteEditableForPackage`). The build helpers (`buildStructureEditable`, BUILD_EDITABLE_STATUSES, BUILD_LOCKED_MESSAGE) now delegate to it. PACKAGE_EDITABLE_STATUSES is deleted. Editable: DRAFT and REVISION; everything from QUOTE_SENT on is locked.

### GATED (refuse with the message above)
reservations.ts: updateReservationItemRate, updateReservationItemQuantity, updateReservationItemCategory, updateReservationItemDescription, updateReservationItemOneTime, addItemToReservation, addCloudHostToReservation, updateCloudHostInReservation, addServiceItemToReservation, reorderReservationItems, addReservationComponent, removeReservationItem, createPackage, updatePackage, deletePackage, setActivePackage, duplicatePackage, updateFlowLineBasis, updateFlowStepPct.
updateReservation: only when the call changes the quote: items, discount type/value, tax rate, delivery/return cost, shipping margin, start/end dates, RTO term, Flow term and knobs. A form posting unchanged values passes. Dates are ignored once SHIPPED/ACTIVE (those move only through Extend).
order-stage.ts (inherit from the above): removeOrderLine (incl. removing a part of a build), setLineQuantity, setLineRate, addOrderLine, and via updateReservation saveOrderDates, saveShipping and saveBillingTerms when they carry a changed price field. cloud-host.ts saveCloudHost/addCloudEnvLine and order-options.ts addOption/copyOption/renameOption/removeOption/chooseOption inherit from the package and line functions.
build-groups.ts: all seven (already gated in round 3).
sales.ts: updateSaleItemPrice, updateSaleItemQuantity, updateSaleItemMargin, applyMarginToAll, updateBuyoutCredit.
asset-build.ts configureLine (changes a line's price); package-templates.ts loadTemplateIntoOrder (adds lines).
UI: LinesCard hides every line edit, add, remove, configure and build control when locked; the options editor uses the same rule.

### DELIBERATELY NOT GATED (owner can see these)
- Operational: saveShipping details/tracking (only a changed delivery/return cost or margin is refused), notes, checkout/checkin/scan actions (assignUnit, unassignUnit, checkoutReservationItem, bulk and barcode variants, quickCheckout), prepare/ship/activate/complete/cancel/lose stage moves, invoicing and payments, saveBillingTerms for cycle/day/payment terms/not-billed, approveReservation, client approve/deny/request-changes in quote-tokens.ts, sendQuoteLinkEmail, generateQuoteToken.
- swapReservationItemUnit: swaps a physical unit of the same asset during fulfilment; price unchanged.
- Inline over-scan inside checkoutReservationItem ('expand' widens a line while scanning): operational, left as is.
- extendOrder (extends a live rental's end date, repriced): its own flow; dates are exempt for SHIPPED/ACTIVE in updateReservation.
- Client approval in quote-tokens.ts approveQuote: it reprices inline for the option/quantities the client chooses on the sent quote; that is the client's approval, not a staff edit.
- sales.ts: updateSaleItemCost, updateInternalCosts (internal cost, not the quote), togglePriceVerified, allocate/deallocate units, completeSale, convertReservationToSale/convertPartialReservationToSale/convertSaleToRental (type conversions create or restate orders; were unreachable from the UI, not checked).
- Flow/Cloud orders in ACTIVE: exempt from the lock (a live subscription keeps co-term adds and cloud hosts/env changes, and an ACTIVE order cannot be revised). Their SENT/APPROVED quote is locked like any other.
- Package-template admin (create/update template) and saveOptionAsTemplate: not order edits.

### Consequences the owner should know
1. Every existing order now in QUOTE_SENT, APPROVED, PREPARING, SHIPPED or ACTIVE (except live Flow/Cloud) is read-only for quote changes until revised.
2. Revision can only be requested from QUOTE_SENT or APPROVED (requestRevision). An order already in PREPARING, SHIPPED or ACTIVE has no revision path, so a rental/sale/RTO there can no longer gain a line, change a rate, quantity, discount or tax in the app. DECISION NEEDED: allow Request revision from PREPARING, or accept it.
3. The activate dialog's billing terms include tax and discount: changing them there on an APPROVED order is now refused with the revision message (unchanged values save fine). The fields are not hidden.
4. saveShipping is all-or-nothing: if the form also changes the delivery/return cost on a locked order, the whole save is refused.
5. The order screen's Add part to a build, price fields and removal buttons disappear when locked; scan hints still show.

Verification: tsc clean (pre-existing RouteContext only), eslint 0 errors, npm test 518/518 (new src/lib/orders/quote-lock.test.ts: status x category table, unchanged-form, Flow/Cloud exception, dates).
