import type { Role } from "@/lib/roles";

/**
 * What tiles exist, what each one is called, and how big it may be.
 *
 * **This module is pure and client-safe, and that is not a style preference.**
 * The tile picker, the edit-mode canvas and the settings screen are all client
 * components, and all three need to know a tile's title, blurb and size
 * bounds. If that knowledge lived next to the components that render the
 * tiles, importing it from the client would drag `lib/prisma` — and with it
 * the pg driver — into the browser bundle, where it fails on `dns`.
 * `lib/queries/range.ts` carries the same warning for the same reason.
 *
 * So the split is:
 *
 * - **here** — ids, categories, copy, geometry, role access. No imports that
 *   reach the database, and no JSX.
 * - **`components/dashboard/tiles/registry.tsx`** — server-only, and the sole
 *   place a tile id becomes a component. It is typed `Record<TileId, …>`, so
 *   adding an id below without wiring it there is a compile error rather than
 *   a blank square in production.
 *
 * Note also that this is a plain module and must stay one. A `"use server"`
 * file may export only async functions: putting a const table in one
 * typechecks, lints and runs in dev, then fails the production build.
 * `lib/settings/pages.ts` records the same trap.
 */

/* ── Ids ─────────────────────────────────────────────────────────────────── */

/**
 * Every tile the dashboard can place.
 *
 * The first seven were the fixed dashboard, lifted as-is. The rest arrived in
 * two waves and the difference between them is worth knowing when adding the
 * twenty-third: the **reuse wave** is tiles over queries another screen already
 * runs, which cost a component and nothing else; the **new-query wave** needed
 * a query written for them, and each of those carries a caveat in its copy
 * about what the schema can and cannot answer.
 *
 * Ids are persisted in `DashboardLayout.tiles` and in the seeded templates, so
 * they are a data format: rename one and every saved layout loses a tile.
 * Prefer adding a new id and dropping the old one on read.
 */
export type TileId =
  // The original seven.
  | "kpis"
  | "revenue-by-type"
  | "top-items"
  | "idle-items"
  | "due-back"
  | "maintenance"
  | "decisions"
  // Reuse wave: existing queries, new components.
  | "outgoing"
  | "incoming"
  | "billing-book"
  | "purchase-orders"
  | "year-to-date"
  | "recurring-health"
  | "rate-health"
  | "data-flags"
  // New-query wave: logistics, over existing columns and no new schema.
  | "untracked-shipments"
  | "delivery-mix"
  | "shipping-margin";

/* ── Shape ───────────────────────────────────────────────────────────────── */

/**
 * The grid the read view and the edit canvas both draw on.
 *
 * Read mode is server-rendered plain CSS Grid and edit mode is a drag surface;
 * they are only pixel-identical if they agree on these three numbers, so the
 * numbers live in the one module both sides can import. A tile's rendered
 * height is `h * rowHeight + (h - 1) * gap`.
 */
export const TILE_GRID = {
  columns: 12,
  rowHeight: 40,
  gap: 12,
} as const;

export type TileSize = { w: number; h: number };

/**
 * How tiles are grouped in the picker. Ordered; the picker reads this order.
 *
 * The categories are questions a person has, not parts of the schema. "Money in
 * and out" is not "invoices and purchase orders" because somebody looking for
 * what they are owed is not looking for a table name — and the two directions
 * belong together, since the answer to "can we buy this" is both of them.
 */
export type TileCategory =
  | "How we are trading"
  | "Money in and out"
  | "The fleet"
  | "Getting it there"
  | "Needs a person";

export const TILE_CATEGORIES: readonly TileCategory[] = [
  "How we are trading",
  "Money in and out",
  "The fleet",
  "Getting it there",
  "Needs a person",
];

/** Who may place, and see, a tile. Mirrors `SettingsAccess` deliberately. */
export type TileAccess = "everyone" | "admin";

export type TileMeta = {
  id: TileId;
  title: string;
  /** One line in the picker. Says what the tile answers, not what it is. */
  blurb: string;
  category: TileCategory;
  /** Grid units. `default` is what the picker places; the rest are clamps. */
  size: { default: TileSize; min: TileSize; max: TileSize };
  access: TileAccess;
  /**
   * Whether the tile's figures change with the header's range control.
   *
   * There is exactly one range control, in the page header, and its value
   * travels in the URL. Per-tile filters are impossible by construction: a
   * tile is a Server Component rendered on the server and handed to the client
   * canvas as finished UI, so the canvas has no data to re-filter. This flag
   * is how the picker tells the truth about which tiles that control moves.
   */
  readsRange: boolean;
};

/* ── The catalogue ───────────────────────────────────────────────────────── */

