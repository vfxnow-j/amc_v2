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
 * would make "Everything" undeletable: remove it, and the next page load puts
 * it back. An administrator who deletes every view gets the seeds again, which
 * is a recovery path rather than a contradiction.
 *
 * Pure and client-safe. `Role` is imported as a type only, so nothing here
 * reaches the database — the settings form needs these names for its role
 * picker and the settings form is a client component.
 */

export type SeedView = {
  key: string;
  label: string;
  /** Reading order. Geometry is derived — see `lib/dashboard/layout`. */
  tiles: TileId[];
  /** Empty means everyone. Mirrors `DashboardTemplate.access`. */
  access: Role[];
  sortOrder: number;
};

/**
 * Three views, made only of tiles that exist and render today.
 *
 * The plan's Logistics, Engineering and AR views are named there against tiles
 * that have not been built yet, and a seeded view whose tiles do not exist is
 * an empty screen with a confident name on it. They arrive as seeds — or, more
 * likely, as rows an administrator makes in Settings — when their tiles do.
 */
export const SEED_VIEWS: SeedView[] = [
  {
    key: "everything",
    label: "Everything",
    // The dashboard exactly as it stood before layouts were storable, so the
    // change nobody asked for is no change at all.
    tiles: [
      "kpis",
      "revenue-by-type",
      "top-items",
      "idle-items",
      "due-back",
      "maintenance",
      "decisions",
    ],
    access: [],
    sortOrder: 0,
  },
  {
    key: "trading",
    label: "How we are trading",
    // Money and the fleet behind it. No "needs a person" tiles: this is the
    // view you open to answer a question, not to pick up work.
    tiles: ["kpis", "revenue-by-type", "top-items", "idle-items"],
    access: [],
    sortOrder: 1,
  },
  {
    key: "floor",
    label: "The floor",
    // What needs hands today, headline figures last. Everything on it is a
    // list of things somebody has to go and do.
    tiles: ["due-back", "maintenance", "decisions", "kpis"],
    access: [],
    sortOrder: 2,
  },
];

/** What a user falls back to with no `dashboardView` and no usable row. */
export const FALLBACK_VIEW_KEY = "everything";

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
