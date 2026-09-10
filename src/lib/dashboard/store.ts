import "server-only";

import { cache } from "react";
import type { UserRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/roles";
import { type TileId } from "./catalog";
import { readTiles, tilesFromIds, type PlacedTile } from "./layout";
import {
  FALLBACK_VIEW_KEY,
  SEED_VIEWS,
  canOpenView,
  isViewKey,
} from "./views";

/**
 * Reading the dashboard: which views exist, which one you are looking at, and
 * what shape you have put it in.
 *
 * **Server-only, and the line is the same one `catalog.ts` draws.** The catalog
 * and `layout.ts` are pure so the picker and the canvas can import them; this
 * file touches `lib/prisma`, so a client component that imported it would pull
 * the pg driver into the browser bundle and fail on `dns`.
 *
 * Three levels of fallback, and every one of them renders something:
 *
 *   your saved layout  →  the view's template  →  the code seeds
 *
 * That ladder is why nothing here throws on bad data. A template row with a
 * corrupt `tiles` column degrades to the seed for its key, and past that to
 * "Everything"; a view an administrator deleted out from under somebody's
 * `User.dashboardView` degrades to the first view they can open. The column is
 * deliberately not a foreign key precisely so that deletion is a soft landing
 * rather than a cascade — see the model comment in `prisma/schema.prisma`.
 */

export type DashboardView = {
  key: string;
  label: string;
  access: Role[];
  sortOrder: number;
};

export type DashboardScreen = {
  /** Every view this reader may open, in the administrator's order. */
  views: DashboardView[];
  /** The one they are looking at. */
  view: DashboardView;
  tiles: PlacedTile[];
  /** True when these tiles came from this user's own row, not the template. */
  reshaped: boolean;
};

/* ── Seeding ─────────────────────────────────────────────────────────────── */

/**
 * Write the code seeds, once, into an empty table.
 *
 * `skipDuplicates` rather than a transaction: two people opening the dashboard
 * at the same second both see zero rows, and the loser of that race should
 * write nothing rather than fail a page render on a unique-key violation.
 */
async function seedViews(): Promise<void> {
  await prisma.dashboardTemplate.createMany({
    data: SEED_VIEWS.map((seed) => ({
      key: seed.key,
      label: seed.label,
      tiles: seed.tiles,
      access: seed.access as UserRole[],
      sortOrder: seed.sortOrder,
    })),
    skipDuplicates: true,
  });
}

type TemplateRow = {
  key: string;
  label: string;
  tiles: unknown;
  access: UserRole[];
  sortOrder: number;
};

/**
 * Every template, seeding the table if it has never been written to.
 *
 * `cache()` per the registry's note: a render pass reads this from the page
 * header's view picker as well as from the grid, and neither should cost a
 * second round trip.
 */
const allTemplates = cache(async (): Promise<TemplateRow[]> => {
  const rows = await prisma.dashboardTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, label: true, tiles: true, access: true, sortOrder: true },
  });
  if (rows.length > 0) return rows;

  await seedViews();
  return prisma.dashboardTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, label: true, tiles: true, access: true, sortOrder: true },
  });
});

/* ── Reading ─────────────────────────────────────────────────────────────── */

function toView(row: TemplateRow): DashboardView {
  return {
    key: row.key,
    label: row.label,
    access: row.access as Role[],
    sortOrder: row.sortOrder,
  };
}

/**
 * The last resort, held in memory rather than read: what the dashboard is when
 * the table is empty and the seed write failed, or when every view has been
 * deleted and this request is the one that noticed.
 */
function seedFallback(role: Role): { view: DashboardView; tiles: PlacedTile[] } {
  const seed =
    SEED_VIEWS.find((candidate) => candidate.key === FALLBACK_VIEW_KEY) ??
    SEED_VIEWS[0];
  return {
    view: { key: seed.key, label: seed.label, access: [], sortOrder: 0 },
    tiles: tilesFromIds(seed.tiles, role),
  };
}

