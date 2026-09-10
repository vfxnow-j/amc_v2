import { AXES, isAxisValue, type AppearanceValues } from "@/lib/theme";

/**
 * Resolves every appearance axis to a concrete attribute on <html> before first
 * paint, so the shell never flashes the wrong surfaces during hydration.
 *
 * This matters more now that a theme owns every surface rather than the accent
 * alone: getting it wrong for one frame is a whole app repainting, not a button
 * changing colour.
 *
 * Runs synchronously in <head>, ahead of any React code. `appearance` is the
 * server-side answer — the User record's choices, or the role default and the
 * house palette — used when the browser has no stored mirror yet.
 *
 * The valid values are inlined into the script text rather than imported: the
 * check has to happen without a module, and an unknown value (a renamed theme,
 * a hand-edited localStorage) has to fall back rather than being set on the
 * attribute, where it would select a rule that does not exist and paint an
 * unstyled app. Inlined, but not written out by hand — the list comes from
 * `AXES`, the same list the store validates against, so the two cannot drift
 * into disagreeing for a frame.
 *
 * Emitted as `text/plain` on the client so it stays inert on soft navigations
 * and doesn't trip React's dev warning about rendered <script> tags — see
 * next/docs "How to prevent flash before hydration".
 */
export function ThemeScript({ appearance }: { appearance: AppearanceValues }) {
  // One line per axis. `a` is the attribute, `k` the localStorage key, `f` the
  // server-side fallback, `ok` the values this axis offers, and `d` whether the
  // stored value still has to ask the device (the mode's 'system').
  const calls = AXES.map((axis) => {
    const fallback = isAxisValue(axis, appearance[axis.id])
      ? appearance[axis.id]
      : axis.fallback;
    const values = axis.options.map((option) => option.value);
    return `s(${JSON.stringify(axis.attribute)},${JSON.stringify(
      axis.storageKey,
    )},${JSON.stringify(fallback)},${JSON.stringify(values)},${
      axis.asksTheDevice ? 1 : 0
    });`;
  }).join("\n");

  const script = `(function(){try{
var d=document.documentElement;
function s(a,k,f,ok,q){
var v=null;try{v=localStorage.getItem(k)}catch(e){}
if(ok.indexOf(v)<0){v=f}
if(q&&v==="system"){v=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}
d.setAttribute(a,v)}
${calls}
}catch(e){}})();`;

  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
