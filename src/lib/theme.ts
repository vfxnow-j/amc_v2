/**
 * Theme model for the v2 shell.
 *
 * Per design/README.md: the theme is persisted per user on the server with a
 * localStorage mirror to avoid a flash before hydration, and `prefers-color-scheme`
 * decides the first load before any preference exists. The app defaults to dark
 * for STAFF (warehouse lighting) and light for admin/finance — that role default
 * is supplied by the server as `defaultTheme` once auth exists.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Mirror of the server-side preference; read by the pre-paint script. */
export const THEME_STORAGE_KEY = "vfxnow-amc-theme";

/** Set on <html>; the CSS token layer keys its dark block off this. */
export const THEME_ATTRIBUTE = "data-theme";

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
