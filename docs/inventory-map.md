# Inventory → Map (proposed and built 2026-09-26)

Owner's ask: "a simple map that allows us to see where hardware is in the world … open source globe/map
function > added to Inventory nav > Map … look around and have an idea at where our hardware is and have
another fun way to see lists of orders in areas but see how we reach in another aspect."

Status: **MVP built 2026-09-26** (branch `feat/inventory-map`), on the owner's decisions at the bottom. Not yet seen
drawing in a real browser — the box has no WebGL — so the globe, tiles, clusters and dark-mode swap still need a look.

### What the MVP has

- `/dashboard/map` (Inventory → Map). SUPER_ADMIN, ADMIN and STAFF only; VIEWER and FLOW_USER are sent to the
  dashboard, because the screen shows client addresses.
- **Inventory | Clients** layer toggle; the layers never mix. Inventory has **Now** and **Reach** modes, never mixed.
  - Now: units on an ACTIVE checkout at their order's delivery address — no client-address fallback — and stock
    (available / reserved / maintenance) at its location. A unit with two ACTIVE checkouts counts once, on the
    latest; a unit marked out with no ACTIVE checkout is counted as "not on an order" and listed as unplaced.
  - Reach: COMPLETED orders at their delivery address, with the units that went out or were sold on them. Sold
    units not linked to an order are counted in the coverage line, never placed.
  - Clients: each client with a sent quote or later (drafts don't count) at `Client.address`, else
    `billingAddress`; sized by order count, coloured by whether one is active. 83 such clients today.
- MapLibre GL 5 (client-only), globe by default with a Flat toggle, clusters summed by units, colours from the app's
  tokens re-tinted on theme and mode changes, OpenFreeMap positron / dark tiles.
- Always-visible coverage line; Unplaced tab linking each order, client or location to its record; reach strip
  (countries, states/provinces, cities) from placed rows only, counts only — no revenue. Stock is not reach.
- Offline geocoding (ZIP / Canadian FSA centroid, then city/state) into the v2-only `geocodes` cache; nothing leaves
  the box at runtime. "TBD" addresses are skipped. An editor can pin a not-found address by typing coordinates
  (`source=MANUAL`, never overwritten).
- v2-only tables `geocodes` and `postal_centroids` (`prisma/manual/2026-09-26-geocodes.sql`). The GeoNames data
  (CC-BY 4.0) lives in the gitignored `.superpowers/geonames/` and is loaded once by
  `scripts/load-postal-centroids.ts --apply` — the only step that downloads anything.

### Not in the MVP

- **On-save geocode hooks.** A new or edited address shows as "Not geocoded yet" until the script runs (below).
- Client Tracker temperature on the Clients layer; the status ring on clusters; linking unplaced orders straight to
  the Shipping card (they open the order); everything under Phase 2.

### Operational note

**Run `npx tsx scripts/geocode-addresses.ts --apply` after editing addresses and after every v1 sync.** The sync
writes addresses without any save hook, and there are no on-save hooks yet, so until the script runs a changed address
shows as unplaced. It is offline, idempotent, and never overwrites a manual pin.

## The data, measured 2026-09-26 (v2 database)

Every address is free text (`Reservation.deliveryAddress`, `Client.address`, `Client.billingAddress`,
`Location.address`, `Vendor.address`). Leads have no address. There is no lat/lng anywhere.

| What | Count |
|---|---|
| Orders with a delivery address | 24 of 152 |
| Units out on an ACTIVE checkout | 324 across 27 orders |
| …placeable from the order's delivery address | 7 |
| …placeable if the client's address is used as a fallback | 14 |
| Clients with any address | 18 of the 61 with a real order |
| Sold units traceable to an order with an address | 2 of 558 |
| Stock (available/reserved/maintenance) | all at VFXnow LA, Burbank |

Addresses are almost all US (CA first, then NY, IL, IN, CO, NJ, NV, LA, TX) plus one in BC, Canada. Most end in
a ZIP. Some say "TBD".

**The map is mostly empty until delivery addresses are filled in on active orders.** It must say so on screen,
with a coverage line ("Showing 14 of 324 units out — 310 have no address") and an **Unplaced** list that links to
each order's Shipping card for fixing. It never implies full coverage. That's the standing no-fabrication rule.

## Where a unit is

- **Out:** ACTIVE checkout → the order's delivery address. If that's missing, the client's address, marked
  "inferred". Customer pickup uses the client's address the same way.
- **In stock / reserved / maintenance:** the unit's location.
- **Sold (reach only):** `soldViaReservation` → that order's address, then the client's address.
- **Otherwise:** Unplaced.

## Choices (recommended)

- **Geocoding, offline:** parse the ZIP or Canadian postal code, then look up its centroid in an on-box table
  loaded from GeoNames (CC-BY), then fall back to city/state. There are about 40 distinct addresses in total, and
  ZIP-level accuracy is plenty for a globe. **Nothing leaves the box.**
- **Nominatim street-level:** optional, off by default. It sends client street addresses to the OpenStreetMap
  Foundation.
- **Manual pin correction:** stored `source=MANUAL` and never overwritten.
- **Cache table:** v2-only `geocodes`, keyed by the normalised address text. A v1 sync never writes it, and a
  changed address simply geocodes again.
- **Map library:** **MapLibre GL JS v5** (BSD). It has a native globe ↔ flat projection and GeoJSON clustering
  that sums units per cluster. Rejected: deck.gl (heavy), three-globe (no street basemap), Leaflet (no globe).
- **Tiles:** OpenFreeMap for now (free, no key; it sees viewers' map views, never client data). Self-hosted
  Protomaps PMTiles once v2 is on its domain.
- **Theming:** read the app's colour tokens at runtime and re-tint the map, so all 12 themes and light/dark
  match.

## Screen (MVP)

- **Layer toggle, Inventory | Clients (owner, 2026-09-26).** Inventory: hardware at delivery addresses and stock
  locations. Clients: each client at `Client.address` (else `billingAddress`), sized by order count, coloured by
  whether they have an active order, with the Client Tracker temperature as an option; side panel lists clients in
  view and links to their records. Only 18 of 61 clients with orders have an address today, so it gets the same
  coverage line and Unplaced list.

- **Route:** `/dashboard/map`, with an Inventory nav entry in `src/lib/nav/clusters.ts`. Page-level role check:
  it shows client addresses, so no VIEWER access.
- **Map:** globe by default with a Globe/Flat toggle. Clusters are sized by units and coloured by order type
  (plus stock), with a status ring.
- **Modes:** **Now** (units out + stock) and **Reach** (completed orders + sold). The two are never mixed.
- **Filters:** type, status, client, date range, and whether to include the client-address fallback.
- **Side panel:** the orders and units in view or in the clicked cluster, each linking to its order record.
- **Unplaced tab** and the always-visible coverage line.
- **Reach strip:** states or provinces, cities and countries served, with order and unit counts, from placed
  rows only.

**Phase 2:** drag-to-correct pins, opt-in street-level geocoding, self-hosted tiles, a state choropleth, a time
slider, arcs from Burbank, and mini-maps on order and client records.

## Build outline

- **`prisma/manual/2026-09-XX-geocodes.sql`:** additive, and a v2-only table so the sync never touches it.
  Creates `geocodes` and `postal_centroids`.
- **`src/lib/geo/`:**
  - `normalize.ts`: address key, postal code, TBD detection.
  - `geocode.ts`: `resolveAddress`: cache → postal → city/state → not found.
- **Scripts:**
  - `scripts/load-postal-centroids.ts`
  - `scripts/geocode-addresses.ts`: dry run by default. Run it after each v1 sync, because the sync bypasses
    save hooks.
- **`src/lib/queries/map.ts`:** server-only. Returns GeoJSON, the unplaced rows and reach aggregates.
- **`src/app/(shell)/dashboard/map/page.tsx`**, plus `src/components/inventory/map/` (map view, panel, reach
  strip, unplaced list).
- **On-save geocode hooks:** where delivery, client and location addresses are written.
- **Size:** MVP about 2–3 dev-days; phase 2 about the same again.

## Decisions for the owner

1. **Geocoding:** offline ZIP-level only (recommended), or also opt-in street-level through Nominatim (sends
   client addresses off-box)?
2. **Reach:** show sold/historical as reach, in its own mode? Only 2 of 558 sold units can be placed today.
3. ~~Client-address fallback~~ **Decided 2026-09-26: no.** Hardware is pinned only at a real delivery address
   (or its stock location). Instead, the owner asked for an **Inventory ↔ Clients toggle**: a Clients layer plots
   every client at its own address, to see the client base and the regions it covers ("cover a demographic for
   us"). The layers never mix; a client pin never stands in for where hardware is.
4. **Backfill:** will staff fill in delivery addresses on the 27 active orders? Without it the map is mostly
   empty.
5. **Tiles:** OpenFreeMap now, then self-hosted when on the domain?
6. **Revenue by region:** show it (placed orders only, labelled), or keep reach to counts?
