import "server-only";

import { Suspense } from "react";
import {
  IdleItemsCard,
  TopItemsCard,
} from "@/components/dashboard/item-cards";
import {
  CardSkeleton,
  MaintenanceCard,
} from "@/components/dashboard/maintenance-card";
import { DataFlagsTile } from "@/components/dashboard/tiles/flags";
import { RateHealthTile } from "@/components/dashboard/tiles/fleet";
import {
  DeliveryMixTile,
  ShippingMarginTile,
  UntrackedShipmentsTile,
} from "@/components/dashboard/tiles/logistics";
import { PurchaseOrdersTile } from "@/components/dashboard/tiles/purchasing";
import {
  RecurringHealthTile,
  YearToDateTile,
} from "@/components/dashboard/tiles/trading";
import {
  BillingBook,
  BillingBookSkeleton,
} from "@/components/orders/billing-book";
import {
  RevenueStrip,
  RevenueStripSkeleton,
} from "@/components/orders/revenue-strip";
import {
  DueBackCard,
  DueBackCardSkeleton,
} from "@/components/overview/due-back-card";
import { KpiRow, KpiRowSkeleton } from "@/components/overview/kpi-row";
import {
  DecisionsCard,
  SideCardSkeleton,
} from "@/components/overview/side-cards";
import {
  IncomingCard,
  OutgoingCard,
  QueueCardSkeleton,
} from "@/components/today/movement-cards";
import {
  TILE_CATALOG,
  type TileId,
  type TileMeta,
} from "@/lib/dashboard/catalog";
import type { Range } from "@/lib/queries/range";

/**
 * Where a tile id becomes a component.
 *
 * **Server-only, and the sole importer of tile components.** Every tile is a
 * Server Component that reads the database directly; the moment a client
 * module could reach this table, the pg driver would be pulled into the
 * browser bundle. That is why the copy, geometry and role access live apart,
 * in the pure `lib/dashboard/catalog.ts`, and why nothing in this file is
 * exported to the picker.
 *
 * The rendering pattern the dashboard follows:
 *
 *   the page reads the layout → maps each id through this table → renders each
 *   tile inside its own `<Suspense>` → hands the finished nodes to a client
 *   canvas that only positions them.
 *
 * **No tile data crosses the client boundary — only rendered UI.** Three
 * consequences worth stating out loud, because they are the design and not
 * limitations to be worked around later:
 *
 * 1. A per-tile client-side filter is impossible. There is one range control,
 *    it lives in the page header, and its value travels in the URL. A tile
 *    that responds to it says so via `TileMeta.readsRange`.
 * 2. A tile added during an edit session has no server-rendered node, so the
 *    canvas draws it as a labelled ghost until the layout is saved and the
 *    page re-renders. That is honest — the alternative is a client fetch per
 *    tile, which is the pg-in-the-browser problem again.
 * 3. Tiles placed twice, or tiles that share a query with another tile, must
 *    not run that query twice. The shared queries are wrapped in React
 *    `cache()` so a render pass runs each at most once.
 *
 * `Record<TileId, TileEntry>` is the point of the type: add an id to the
 * catalog and forget this file, and the build fails here rather than the
 * dashboard rendering a hole.
 */

/**
 * Everything a tile is allowed to know about the page it is on. One field, and
 * it should stay close to one: a tile that needs its own parameters wants to
 * be its own screen.
 */
export type TileContext = { range: Range };

/**
 * Server Components are async, and an async function is not a `ComponentType`.
 * Spelled out rather than reached for from React's types so the async return
 * is deliberate and visible.
 */
type TileComponent = (
  context: TileContext,
) => React.ReactNode | Promise<React.ReactNode>;

export type TileEntry = {
  meta: TileMeta;
  Component: TileComponent;
  /**
   * The Suspense fallback, as a node rather than a component. Every one of
   * these matches the real tile's height: a skeleton that reflows when the
   * data lands is worse than no skeleton, and on a grid it shoves its
   * neighbours too.
   */
  fallback: React.ReactNode;
};

