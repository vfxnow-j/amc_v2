# Scan cross-check and flagged orders — design

Date: 2026-10-23. Status: scan cross-check approved; order flags use proposed defaults (see Open defaults).

Two tracks, one migration. Track A makes every unit carry both a barcode and a serial. Track B lets any order be flagged for a reason, and filters the Orders page by flag.

## Track A — barcode + serial cross-check

### Rule
- `Asset` (catalog item) gets `requiresSerial Boolean @default(true)`. Cables, consumables and light items are set false. Existing inventoried items default to true.
- A unit is **complete** when `barcode` and `serialNumber` are both present, or when its item has `requiresSerial = false`.
- `AssetUnit` gets `dataFlag` (`MISSING_SERIAL | MISSING_BARCODE | MISMATCH`, nullable), `dataFlaggedAt`, `dataFlaggedById`. The flag is derived and stored so lists and gates can filter on it.
- `serialNumber @unique` stays as the backstop. Uniqueness is also checked up front so the user gets a message, not a database error.

### Module
`src/lib/scan/completeness.ts`:
- `checkUnit(unit)` returns `complete | missingSerial | missingBarcode`.
- `resolveGap(unitId, serial)` validates (trim, case-insensitive uniqueness), saves, clears the flag, and writes an audit entry.
- `checkMatch(unit, scannedSerial)` returns match or mismatch.

### Behavior
- Scan points that call it: receiving (PO), check-out and ship, check-in and return, audits, scan desk.
- Incomplete unit: a prompt asks for the serial ("Serial missing for <item>. Scan or type it"). Entering it saves immediately and the scan continues. **Skip** sets the flag and continues. Every skip is logged with user and time.
- Check-in and audits also accept the serial label. If it does not match the unit the barcode resolved to, the unit gets `MISMATCH` and a warning. Nothing is overwritten.
- Flagged units show a badge wherever they appear. Check-out and the ship gate refuse a flagged unit until it is fixed.
- `MISSING_BARCODE` cannot arise from scanning. It appears through receiving and the Missing data screen only.

### Missing data screen
Inventory → Missing data: every flagged unit, plus every existing incomplete unit, with inline serial entry. A one-off backfill script flags units already in the database. Run it only on request, as with other data scripts.

### Tests
`checkUnit` (exempt item, missing serial, duplicate serial, mismatch), `resolveGap`, and one scan-flow test per scan point.

## Track B — flagged orders

### Data
`OrderFlag` table, many per order: `orderId`, `category`, `reason` (code), `note`, `severity` (`INFO | ATTENTION | CRITICAL`), `ownerId`, `dueDate`, `raisedById`, `raisedAt`, `source` (`MANUAL | SYSTEM`), `resolvedAt`, `resolvedById`, `resolutionNote`. Flags are never deleted.

### Flags are cases (check → solve → close)
A flag opens a case that is worked until closed. Driving example: a return shipment is delayed mid-transit and the carrier cannot find the package, so we face a loss.
- **Exposure:** `exposureAmount` per flag. For lost or damaged units it defaults to the replacement cost of the units still out (purchase price + landed cost adjustment). The Dashboard tile and Orders filter can sort by money at risk.
- **Playbook per reason:** a checklist of steps (`OrderFlagStep`: label, done, doneBy, doneAt, note). Lost in transit: record carrier, tracking number and last scan; open a carrier trace; check declared value and insurance; set the claim deadline; file the claim and record the claim number. Other reasons get their own short playbooks, stored as data so they can be edited.
- **Outcome required to close:** found and received (units back to stock); carrier claim paid (amount recorded); client billed (invoice raised); written off (units set to Lost, asset retired, loss recorded on the order). Closing without an outcome is refused.
- **Units follow the case:** affected units are linked to the flag. While it is open they show In transit / Missing and cannot be rented. The outcome sets their final status.
- **Follow-up clock:** `nextActionDate` per open case. Past it with no activity, the case escalates on the Dashboard.
- **Scan-triggered resolution:** every scan point (the same hook as Track A) checks whether the scanned unit is linked to an open case, or is Missing, Lost or written off. If so, the scan stops on a prompt: "This unit is on an open case (<reason>, order #…). What do you want to do?"
  - Found: close the case and return the unit to inventory (prior status restored; if other units on the case are still missing, the case stays open for those).
  - Found but damaged: unit goes to the damage flow; outcome recorded as found-damaged.
  - Not part of this case: scan continues, case untouched.
  - Leave open with a note (for example "received at dock, not yet inspected").
  - For a unit already **written off**: Reinstate reverses the write-off, restores the unit and asset, and corrects the loss on the order. It requires a reason and is logged with the user.
  - If a carrier claim was already paid, the prompt warns first (claim number and amount) because a refund to the carrier may be due.
  - Every match is added to the case timeline (when, where, who scanned).
- Fields added to `OrderFlag`: `exposureAmount`, `nextActionDate`, `outcome`, `outcomeAmount`, `claimNumber`, `trackingNumber`, `carrier`, and a join to the affected units.

### Reasons (dialog)
- **Returns:** overdue return, partial return, return not responding, extension requested, extension unpaid
- **Condition:** damage reported, missing accessory or part, failed check-in inspection, cosmetic wear dispute
- **Payment:** payment overdue, card declined, deposit not received, credit hold, chargeback or dispute, tax-exempt certificate missing
- **Fulfillment:** stock shortage, substitute unit needed, build or config pending, on backorder, waiting on vendor, ship date at risk
- **Shipping:** carrier delay, lost in transit, wrong address, signature required, customs or international hold
- **Data:** missing serial, serial mismatch, unit swapped in the field
- **Client:** VIP, new client, high-value order, repeat late payer, special handling instructions
- **Compliance:** PO or contract mismatch, insurance certificate expired, ID or KYC check, approval needed
- **Sales:** quote in revision, price override, margin below floor, sale-to-rental conversion pending, warranty or RMA open
- **Other:** free text

### Auto-raised flags (system source, self-clearing)
1. Return date passed and the order is not checked in → overdue return.
2. A unit on the order has a Track A `dataFlag` → missing serial or serial mismatch.
3. Invoice past due → payment overdue.

All other flags are manual.

### Orders page
Flag icon with count on each row. Filter chips: Flagged, Not flagged, category, severity, Mine, Open/Resolved. They combine with the existing filters and are held in the URL. Dashboard gets a Flagged tile: open count by severity.

### Ship gate
A Critical open flag blocks shipping with a warning. The user may override, and the override is logged.

## Open defaults (change on review)
- Critical flag blocks shipping (alternative: warn only).
- Category list as above.

## Build plan
1. Single migration for both tracks (`requiresSerial`, `dataFlag*`, `OrderFlag`), done first to avoid `schema.prisma` conflicts. Restart the dev server after `prisma generate`.
2. Two agents in parallel, each in its own worktree: **A** Track A, **B** Track B. B's data-flag auto-rule depends on A's field, which the migration provides.
3. Review both, run `next build` before any restart, then merge.
