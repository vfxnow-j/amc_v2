/**
 * Theme model for the v2 shell.
 *
 * Two independent choices, both persisted on the `User` record with a
 * localStorage mirror to avoid a flash before hydration:
 *
 * - **preference** — light / dark / system. `prefers-color-scheme` decides the
 *   first load before any preference exists, and the app defaults to dark for
 *   STAFF (warehouse lighting) and light for admin/finance.
 * - **accent** — which hue the accent ramp carries. Independent of light/dark,
 *   so twelve accents give twenty-four looks rather than twelve.
 *
 * This module is imported by both server and client code and must stay pure —
 * nothing here may reach `lib/prisma`.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Mirrors of the server-side preferences; read by the pre-paint script. */
export const THEME_STORAGE_KEY = "vfxnow-amc-theme";
export const ACCENT_STORAGE_KEY = "vfxnow-amc-accent";

/** Set on <html>; the CSS token layer keys its blocks off these. */
export const THEME_ATTRIBUTE = "data-theme";
export const ACCENT_ATTRIBUTE = "data-accent";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/* -------------------------------------------------------------------------
   Accents
------------------------------------------------------------------------- */

export type Accent = {
  id: string;
  label: string;
  /**
   * The swatch shown in the picker: the same stop the accent fills with in
   * each theme, so the dot is the color you are actually choosing.
   */
  swatch: { light: string; dark: string };
  /** Absent on the brand accent; set on the eleven that were added to it. */
  note?: string;
};

/**
 * The twelve accents, in spectrum order after the brand.
 *
 * Every ramp is defined in `globals.css` as `--color-accent-100…900`; nothing
 * else in the codebase knows an accent exists, because the semantic layer
 * (`--accent-solid`, `--accent-text`, `--accent-tint`, `--color-ring`, the nav
 * bubbles and the wordmark) is written in terms of those nine stops. Adding a
 * thirteenth is a CSS block and a row here — no component changes.
 *
 * The stops were checked against the three jobs the token layer gives them:
 * `700` carrying white text on the light panel, `300` read on the dark panel,
 * and the dark-theme fill carrying `--color-brand-text` glyphs. Blue, indigo,
 * violet and graphite are too dark at `500` to hold dark glyphs, so their
 * blocks point `--accent-dark-solid` at `400` instead — see globals.css.
 */
export const ACCENTS: Accent[] = [
  {
    id: "cyan",
    label: "VFXnow cyan",
    swatch: { light: "#0084a5", dark: "#00d0ff" },
  },
  { id: "teal", label: "Teal", swatch: { light: "#036b64", dark: "#0da79c" } },
  {
    id: "emerald",
    label: "Emerald",
    swatch: { light: "#096b43", dark: "#16a86a" },
  },
  { id: "lime", label: "Lime", swatch: { light: "#4a7300", dark: "#7bb81b" } },
  { id: "amber", label: "Amber", swatch: { light: "#925f00", dark: "#e39708" } },
  {
    id: "orange",
    label: "Orange",
    swatch: { light: "#9e4c00", dark: "#ee7c15" },
  },
  { id: "rose", label: "Rose", swatch: { light: "#a82820", dark: "#f4544a" } },
  {
    id: "magenta",
    label: "Magenta",
    swatch: { light: "#a2246f", dark: "#ec4fac" },
  },
  {
    id: "violet",
    label: "Violet",
    swatch: { light: "#6430a6", dark: "#b481ff" },
  },
  {
    id: "indigo",
    label: "Indigo",
    swatch: { light: "#4335a8", dark: "#8d84ff" },
  },
  { id: "blue", label: "Blue", swatch: { light: "#1449a8", dark: "#5f9aff" } },
  {
    id: "graphite",
    label: "Graphite",
    swatch: { light: "#48545d", dark: "#98a5b0" },
    note: "No hue at all — for screens where color should only ever mean status.",
  },
];

export type AccentId = string;

/** The brand accent, and what everyone gets before they choose. */
export const DEFAULT_ACCENT: AccentId = "cyan";

const ACCENT_IDS = new Set(ACCENTS.map((accent) => accent.id));

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && ACCENT_IDS.has(value);
}

export function accentById(id: AccentId): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}