/**
 * Default sizes are provisional: they were set from the height each card
 * renders at on today's fixed dashboard, not measured against the grid. They
 * are layout defaults a user immediately overrides, so an approximate one is
 * cheap — but nothing here should be read as a measurement.
 *
 * Every tile is `access: "everyone"`, because every one of them is on the
 * dashboard today and visible to everyone who can sign in. Narrowing that
 * would be a policy change made silently in a refactor. The admin-only tiles
 * arrive with the money views that have not been built yet.
 */
export const TILE_CATALOG: Record<TileId, TileMeta> = {
  kpis: {
    id: "kpis",
    title: "Headline figures",
    blurb:
      "Utilization, revenue earned, units on rent, and whether anything is overdue.",
    category: "How we are trading",
    size: {
      default: { w: 12, h: 2 },
      min: { w: 6, h: 2 },
      max: { w: 12, h: 3 },
    },
    access: "everyone",
    readsRange: true,
  },
  "revenue-by-type": {
    id: "revenue-by-type",
    title: "Revenue by order type",
    blurb:
      "Where the money came from — rental, sale, rent-to-own and cloud, earned and open.",
    category: "How we are trading",
    size: {
      default: { w: 12, h: 4 },
      min: { w: 6, h: 3 },
      max: { w: 12, h: 6 },
    },
    access: "everyone",
    readsRange: true,
  },
  "top-items": {
    id: "top-items",
    title: "Earning most",
    blurb: "The hardware carrying the business, ranked by what it was booked at.",
    category: "The fleet",
    size: {
      default: { w: 6, h: 7 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 12 },
    },
    access: "everyone",
    readsRange: false,
  },
  "idle-items": {
    id: "idle-items",
    title: "Never booked",
    blurb: "Capital sitting still — assets with units in the fleet and no order line.",
    category: "The fleet",
    size: {
      default: { w: 6, h: 7 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 12 },
    },
    access: "everyone",
    readsRange: false,
  },
  "due-back": {
    id: "due-back",
    title: "Due back & overdue",
    blurb: "Units out past their window, and the ones coming back today.",
    category: "Needs a person",
    size: {
      default: { w: 7, h: 9 },
      min: { w: 5, h: 5 },
      max: { w: 12, h: 16 },
    },
    access: "everyone",
    readsRange: false,
  },
  maintenance: {
    id: "maintenance",
    title: "In service",
    blurb: "What is broken, what is at RMA, and what is about to fall out of cover.",
    category: "Needs a person",
    size: {
      default: { w: 5, h: 5 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 10 },
    },
    access: "everyone",
    readsRange: false,
  },
  decisions: {
    id: "decisions",
    title: "Needs a decision",
    blurb: "Expiring quotes and ageing invoices — the calls nobody has made yet.",
    category: "Needs a person",
    size: {
      default: { w: 5, h: 4 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 8 },
    },
    access: "everyone",
    readsRange: false,
  },

  /* ── Reuse wave ──────────────────────────────────────────────────────── */

  outgoing: {
    id: "outgoing",
    title: "Going out",
    blurb: "Orders due out of the door with units nobody has pulled yet.",
    category: "Needs a person",
    size: {
      default: { w: 6, h: 8 },
      min: { w: 5, h: 5 },
      max: { w: 12, h: 16 },
    },
    access: "everyone",
    readsRange: false,
  },
  incoming: {
    id: "incoming",
    title: "Coming back",
    blurb: "Orders with units still out, ordered by how late they are.",
    category: "Needs a person",
    size: {
      default: { w: 6, h: 8 },
      min: { w: 5, h: 5 },
      max: { w: 12, h: 16 },
    },
    access: "everyone",
    readsRange: false,
  },
  "billing-book": {
    id: "billing-book",
    title: "How the book bills",
    blurb:
      "What bills again on its own, what somebody has to raise, and what never bills.",
    category: "How we are trading",
    size: {
      default: { w: 12, h: 4 },
      min: { w: 6, h: 3 },
      max: { w: 12, h: 6 },
    },
    access: "everyone",
    readsRange: false,
  },
  "purchase-orders": {
    id: "purchase-orders",
    title: "On order",
    blurb: "What has been committed to vendors and hasn't arrived.",
    category: "Money in and out",
    size: {
      default: { w: 4, h: 5 },
      min: { w: 3, h: 4 },
      max: { w: 12, h: 8 },
    },
    access: "everyone",
    readsRange: false,
  },
  "year-to-date": {
    id: "year-to-date",
    title: "This year so far",
    blurb: "Revenue earned since January, and how much of the fleet is out.",
    category: "How we are trading",
    size: {
      default: { w: 4, h: 5 },
      min: { w: 3, h: 4 },
      max: { w: 12, h: 8 },
    },
    // Fixed to the calendar year on purpose. The header's range control moves
    // the tiles that answer "how are we trading now"; this one answers "how has
    // the year gone", and a year that changed length with a segmented control
    // would be a different question wearing the same title.
    access: "everyone",
    readsRange: false,
  },
  "recurring-health": {
    id: "recurring-health",
    title: "Recurring billing",
    blurb: "Live cycles, and the ones the billing run silently skips.",
    category: "How we are trading",
    size: {
      default: { w: 4, h: 5 },
      min: { w: 3, h: 4 },
      max: { w: 12, h: 8 },
    },
    access: "everyone",
    readsRange: false,
  },
  "rate-health": {
    id: "rate-health",
    title: "Rates to review",
    blurb: "Assets whose rate is out of step with what the hardware cost.",
    category: "The fleet",
    size: {
      default: { w: 5, h: 5 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 8 },
    },
    access: "everyone",
    readsRange: false,
  },
  "data-flags": {
    id: "data-flags",
    title: "Doesn't add up",
    blurb: "Records that disagree with each other, and facts nobody has entered.",
    category: "Needs a person",
    size: {
      default: { w: 5, h: 6 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 12 },
    },
    access: "everyone",
    readsRange: false,
  },

  /* ── Getting it there ────────────────────────────────────────────────── */

  /**
   * The whole Logistics group reads fourteen columns on `Reservation` and adds
   * no schema. One method, one courier, one tracking number and one cost per
   * direction per order is everything there is: no parcel record, no weight, no
   * dimensions, no carrier rate. Every blurb says so, because a tile that
   * implied otherwise would be read as a shipping system.
   */
  "untracked-shipments": {
    id: "untracked-shipments",
    title: "Untracked shipments",
    blurb:
      "Shipped by courier with no tracking number — nobody can say where the kit is.",
    category: "Getting it there",
    size: {
      default: { w: 6, h: 7 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 12 },
    },
    access: "everyone",
    readsRange: false,
  },
  "delivery-mix": {
    id: "delivery-mix",
    title: "How the kit moves",
    blurb:
      "Van, courier or the client's own hands — and the live orders that say neither.",
    category: "Getting it there",
    size: {
      default: { w: 4, h: 7 },
      min: { w: 3, h: 5 },
      max: { w: 12, h: 12 },
    },
    access: "everyone",
    readsRange: false,
  },
  "shipping-margin": {
    id: "shipping-margin",
    title: "What shipping makes",
    blurb:
      "What shipping costs against what it's billed at. Not a rate comparison.",
    category: "Getting it there",
    size: {
      default: { w: 5, h: 6 },
      min: { w: 4, h: 4 },
      max: { w: 12, h: 10 },
    },
    access: "everyone",
    readsRange: false,
  },
};

