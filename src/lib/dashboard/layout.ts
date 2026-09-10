import { z } from "zod";
import type { Role } from "@/lib/roles";
import { readAccent, type TileAccent } from "./accents";
import {
  TILE_GRID,
  canSeeTile,
  clampTileSize,
  isTileId,
  tileMeta,
  type TileId,
} from "./catalog";

/**
 * Turning stored JSON into a layout the page can draw.
 *
 * `DashboardLayout.tiles` and `DashboardTemplate.tiles` are `Json` columns.
 * One of them is written by a browser and the other by an administrator typing
 * into a form, so **neither is trusted on read**. Everything a saved layout can
 * be wrong about is answered here, once:
 *
 * - **shape** — zod, and a parse failure yields nothing rather than throwing.
 *   A dashboard that renders the default is a recoverable Tuesday; a dashboard
 *   that 500s because somebody's row holds `{"tiles": "yes"}` is not.
 * - **membership** — an id that is not in the catalog is dropped. Tiles get
 *   renamed and withdrawn, and the alternative is a blank square with no way to
 *   remove it.
 * - **permission** — a tile the reader may not see is dropped *here*, on the
 *   read path, and not only in the picker. A layout is a saved list of ids: it
 *   can be seeded by an admin, or written while somebody was an admin and read
 *   back after they were demoted. The picker filters for tidiness; this filters
 *   for correctness.
 * - **geometry** — clamped, never believed. `catalog.clampTileSize` holds each
 *   tile's own bounds; column and row bounds are the grid's.
 * - **colour** — an accent that is not one of the twelve is dropped, and the
 *   tile renders exactly as an uncoloured one. `accents.readAccent` is the same
 *   answer the picker asks, so a hue withdrawn from the palette disappears from
 *   saved layouts on the next read rather than rendering as an unstyled
 *   attribute nobody can clear.
 * - **overlap** — resolved. Two tiles claiming the same cell is a rendering
 *   question CSS Grid answers by stacking them, which looks like a bug because
 *   it is one.
 *
 * **Pure and client-safe**, like `catalog.ts` and for the same reason: the
 * edit canvas and the tile picker are client components and both need this
 * arithmetic. Nothing here may import anything that reaches `lib/prisma`.
 *
 * The compaction below deliberately reproduces `react-grid-layout`'s vertical
 * compactor rather than approximating it. Read mode is server-rendered CSS Grid
 * and edit mode is RGL; if the two disagree about where a tile lands, opening
 * the editor makes the dashboard jump, and the user is then reshaping a layout
 * they were not looking at.
 */

/** One tile, placed. The unit of both stored columns and of the read grid. */
export type PlacedTile = {
  id: TileId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** One of the twelve, or absent — and absent is the plain tile. */
  accent?: TileAccent;
};

/**
 * A dashboard nobody can fill by accident, and a grid nobody can fall off.
 *
 * The tile cap is not a performance number — it is a refusal to render a
 * thousand Suspense boundaries because a JSON column got pasted into twice.
 */
const MAX_TILES = 40;
const MAX_ROWS = 400;

/* ── The stored shape ────────────────────────────────────────────────────── */

/**
 * Three accepted forms, and the bare-id form is not legacy debt.
 *
 * A template is a *list of tiles in reading order* — an administrator picks
 * what belongs on a view, and every user then reshapes their own copy, so
 * storing pixel geometry on the company template would be storing one person's
 * taste as everyone's starting point. `["kpis", "due-back"]` is that list, and
 * `placeInReadingOrder` turns it into geometry. A user's own layout, written by
 * the canvas, is always the full form. The third form is the second one with a
 * colour on it — `{ id, accent }`, still no geometry — which is how an
 * administrator colours a template tile without also placing it.
 *
 * The coordinates are `unknown` on purpose, and `whole` below is what makes
 * that safe. Typing them `z.number()` reads stricter and behaves worse: zod
 * fails the whole array on one bad member, so a single `NaN` written by some
 * future arithmetic bug would throw away a layout that was otherwise entirely
 * fine. Clamping is already the rule for every one of these values — a missing
 * or unusable one is just the far end of the same clamp.
 */
const placedSchema = z.object({
  id: z.string(),
  x: z.unknown().optional(),
  y: z.unknown().optional(),
  w: z.unknown().optional(),
  h: z.unknown().optional(),
  accent: z.unknown().optional(),
});

type StoredEntry = string | z.infer<typeof placedSchema>;

