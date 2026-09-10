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
 * This is a starter set: seven tiles, each backed by a query and a component
 * that already exist and already render on the dashboard today. The full
 * catalogue — roughly twenty-two, including the logistics and AR-aging waves —
 * is a later step, and every one of them is an id added here and an entry
 * added to the registry.
 *
 * Ids are persisted in `DashboardLayout.tiles` and in the seeded templates, so
 * they are a data format: rename one and every saved layout loses a tile.
 * Prefer adding a new id and dropping the old one on read.
 */
export type TileId =
  | "kpis"
  | "revenue-by-type"
  | "top-items"
  | "idle-items"
  | "due-back"
  | "maintenance"
  | "decisions";

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

/** How tiles are grouped in the picker. Ordered; the picker reads this order. */
export type TileCategory =
  | "How we are trading"
  | "The fleet"
  | "Needs a person";

export const TILE_CATEGORIES: readonly TileCategory[] = [
  "How we are trading",
  "The fleet",
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
};

/** Declaration order, which is also the reading order of the default layout. */
export const TILE_IDS = Object.keys(TILE_CATALOG) as TileId[];

/**
 * What a user sees before they have reshaped anything, and what the seeded
 * "Everything" template is made of. Top to bottom: how we are trading, where
 * that money came from, what the fleet is doing, what needs a person.
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