/** Declaration order, which is also the reading order of the default layout. */
export const TILE_IDS = Object.keys(TILE_CATALOG) as TileId[];

/**
 * What a user sees before they have reshaped anything, and what the seeded
 * "Everything" template is made of. Top to bottom: how we are trading, where
 * that money came from, what the fleet is doing, what needs a person.
 *
 * Deliberately still the original seven, and not every tile in the catalogue.
 * A default is what somebody who has never opened the picker gets, and
 * twenty-two tiles is not a default — it is a settings screen that renders
 * itself. The rest are placed on purpose, or arrive through a template.
 */
export const DEFAULT_TILES: readonly TileId[] = [
  "kpis",
  "revenue-by-type",
  "top-items",
  "idle-items",
  "due-back",
  "maintenance",
  "decisions",
];

/* ── Reading a saved layout ──────────────────────────────────────────────── */

/**
 * `DashboardLayout.tiles` is JSON written by a browser and is never trusted.
 * An id that no longer exists — a tile that was renamed, or one that shipped
 * and was withdrawn — is dropped rather than rendered as a blank square.
 */
export function isTileId(value: unknown): value is TileId {
  return typeof value === "string" && value in TILE_CATALOG;
}

export function tileMeta(id: TileId): TileMeta {
  return TILE_CATALOG[id];
}

/** ADMIN and SUPER_ADMIN, matching `requireAdmin` in `lib/auth-utils`. */
function isAdminRole(role: Role): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Role gating has to happen at render as well as in the picker. A layout is a
 * saved list of ids: it can be seeded by an admin, or written while a user was
 * an admin and read back after they were demoted.
 */
export function canSeeTile(meta: TileMeta, role: Role): boolean {
  return meta.access === "everyone" || isAdminRole(role);
}

export function tilesFor(role: Role): TileMeta[] {
  return TILE_IDS.map(tileMeta).filter((meta) => canSeeTile(meta, role));
}

/** Geometry from a saved layout is clamped, not believed. */
export function clampTileSize(meta: TileMeta, size: TileSize): TileSize {
  const { min, max } = meta.size;
  return {
    w: Math.min(Math.max(Math.round(size.w), min.w), Math.min(max.w, TILE_GRID.columns)),
    h: Math.min(Math.max(Math.round(size.h), min.h), max.h),
  };
}