/**
 * Whether this entry is making a claim about *where* the tile goes.
 *
 * The third stored form is why this exists: `{ id, accent }` — a tile an
 * administrator has coloured but not placed, because a template never carries
 * geometry. Without this it would parse as a placed tile at the origin with
 * every coordinate defaulted, and a whole template of them would compact into
 * one column. Geometry-free objects are read exactly like the bare id they
 * would otherwise have been, and flowed.
 *
 * `.optional()` on the four coordinates is what lets that object parse at all:
 * in zod 4 an `unknown()` key is still a required key, so a missing `x` fails
 * the object branch, fails the union, and empties the whole layout. The values
 * stay `unknown` for the reason the note above gives — `whole()` clamps, and
 * one `NaN` must not cost the other thirty-nine tiles.
 */
function hasGeometry(entry: StoredEntry): boolean {
  if (typeof entry === "string") return false;
  return [entry.x, entry.y, entry.w, entry.h].some(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

const storedSchema = z.array(z.union([z.string(), placedSchema]));

/**
 * Longer than this and the column is corrupt rather than crowded, so it is
 * refused whole instead of being read down to the cap. The cap itself is
 * applied inside the loop: forty *usable* tiles, not forty entries of which
 * thirty-nine were duplicates.
 */
const ABSURD = 200;

/* ── Reading ─────────────────────────────────────────────────────────────── */

function whole(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

/**
 * Everything a stored `tiles` column can be, resolved into tiles this reader is
 * allowed to see, sized within their own bounds and laid out without overlap.
 *
 * An empty result means "there was nothing usable in here" and is the caller's
 * signal to fall back — to the template, and past that to the code defaults.
 * It is deliberately not distinguishable from "somebody saved an empty
 * dashboard", because the two want the same answer: show them something.
 */
export function readTiles(value: unknown, role: Role): PlacedTile[] {
  if (Array.isArray(value) && value.length > ABSURD) return [];

  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return [];

  const seen = new Set<TileId>();
  const tiles: PlacedTile[] = [];

  for (const entry of parsed.data) {
    if (tiles.length >= MAX_TILES) break;
    const id = typeof entry === "string" ? entry : entry.id;
    if (!isTileId(id)) continue;
    // First placement wins. A duplicated id is not two tiles — every tile is a
    // whole query, and the registry renders one component per id.
    if (seen.has(id)) continue;

    const meta = tileMeta(id);
    if (!canSeeTile(meta, role)) continue;
    seen.add(id);

    // Dropped rather than defaulted, and dropped the same way an unknown id
    // is: a tile with a colour nobody recognises is a plain tile, not a broken
    // one. `undefined` is spread away below so an uncoloured tile stays the
    // exact object it is today.
    const accent = typeof entry === "string" ? undefined : readAccent(entry.accent);

    if (typeof entry === "string" || !hasGeometry(entry)) {
      // Geometry comes from the catalog and the flow below; `y` only has to
      // keep this entry in the order it was written, for the mixed case.
      const flowed = clampTileSize(meta, meta.size.default);
      tiles.push(withAccent({ id, x: 0, y: tiles.length, ...flowed }, accent));
      continue;
    }

    const size = clampTileSize(meta, {
      w: whole(entry.w, meta.size.default.w),
      h: whole(entry.h, meta.size.default.h),
    });
    const x = Math.min(
      Math.max(whole(entry.x, 0), 0),
      TILE_GRID.columns - size.w,
    );
    const y = Math.min(Math.max(whole(entry.y, 0), 0), MAX_ROWS);

    tiles.push(withAccent({ id, x, y, w: size.w, h: size.h }, accent));
  }

  // Nothing here carries geometry worth compacting — flow it instead, which is
  // what an administrator picking tiles in an order meant. The colours are put
  // back afterwards because placing is about ids and boxes and should stay
  // that way; ids are unique by now, so the join is exact.
  const bare = !parsed.data.some(hasGeometry);
  if (!bare) return compact(tiles);

  const accents = new Map(tiles.map((tile) => [tile.id, tile.accent]));
  return placeInReadingOrder(tiles.map((tile) => tile.id)).map((tile) =>
    withAccent(tile, accents.get(tile.id)),
  );
}

/** Carry an accent onto a tile, leaving an uncoloured one byte-identical. */
function withAccent(tile: PlacedTile, accent: TileAccent | undefined): PlacedTile {
  return accent ? { ...tile, accent } : tile;
}

/** The same read, from a list of ids the caller already trusts. */
export function tilesFromIds(ids: readonly TileId[], role: Role): PlacedTile[] {
  return placeInReadingOrder(
    ids.filter((id) => canSeeTile(tileMeta(id), role)).slice(0, MAX_TILES),
  );
}

/* ── Placing ─────────────────────────────────────────────────────────────── */

/**
 * Flow a list of ids at their default sizes, left to right, wrapping at the
 * grid's width — the same arrangement a paragraph of words would take.
 *
 * This is what "the template, as-is" looks like before anybody has dragged
 * anything, and the order is the administrator's order, which is why it is a
 * flow and not a packing: a tile must not overtake the one before it.
 */
export function placeInReadingOrder(ids: readonly TileId[]): PlacedTile[] {
  const tiles: PlacedTile[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const id of ids.slice(0, MAX_TILES)) {
    const meta = tileMeta(id);
    const { w, h } = clampTileSize(meta, meta.size.default);

    if (x + w > TILE_GRID.columns) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }

    tiles.push({ id, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }

  return compact(tiles);
}

/** Where the next tile goes when somebody adds one mid-edit: under everything. */
export function appendTile(tiles: readonly PlacedTile[], id: TileId): PlacedTile[] {
  if (tiles.length >= MAX_TILES) return [...tiles];
  const meta = tileMeta(id);
  const { w, h } = clampTileSize(meta, meta.size.default);
  const y = tiles.reduce((low, tile) => Math.max(low, tile.y + tile.h), 0);
  return compact([...tiles, { id, x: 0, y, w, h }]);
}

/**
 * Colour one tile, or take its colour off.
 *
 * Here rather than in the canvas because it is the same edit the settings form
 * makes, and because `undefined` has to *remove* the key rather than sit in it:
 * `tilesFingerprint` compares serialized JSON, so a tile carrying
 * `accent: undefined` and one carrying nothing must not be two different
 * layouts. Geometry is untouched — a colour is not a move.
 */
export function setTileAccent(
  tiles: readonly PlacedTile[],
  id: TileId,
  accent: TileAccent | undefined,
): PlacedTile[] {
  return tiles.map((tile) => {
    if (tile.id !== id) return tile;
    const box = { id: tile.id, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    return accent ? { ...box, accent } : box;
  });
}

/* ── Compaction ──────────────────────────────────────────────────────────── */

function overlaps(a: PlacedTile, b: PlacedTile): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function firstCollision(
  placed: readonly PlacedTile[],
  tile: PlacedTile,
): PlacedTile | undefined {
  return placed.find((other) => overlaps(tile, other));
}

/** Reading order, and the order the server emits tiles in for the phone. */
export function byReadingOrder(a: PlacedTile, b: PlacedTile): number {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
}

/**
 * Resolve overlaps and pull everything up against the top.
 *
 * Deliberately `react-grid-layout`'s algorithm, not a tidier one: take the
 * tiles in reading order, push each one down out of whatever it lands on, then
 * float it back up a row at a time while the row above is free. Starting the
 * search at the top instead would let a small tile fall into a hole *above* a
 * tile that was drawn before it, which reads as tiles shuffling themselves.
 */
function compact(tiles: readonly PlacedTile[]): PlacedTile[] {
  const placed: PlacedTile[] = [];

  for (const tile of [...tiles].sort(byReadingOrder)) {
    let y = Math.min(tile.y, MAX_ROWS);

    for (;;) {
      const hit = firstCollision(placed, { ...tile, y });
      if (!hit) break;
      y = hit.y + hit.h;
      if (y > MAX_ROWS) break;
    }

    while (y > 0 && !firstCollision(placed, { ...tile, y: y - 1 })) y -= 1;

    placed.push({ ...tile, y });
  }

  return placed.sort(byReadingOrder);
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * What goes into the `tiles` column. Field order is fixed and the numbers are
 * whole, so two saves of an unchanged layout produce identical JSON — which is
 * what lets the canvas tell "dirty" from "moved and moved back" by comparing
 * strings rather than by walking two arrays.
 */
export function serializeTiles(tiles: readonly PlacedTile[]): PlacedTile[] {
  return [...tiles]
    .sort(byReadingOrder)
    .map(({ id, x, y, w, h, accent }) =>
      accent ? { id, x, y, w, h, accent } : { id, x, y, w, h },
    );
}

export function tilesFingerprint(tiles: readonly PlacedTile[]): string {
  return JSON.stringify(serializeTiles(tiles));
}