/** The template's own tiles, and past that the code seed for the same key. */
function templateTiles(row: TemplateRow, role: Role): PlacedTile[] {
  const stored = readTiles(row.tiles, role);
  if (stored.length > 0) return stored;

  const seed = SEED_VIEWS.find((candidate) => candidate.key === row.key);
  return seed ? tilesFromIds(seed.tiles, role) : [];
}

/**
 * What the dashboard page renders.
 *
 * `requested` is the `?view=` parameter, which loses to nothing — it is a link
 * somebody sent, and honouring it is what makes a view shareable. Below that
 * sits the user's own stored choice, then the first view their role can open.
 */
export async function getDashboardScreen(
  userId: string,
  role: Role,
  requested?: string,
): Promise<DashboardScreen> {
  const [rows, stored] = await Promise.all([
    allTemplates(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { dashboardView: true },
    }),
  ]);

  const open = rows.filter((row) => canOpenView(row.access as Role[], role));

  if (open.length === 0) {
    const fallback = seedFallback(role);
    return { views: [fallback.view], ...fallback, reshaped: false };
  }

  const wanted = isViewKey(requested)
    ? requested
    : isViewKey(stored?.dashboardView)
      ? stored.dashboardView
      : undefined;

  const row =
    open.find((candidate) => candidate.key === wanted) ??
    open.find((candidate) => candidate.key === FALLBACK_VIEW_KEY) ??
    open[0];

  const layout = await prisma.dashboardLayout.findUnique({
    where: { userId_templateKey: { userId, templateKey: row.key } },
    select: { tiles: true },
  });

  const mine = layout ? readTiles(layout.tiles, role) : [];

  return {
    views: open.map(toView),
    view: toView(row),
    tiles: mine.length > 0 ? mine : templateTiles(row, role),
    reshaped: mine.length > 0,
  };
}

/**
 * Whether this reader may save against a view key at all.
 *
 * A key that names no row is still allowed when it is one of the code seeds,
 * because the seed fallback above renders exactly that view when the table is
 * empty — and a dashboard you can reshape but not save would be worse than one
 * you cannot reshape. Anything else is refused: `DashboardLayout.templateKey`
 * is a plain string, so without this an unlimited number of rows could be
 * written against keys that will never be read.
 */
export async function canUseView(key: string, role: Role): Promise<boolean> {
  if (!isViewKey(key)) return false;

  const row = await prisma.dashboardTemplate.findUnique({
    where: { key },
    select: { access: true },
  });
  if (row) return canOpenView(row.access as Role[], role);

  return SEED_VIEWS.some((seed) => seed.key === key);
}

/* ── Settings ────────────────────────────────────────────────────────────── */

export type DashboardViewRow = DashboardView & {
  id: string;
  /** Ids as stored, already filtered to what the catalog still knows about. */
  tiles: TileId[];
  /** How many people have dragged this view into a shape of their own. */
  reshapedBy: number;
  updatedAt: Date;
};

/**
 * Every view, for the administrator who maintains them.
 *
 * Read as SUPER_ADMIN rather than as the reader: this is the edit screen, and
 * an administrator has to be able to see the tiles on a view they themselves
 * cannot place — otherwise saving somebody else's view would quietly strip it.
 * The screen is already behind `requireAdmin`.
 */
export async function listDashboardViews(): Promise<DashboardViewRow[]> {
  await allTemplates();

  const [rows, counts] = await Promise.all([
    prisma.dashboardTemplate.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.dashboardLayout.groupBy({
      by: ["templateKey"],
      _count: { _all: true },
    }),
  ]);

  const reshaped = new Map(
    counts.map((entry) => [entry.templateKey, entry._count._all]),
  );

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    access: row.access as Role[],
    sortOrder: row.sortOrder,
    tiles: readTiles(row.tiles, "SUPER_ADMIN").map((tile) => tile.id),
    reshapedBy: reshaped.get(row.key) ?? 0,
    updatedAt: row.updatedAt,
  }));
}
