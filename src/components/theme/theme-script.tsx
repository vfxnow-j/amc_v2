import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

/**
 * Resolves the theme to a concrete `data-theme` attribute before first paint,
 * so the shell never flashes the wrong surface colours during hydration.
 *
 * Runs synchronously in <head>, ahead of any React code. `defaultTheme` is the
 * server-side preference (from the User record, or the role default) and is used
 * when the browser has no stored mirror yet.
 *
 * Emitted as `text/plain` on the client so it stays inert on soft navigations
 * and doesn't trip React's dev warning about rendered <script> tags — see
 * next/docs "How to prevent flash before hydration".
 */
export function ThemeScript({
  defaultTheme = "system",
}: {
  defaultTheme?: ThemePreference;
}) {
  const script = `(function(){try{
var d=document.documentElement;
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(defaultTheme)};
if(p!=="light"&&p!=="dark"&&p!=="system"){p="system"}
var t=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;
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
