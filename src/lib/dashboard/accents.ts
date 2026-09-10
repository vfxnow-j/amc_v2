/**
 * The colour a person can give one tile.
 *
 * Twelve fixed hues and **no free hex field** — the owner's decision, and the
 * reason the result stays legible. A colour picker produces twelve near-identical
 * greys the first time somebody is in a hurry, and a palette that has to survive
 * six themes and two modes cannot be re-verified every time a user invents a
 * value. These twelve are defined once in `globals.css` under `[data-accent]`,
 * mode-aware through `light-dark()`, so a tile keeps its identity everywhere
 * without anyone re-picking it per theme.
 *
 * **Distinct from the `data-tile` appearance axis**, which is one decision about
 * every tile at once (panel, flush, sunken, tinted). This is per tile. That is
 * also why these are fixed hues rather than mixes of the theme's own accent:
 * the whole point is telling two tiles apart, and twelve mixes of one accent are
 * twelve shades of the same colour.
 *
 * Contrast is computed rather than judged — `--tile-accent-text` on
 * `--tile-accent-tint` is at worst 5.28:1 in light and 5.82:1 in dark, against a
 * 4.5:1 requirement. **A hue added here must clear the same bar in both modes**,
 * and must be added to the CSS in the same change or it will silently render as
 * no accent at all.
 *
 * Pure and client-safe: the tile picker is a client component, and nothing here
 * reaches the database.
 */

export const TILE_ACCENTS = [
  "slate",
  "blue",
  "indigo",
  "violet",
  "magenta",
  "rose",
  "red",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
] as const;

export type TileAccent = (typeof TILE_ACCENTS)[number];

/** What the picker calls each one. */
export const ACCENT_LABEL: Record<TileAccent, string> = {
  slate: "Slate",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  magenta: "Magenta",
  rose: "Rose",
  red: "Red",
  amber: "Amber",
  lime: "Lime",
  green: "Green",
  teal: "Teal",
  cyan: "Cyan",
};

const ACCENTS = new Set<string>(TILE_ACCENTS);

/**
 * Stored geometry is never trusted, and an accent is stored geometry.
 *
 * Undefined means "no accent", which is the default and renders exactly as a
 * tile does today — so an unknown value degrades to a plain tile rather than to
 * a broken one. Same rule the tile ids and sizes follow in `layout.ts`.
 */
export function isTileAccent(value: unknown): value is TileAccent {
  return typeof value === "string" && ACCENTS.has(value);
}

export function readAccent(value: unknown): TileAccent | undefined {
  return isTileAccent(value) ? value : undefined;
}
