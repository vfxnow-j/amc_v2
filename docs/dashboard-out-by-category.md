# Out by category — specification

Asked for by the owner, 2026-09-17:

> can we make sure the dashboard for business shows quantity of items out by category,
> i.e workstations, etc.

## What it answers

"How much of each kind of thing is out right now." The dashboard has twenty-three tiles and
not one of them groups the fleet by category: `top-items` ranks by revenue, `idle-items`
lists what has never booked, `rate-health` judges pricing. A person asking whether they can
promise four workstations next week has to leave the dashboard for the stock-count report
and add the rows up by eye.

The **Business** view is where it goes — `SEED_VIEWS[0]` in `lib/dashboard/views.ts`, the
fallback view and the one most people open.

## What counts as "out"

`CHECKED_OUT`, and nothing else.

This is the definition `lib/inventory/availability.ts` already carries and that Inventory's
Out view, the stock-count report and the asset record all read. The owner confirmed it
(2026-09-17) against the alternative of folding `RESERVED` in as "committed". Thirteen units
sit `RESERVED` today; counting them would make this tile disagree with every other screen
about the same word, which is worse than the tile being slightly conservative.

The denominator is `IN_FLEET` — `AVAILABLE`, `CHECKED_OUT`, `MAINTENANCE`, `RESERVED`
(`availability.ts:23`). Capacity that could earn. Retired and sold hardware is not fleet and
is not counted on either side.

So a row reads **141 of 379 workstations out, 37%**. The owner chose the denominator over a
bare count: a category's out figure means little without knowing how big the category is,
and 48 of 52 laptops out is a very different sentence from 48 of 520.

## The query

`getOutByCategory()` in `lib/queries/inventory.ts`, beside the other fleet tallies, wrapped
in React `cache()` per the registry's rule — a tile placed twice must not run its query
twice.

One `groupBy` over `AssetUnit` keyed on category and status, filtered to `IN_FLEET`. Returns
`{ category, out, fleet, share }[]` sorted by `out` descending, plus a total.

Two rules about which categories appear, and they are different rules:

- A category with **no units in the fleet at all** is dropped. `Motherboards` has none;
  a row of zeros is noise.
- A category with **units in the fleet but none out** is kept. `External Storage` reads
  0 of 2. "Nothing out" is an answer, and hiding it would make the tile silently
  incomplete.

Measured against the restored database, 2026-09-17: 17 categories, 13 with something out,
335 units out of 856 in fleet.

| Category | Out | Fleet |
| --- | --- | --- |
| Workstations | 141 | 379 |
| Graphics Cards | 53 | 174 |
| Laptops | 48 | 52 |
| Monitors | 38 | 111 |
| A/V Hardware | 26 | 45 |

## The tile

`OutByCategoryTile` in `components/dashboard/tiles/fleet.tsx`, beside `RateHealthTile`. A
Server Component like every other tile, registered in `tiles/registry.tsx` — the registry is
typed `Record<TileId, TileEntry>`, so adding the id without wiring the component is a
compile error rather than a hole on the dashboard.

Header states the total (`335 of 856 units out · 39%`) and links to
`/dashboard/reports/inventory`, which breaks the same numbers down per asset.

Each row is name, `out / fleet`, share, and a proportion bar. There is no bar primitive in
`tiles/parts.tsx` today, and `components/ui/progress.tsx` cannot be used — it is a client
component and this is server-rendered. A small server-rendered `Bar` is added to
`tiles/parts.tsx`, where the other shared tile pieces live, so the next tile that wants one
has it.

A Suspense fallback matching the real tile's height, per the registry's note that a skeleton
which reflows when data lands shoves its neighbours on a grid.

## Catalogue entry

New id `"out-by-category"` in `lib/dashboard/catalog.ts`:

| Field | Value |
| --- | --- |
| category | `The fleet` |
| access | `everyone` |
| readsRange | `false` |
| size | default 12 × 6, min 6 × 4, max 12 × 10 |

`readsRange: false` is deliberate. Unit status is a right-now fact; there is no historical
status to filter. A tile that moved with the header's range control would be lying about
what the control did to it.

Widths come from the divisors of the twelve-column grid, per the catalogue's note that a 5-
or 7-wide default cannot close a row.

## Placement, and why it needs a migration

Added to the `business` seed in `views.ts` at `y: 30`, full width, below `sale-margin` and
`rate-health`. That keeps the view's stated rule — money at the top, fleet tiles at the
bottom explaining the figures above them.

**Editing the seed is not enough.** `store.ts:seedViews` writes the seeds only into an empty
table, guarded on the table being empty rather than on each key being present — the design
note in `views.ts` explains why, and it is correct. The `business` template is already a row
in this database, carrying ten tiles. It will never be re-seeded.

So a companion migration in `prisma/manual/`, matching `2026-09-09-dashboard-and-prospect.sql`,
appends the tile to the stored row. It must be idempotent: appending only if the id is not
already in the array, so running it twice does not place the tile twice.

Checked 2026-09-17: one user layout exists and it is on `engineering`, so no user's reshaped
copy of the Business view conflicts.

## What the tile does not say

It counts units, not orders and not money. A unit out on a free evaluation counts exactly
like one on a paying order, and a category can be fully out while earning nothing. The tile
says so in its footer rather than leaving it to be assumed — the same honesty
`rate-health` applies to its unrated assets.

It is also a snapshot with no history: there is nothing here to answer "is this more out
than last month", because unit status is not versioned.

## Interaction with the eBay work

`docs/ebay-orders.md` fixes a path that has never run: sold units today keep
`status: CHECKED_OUT` because the UI's close never calls `completeSale`. Verified against
this database, 2026-09-17 — **zero** units sit `CHECKED_OUT` on a completed sale or
rent-to-own order, so no figure in this tile is currently inflated by it. Once that fix
lands, sold hardware leaves the fleet on both sides of the ratio, as it should.
