import type { Role } from "@/lib/roles";
import type { TileId } from "./catalog";

/**
 * Which dashboards exist, and who each one is for.
 *
 * A **view** is a `DashboardTemplate` row: a company-level list of tiles an
 * administrator maintains under Settings → Dashboards. A **layout** is one
 * user's reshaped copy of one view. Nobody edits the company template by
 * dragging; dragging writes a `DashboardLayout` row that belongs to you.
 *
 * The seeds below exist so the first person to open the dashboard after this
 * ships sees a dashboard rather than an empty grid and a form. They are written
 * once, into an empty table, and are ordinary rows from that moment on — an
 * administrator may rename, reorder, refill or delete any of them.
 *
 * **Re-seeding is guarded on the table being empty, not on each key being
 * present**, and that distinction is the whole design. Seeding per missing key
 * would make the default view undeletable: remove it, and the next page load
 * puts it back. An administrator who deletes every view gets the seeds again, which
 * is a recovery path rather than a contradiction.
 *
 * Pure and client-safe. `Role` is imported as a type only, so nothing here
 * reaches the database — the settings form needs these names for its role
 * picker and the settings form is a client component.
 */

/** A seeded tile: a bare id flows into the next free space, a placed one does not. */
export type SeedTile =
  | TileId
  | { id: TileId; x: number; y: number; w: number; h: number };

export type SeedView = {
  key: string;
  label: string;
  /**
   * Composed, not flowed. `layout.ts` will happily place a bare list of ids,
   * and the result is honest but ragged: it drops each tile into the next gap
   * that fits, so a row ends wherever the arithmetic lands. These three are
   * written out with coordinates instead, because a seeded dashboard is the
   * first thing anyone sees and "roughly arranged" reads as unfinished.
   *
   * The rule every row here keeps: **widths sum to exactly 12, and tiles
   * sharing a row share a height.** That is also why the catalogue's default
   * widths are drawn from {3, 4, 6, 8, 12} — the divisors of the grid. A 5- or
   * 7-wide default cannot close a row, and the 2-column remainder it leaves is
   * narrower than the narrowest tile, so nothing can ever fill it.
   */
  tiles: SeedTile[];
  /** Empty means everyone. Mirrors `DashboardTemplate.access`. */
  access: Role[];
  sortOrder: number;
};

const at = (id: TileId, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h });

/**
 * Three dashboards, named for the three jobs people do here rather than for
 * parts of the schema: **Business**, **Engineering**, **Logistics**.
 *
 * Each is meant to be read top to bottom and answer one person's morning
 * question. They deliberately overlap — `incoming` earns its place on both
 * Engineering and Logistics, because "what is coming back to the bench" and
 * "what is arriving" are the same rows seen by two people who want different
 * things from them. A tile is cheap; a dashboard someone has to translate is
 * not.
 *
 * What is NOT here is as deliberate. No tile appears on a view merely because
 * it exists: the catalogue holds 22 and these three use 20 placements across
 * 18 distinct tiles. `decisions` and `data-flags` are left to the picker
 * because they answer "what is wrong today", which is a fourth job and wants a
 * fourth dashboard rather than a corner of these.
 */
export const SEED_VIEWS: SeedView[] = [
  {
    key: "business",
    label: "Business",
    // Money first, and in the order the question is usually asked: how are we
    // doing, where did it come from, what is committed, what is owed, what is
    // it costing. The fleet tiles sit at the bottom because they explain the
    // figures above them rather than compete with them.
    tiles: [
      at("kpis", 0, 0, 12, 2),
      at("revenue-by-type", 0, 2, 12, 4),
      at("year-to-date", 0, 6, 4, 6),
      at("recurring-health", 4, 6, 4, 6),
      at("purchase-orders", 8, 6, 4, 6),
      at("billing-book", 0, 12, 12, 4),
      at("ar-aging", 0, 16, 6, 8),
      at("top-items", 6, 16, 6, 8),
      at("sale-margin", 0, 24, 6, 6),
      at("rate-health", 6, 24, 6, 6),
    ],
    access: [],
    sortOrder: 0,
  },
  {
    key: "engineering",
    label: "Engineering",
    // The week, then the bench, then the kit that will land on it. `idle-items`
    // closes the screen at full width because "never booked" is a slow question
    // — it is the one thing here nobody needs to act on this morning.
    tiles: [
      at("calendar-strip", 0, 0, 12, 4),
      at("bench-load", 0, 4, 6, 6),
      at("maintenance", 6, 4, 6, 6),
      at("due-back", 0, 10, 6, 8),
      at("incoming", 6, 10, 6, 8),
      at("idle-items", 0, 18, 12, 8),
    ],
    access: [],
    sortOrder: 1,
  },
  {
    key: "logistics",
    label: "Logistics",
    // `untracked-shipments` leads, and it is the reason this view exists: a
    // shipped order on a courier with no tracking number is a real fault that
    // nothing else in the app counts. Then the two directions of movement, then
    // what the moving costs.
    //
    // The ceiling this view cannot exceed, stated because the tiles say it too:
    // there is no Shipment model, no parcel, no weight, no dimensions and no
    // carrier rates. One method, one courier, one tracking number and one cost
    // per direction per order is the whole of what is stored.
    tiles: [
      at("untracked-shipments", 0, 0, 8, 8),
      at("delivery-mix", 8, 0, 4, 8),
      at("outgoing", 0, 8, 6, 8),
      at("incoming", 6, 8, 6, 8),
      at("shipping-margin", 0, 16, 6, 6),
      at("due-back", 6, 16, 6, 6),
    ],
    access: [],
    sortOrder: 2,
  },
];

/** What a user falls back to with no `dashboardView` and no usable row. */
export const FALLBACK_VIEW_KEY = "business";

/**
 * A view key is a slug, and it is the identity a user's saved layout hangs off
 * (`DashboardLayout.templateKey`). Renaming a view's label is free; renaming
 * its key orphans every layout saved against it, which is why the settings form
 * offers the key once, at creation, and never again.
 */
export function isViewKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 40 &&
    /^[a-z0-9][a-z0-9-]*$/.test(value)
  );
}

export function slugifyViewKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Access is a list of roles, and empty means everyone.
 *
 * Enforced on the read path as well as in the settings form, for the same
 * reason tile access is: `User.dashboardView` is a plain string an
 * administrator can set and a role change can outlive.
 */
export function canOpenView(access: readonly Role[], role: Role): boolean {
  return access.length === 0 || access.includes(role);
}
