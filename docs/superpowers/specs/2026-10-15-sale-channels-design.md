# Sale channels — design

Status: revised 2026-10-15 after owner feedback, awaiting approval. Supersedes the money and
buyer parts of `docs/ebay-orders.md`; its returns, unit-status and guard rules still stand.

## The three channels

"New order → Sale" asks where the hardware is going:

| Channel | Order type | What it is |
| --- | --- | --- |
| Customer | `SALE` (existing) | A client sale: client account, quote, invoice, billing. |
| eBay | `EBAY` (new) | Sold on eBay. The buyer paid eBay, not us. |
| Other | `OTHER` (new) | Leaves inventory without a client. Either a sell-off, or a donation or recycling. |

`RENTAL`, `RENT_TO_OWN` and `CLOUD` are unchanged.

## Shared rules

- Lifecycle: `DRAFT → PREPARING → SHIPPED`, then the close step. No quote, no approval.
- Billing: `notBilled: true` on eBay and Other, so they never reach the billing run.
  Customer keeps its invoice path.
- Returns: one `returnSale` action for Customer and eBay, per `docs/ebay-orders.md`.
  Other has no return: a donation or recycling is final.
- Shipping: the existing shipping card. Optional for Other ("pick up" is allowed).
- The close step applies the outcome. Sold outcomes mark units `SOLD` through
  `completeSale`. Donations and recyclings retire the unit with its disposition instead.

## Money: sold and margin

Two figures run through every report:

| Figure | Meaning |
| --- | --- |
| **Sold** | What the sale brought in: the order total from line prices, less any refund. Zero for a donation or recycling. |
| **Margin** | Sold − fees − cost basis. The measure of what the sale actually earned. |

Fees are the costs of making the sale: card processing, eBay's cut, shipping we paid,
recycler charges. Margin is where they land. Net revenue is not a separate figure; sold
already reads as the net view, and fees show up in margin.

Columns on `Reservation` (all nullable, no backfill):

- `externalRef String?` — channel sale or order number, any sale type
- `buyerName String?`
- `channelName String?` — free text, required for Other ("Craigslist", "Local recycler")
- `disposition` — Other only, reusing the existing disposition enum (Sold off, Donated,
  Recycled, Other)
- `feesAmount Decimal? @db.Decimal(12,2)`
- `feesEstimated Boolean @default(false)`
- `refundedAmount Decimal? @db.Decimal(12,2)`, `refundedAt DateTime?`

`payoutAmount` from the earlier spec is dropped. Fees replace it.

### Customer

- Sold is the order total.
- Card processing defaults to a rate: `feesAmount = sold × card_processing_rate / 100`,
  from a new Setting row, `feesEstimated: true`. Typing the actual fee overwrites it and
  clears the flag. The rate is a Setting the owner sets; until it is set, no fee is
  estimated, rather than a guessed figure.
- Shipping we paid is typed on the order when known and added to fees.
- Margin shows beside sold on the order and in reports.
- Invoice and billing are unchanged.

### eBay

- `feesAmount` defaults to `sold × ebay_fee_rate / 100` (Setting, 13).
  `feesEstimated: true` until the owner types the real fee from the eBay statement.
- Margin is shown beside the fee, labelled "estimated" until the statement is entered.

### Other

- **Sell off**: sold is the amount received. Units become `SOLD`, like any sale, and feed
  sold and margin reports.
- **Donated or recycled**: sold is zero. Units retire with that disposition, not `SOLD`,
  and do **not** feed sold or margin reports. They appear on the existing Sold & Disposal
  report, which already lists non-sold exits from the fleet.
- Fees are optional for every Other outcome: recycler charges, shipping we paid, platform
  fees. Blank means none.
- `channelName` is required so reports can group by where it went.

## Entry points

- New order → **Sale** → **Customer / eBay / Other**.
- Customer: the existing new-order flow, with a shipping-cost field.
- eBay: sale number (optional), buyer name, sale amount, ship-to, fee (optional, estimated
  if blank).
- Other: outcome (sell off, donated, recycled, other) required, channel name required, sale
  amount (zero unless selling off), buyer name, ship-to, fees (optional).

## Numbering

eBay keeps `EBAY-{YYYY}-{SEQ}`. Other gets `OTHER-{YYYY}-{SEQ}`, so disposals are not
stamped `RES-`.

## Testing

- Customer: card fee is the rate × sold while the rate is set; no estimate while it is blank;
  typed fee overwrites the estimate; margin = sold − fees − cost basis.
- eBay: estimated fee is 13% of sold until overwritten; margin follows the typed fee.
- Other sell-off: units become `SOLD` on close and feed sold and margin reports.
- Other donation or recycling: units retire with their disposition, never `SOLD`, and do not
  appear in sold or margin reports, only in Sold & Disposal.
- Returns on Customer and eBay: refund reduces sold; a damaged unit creates a
  `MaintenanceRecord`.
- eBay and Other never create an invoice or appear on the billing run.

## Open for the owner

1. Set `card_processing_rate` in Settings. Until it is set, Customer card fees are not
   estimated.
2. Confirm the reading: sold and margin are the report figures, with fees inside margin and
   no separate net.