export const TILE_REGISTRY: Record<TileId, TileEntry> = {
  kpis: {
    meta: TILE_CATALOG.kpis,
    Component: KpiRow,
    fallback: <KpiRowSkeleton />,
  },
  "revenue-by-type": {
    meta: TILE_CATALOG["revenue-by-type"],
    Component: RevenueStrip,
    fallback: <RevenueStripSkeleton />,
  },
  "top-items": {
    meta: TILE_CATALOG["top-items"],
    Component: TopItemsCard,
    fallback: <CardSkeleton rows={6} />,
  },
  "idle-items": {
    meta: TILE_CATALOG["idle-items"],
    Component: IdleItemsCard,
    fallback: <CardSkeleton rows={6} />,
  },
  "due-back": {
    meta: TILE_CATALOG["due-back"],
    Component: DueBackCard,
    fallback: <DueBackCardSkeleton />,
  },
  maintenance: {
    meta: TILE_CATALOG.maintenance,
    // Wrapped because `MaintenanceCard` takes an injectable `now` and nothing
    // else, so it shares no property with the tile context. The wrapper is the
    // seam: the tile gets the real clock, a test still gets to set one.
    Component: () => <MaintenanceCard />,
    fallback: <CardSkeleton rows={4} />,
  },
  decisions: {
    meta: TILE_CATALOG.decisions,
    Component: DecisionsCard,
    fallback: <SideCardSkeleton />,
  },

  /* ── Reuse wave ──────────────────────────────────────────────────────── */

  // The two movement queues are the Calendar screen's own components, placed
  // rather than reimplemented. They take no arguments and each fetches its own
  // side, which is exactly the tile contract — and it means the dashboard and
  // the Calendar can never disagree about what is late.
  outgoing: {
    meta: TILE_CATALOG.outgoing,
    Component: OutgoingCard,
    fallback: <QueueCardSkeleton title="Going out" />,
  },
  incoming: {
    meta: TILE_CATALOG.incoming,
    Component: IncomingCard,
    fallback: <QueueCardSkeleton title="Coming back" />,
  },
  // Likewise the billing book, which is the Orders hub's. It carries its own
  // card chrome rather than `Tile` — `bg-panel` against the tiles' `bg-tile`,
  // which resolve to the same colour today. Left alone deliberately: rewriting
  // a shared component to suit the dashboard would restyle the Orders screen as
  // a side effect, and the `--tile-*` axis exists precisely so that divergence
  // is a token change rather than a component fork.
  "billing-book": {
    meta: TILE_CATALOG["billing-book"],
    Component: BillingBook,
    fallback: <BillingBookSkeleton />,
  },
  "purchase-orders": {
    meta: TILE_CATALOG["purchase-orders"],
    Component: PurchaseOrdersTile,
    fallback: <CardSkeleton rows={3} />,
  },
  "year-to-date": {
    meta: TILE_CATALOG["year-to-date"],
    Component: YearToDateTile,
    fallback: <CardSkeleton rows={3} />,
  },
  "recurring-health": {
    meta: TILE_CATALOG["recurring-health"],
    Component: RecurringHealthTile,
    fallback: <CardSkeleton rows={3} />,
  },
  "rate-health": {
    meta: TILE_CATALOG["rate-health"],
    Component: RateHealthTile,
    fallback: <CardSkeleton rows={3} />,
  },
  "data-flags": {
    meta: TILE_CATALOG["data-flags"],
    Component: DataFlagsTile,
    fallback: <CardSkeleton rows={6} />,
  },

  /* ── Getting it there ────────────────────────────────────────────────── */

  "untracked-shipments": {
    meta: TILE_CATALOG["untracked-shipments"],
    Component: UntrackedShipmentsTile,
    fallback: <CardSkeleton rows={5} />,
  },
  "delivery-mix": {
    meta: TILE_CATALOG["delivery-mix"],
    Component: DeliveryMixTile,
    fallback: <CardSkeleton rows={6} />,
  },
  "shipping-margin": {
    meta: TILE_CATALOG["shipping-margin"],
    Component: ShippingMarginTile,
    fallback: <CardSkeleton rows={3} />,
  },
};

/**
 * One tile, in its own Suspense boundary.
 *
 * The boundary is per tile and never around a group. The revenue strip runs an
 * accrual calculation across every recurring order and the fleet tiles group
 * the whole order book; none of them may hold up the headline figures, and
 * none of them may hold up each other.
 */
export function renderTile(id: TileId, context: TileContext) {
  const { Component, fallback } = TILE_REGISTRY[id];

  return (
    <Suspense fallback={fallback}>
      <Component {...context} />
    </Suspense>
  );
}
