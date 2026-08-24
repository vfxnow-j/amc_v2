/**
 * Appearance for the v2 shell: two independent choices, both persisted on the
 * `User` record with a localStorage mirror to avoid a flash before hydration.
 *
 * - **mode** — light / dark / system. `prefers-color-scheme` decides the first
 *   load before any choice exists, and the app defaults to dark for STAFF
 *   (warehouse lighting) and light for admin and finance.
 * - **theme** — which of the six palettes is loaded. A theme is not an accent:
 *   it sets every surface, every ink and the accent, so it repaints the app
 *   rather than tinting the buttons. Each has a light and a dark face, so six
 *   themes are twelve complete looks and the mode switch still means what it
 *   says.
 *
 * The two attributes they resolve to on <html> are `data-mode` and
 * `data-theme`. Both are set before first paint by ThemeScript.
 *
 * This module is imported by both server and client code and must stay pure —
 * nothing here may reach `lib/prisma`.
 */

export type ColorMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

/** Mirrors of the server-side choices; read by the pre-paint script. */
export const MODE_STORAGE_KEY = "vfxnow-amc-mode";
export const THEME_STORAGE_KEY = "vfxnow-amc-theme";

/** Set on <html>; the CSS token layer keys its blocks off these. */
export const MODE_ATTRIBUTE = "data-mode";
export const THEME_ATTRIBUTE = "data-theme";

export function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "dark" || value === "system";
}

export function systemMode(): ResolvedMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveMode(mode: ColorMode): ResolvedMode {
  return mode === "system" ? systemMode() : mode;
}

/* -------------------------------------------------------------------------
   Themes
------------------------------------------------------------------------- */

export type ThemeId = string;

export type Theme = {
  id: ThemeId;
  label: string;
  blurb: string;
  /**
   * The three colours the picker shows per mode — ground, panel and accent.
   * A theme is more than one colour now, so a single dot could not say what
   * you are choosing. These are read straight off the generated ramps, so the
   * chip is the theme rather than an impression of it.
   */
  swatch: {
    light: { ground: string; panel: string; accent: string };
    dark: { ground: string; panel: string; accent: string };
  };
};

/**
 * The six themes.
 *
 * Each is two ramps in `globals.css` — fourteen surface stops and nine accent
 * stops — and nothing else. Every role in the app (`--ground`, `--panel`,
 * `--ink`, `--hairline`, the nav bubbles, the focus ring, the wordmark) is
 * mapped from those stops once per mode, so a theme never has to know a role
 * exists and a seventh is two ramps and a row here.
 *
 * The surface ramps are generated from the VFXnow ramp's own lightness curve
 * with a hue applied, so all six share a rhythm and differ in colour, and
 * every stop that carries text was checked at 4.5:1 against the surface it
 * sits on in both modes. Two stops needed correcting; both are recorded in the
 * comment above the theme blocks.
 */
export const THEMES: Theme[] = [
  {
    id: "vfxnow",
    label: "VFXnow",
    blurb: "The house palette — cool greys under the brand cyan.",
    swatch: {
      light: { ground: "#f1f4f6", panel: "#ffffff", accent: "#0081a1" },
      dark: { ground: "#0c1418", panel: "#15222a", accent: "#00d0ff" },
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    blurb: "No hue anywhere, so colour only ever means status.",
    swatch: {
      light: { ground: "#f3f3f3", panel: "#ffffff", accent: "#48545d" },
      dark: { ground: "#121212", panel: "#202020", accent: "#78868f" },
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    blurb: "Deep blue surfaces and indigo. The darkest of the six.",
    swatch: {
      light: { ground: "#f0f1f7", panel: "#ffffff", accent: "#4335a8" },
      dark: { ground: "#090d1b", panel: "#10162f", accent: "#8d84ff" },
    },
  },
  {
    id: "forest",
    label: "Forest",
    blurb: "Green-shifted greys and emerald.",
    swatch: {
      light: { ground: "#f1f6f4", panel: "#ffffff", accent: "#096b43" },
      dark: { ground: "#0b1912", panel: "#132c20", accent: "#16a86a" },
    },
  },
  {
    id: "ember",
    label: "Ember",
    blurb: "Warm surfaces and orange — easiest of the six in low light.",
    swatch: {
      light: { ground: "#f6f3f1", panel: "#ffffff", accent: "#9e4c00" },
      dark: { ground: "#18110c", panel: "#2a1e15", accent: "#ee7c15" },
    },
  },
  {
    id: "plum",
    label: "Plum",
    blurb: "Purple-shifted greys and violet.",
    swatch: {
      light: { ground: "#f5f1f6", panel: "#ffffff", accent: "#6430a6" },
      dark: { ground: "#150b19", panel: "#25132c", accent: "#9a5cf5" },
    },
  },
];

/** The house palette, and what everyone gets before they choose. */
export const DEFAULT_THEME: ThemeId = "vfxnow";

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
