import {
  ACCENT_ATTRIBUTE,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type AccentId,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Resolves the theme and accent to concrete attributes on <html> before first
 * paint, so the shell never flashes the wrong surface or the wrong accent
 * during hydration.
 *
 * Runs synchronously in <head>, ahead of any React code. `defaultTheme` and
 * `defaultAccent` are the server-side preferences — the User record's choice,
 * or the role default — and are used when the browser has no stored mirror yet.
 *
 * The accent list is inlined rather than imported so the check happens without
 * a module: an unknown id (a renamed accent, a hand-edited localStorage) falls
 * back to the brand rather than leaving the attribute set to something with no
 * ramp behind it, which would paint an unstyled accent.
 *
 * Emitted as `text/plain` on the client so it stays inert on soft navigations
 * and doesn't trip React's dev warning about rendered <script> tags — see
 * next/docs "How to prevent flash before hydration".
 */
export function ThemeScript({
  defaultTheme = "system",
  defaultAccent = DEFAULT_ACCENT,
  accents,
}: {
  defaultTheme?: ThemePreference;
  defaultAccent?: AccentId;
  /** Every valid accent id, so the script can reject anything else. */
  accents: AccentId[];
}) {
  const script = `(function(){try{
var d=document.documentElement;
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(defaultTheme)};
if(p!=="light"&&p!=="dark"&&p!=="system"){p="system"}
var t=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;
d.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t);
var ok=${JSON.stringify(accents)};
var a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)})||${JSON.stringify(defaultAccent)};
if(ok.indexOf(a)<0){a=${JSON.stringify(DEFAULT_ACCENT)}}
d.setAttribute(${JSON.stringify(ACCENT_ATTRIBUTE)},a);
}catch(e){}})();`;

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
