import {
  DEFAULT_THEME,
  MODE_ATTRIBUTE,
  MODE_STORAGE_KEY,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type ColorMode,
  type ThemeId,
} from "@/lib/theme";

/**
 * Resolves the mode and the theme to concrete attributes on <html> before first
 * paint, so the shell never flashes the wrong surfaces during hydration.
 *
 * This matters more now that a theme owns every surface rather than the accent
 * alone: getting it wrong for one frame is a whole app repainting, not a button
 * changing colour.
 *
 * Runs synchronously in <head>, ahead of any React code. `defaultMode` and
 * `defaultTheme` are the server-side choices — the User record's, or the role
 * default — and are used when the browser has no stored mirror yet.
 *
 * The theme list is inlined rather than imported so the check happens without a
 * module: an unknown id (a renamed theme, a hand-edited localStorage) falls
 * back to the house palette rather than leaving the attribute set to something
 * with no ramps behind it, which would paint an unstyled app.
 *
 * Emitted as `text/plain` on the client so it stays inert on soft navigations
 * and doesn't trip React's dev warning about rendered <script> tags — see
 * next/docs "How to prevent flash before hydration".
 */
export function ThemeScript({
  defaultMode = "system",
  defaultTheme = DEFAULT_THEME,
  themes,
}: {
  defaultMode?: ColorMode;
  defaultTheme?: ThemeId;
  /** Every valid theme id, so the script can reject anything else. */
  themes: ThemeId[];
}) {
  const script = `(function(){try{
var d=document.documentElement;
var m=localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)})||${JSON.stringify(defaultMode)};
if(m!=="light"&&m!=="dark"&&m!=="system"){m="system"}
var r=m==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):m;
d.setAttribute(${JSON.stringify(MODE_ATTRIBUTE)},r);
var ok=${JSON.stringify(themes)};
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(defaultTheme)};
if(ok.indexOf(t)<0){t=${JSON.stringify(DEFAULT_THEME)}}
d.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t);
}catch(e){}})();`;

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
