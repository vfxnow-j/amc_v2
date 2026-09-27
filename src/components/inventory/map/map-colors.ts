import type { MapKind } from "@/lib/map/types";

/**
 * What colour each kind of point is, as CSS colour expressions the app's own
 * tokens resolve. The legend paints these directly; the canvas can't read a CSS
 * variable, so it resolves them through `resolveColors` and re-resolves when the
 * theme or mode changes.
 *
 * Order types lean on hues that hold across all twelve themes (success,
 * warning, a violet) so a Rental and a Sale never collapse into one colour on a
 * theme whose accent happens to be green. Only Rental — the bulk of the fleet —
 * takes the theme accent.
 */
export const KIND_TOKEN: Record<MapKind, string> = {
  RENTAL: "var(--accent-solid)",
  SALE: "var(--success)",
  RENT_TO_OWN: "var(--warning)",
  FLOW: "light-dark(#7c5cff, #a58bff)",
  CLOUD: "var(--ink-muted)",
  STOCK: "var(--ink-faint)",
  CLIENT_ACTIVE: "var(--accent-solid)",
  CLIENT_IDLE: "var(--ink-faint)",
};

const EXTRA = {
  accent: "var(--accent-solid)",
  ground: "var(--ground)",
  ink: "var(--ink)",
  panel: "var(--panel)",
} as const;

export type ResolvedColors = Record<MapKind, string> & {
  accent: string;
  ground: string;
  ink: string;
  panel: string;
};

/**
 * Resolve every token to a concrete `rgb(…)` string. The tokens use
 * `light-dark()`, so reading the custom property back gives the unresolved
 * expression; a hidden probe with `color: <expr>` gives the computed colour
 * instead. Client-only.
 */
export function resolveColors(): ResolvedColors {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const read = (expr: string) => {
    probe.style.color = "";
    probe.style.color = expr;
    return getComputedStyle(probe).color || "#888888";
  };
  const out = {} as ResolvedColors;
  for (const [kind, expr] of Object.entries(KIND_TOKEN)) {
    out[kind as MapKind] = read(expr);
  }
  for (const [key, expr] of Object.entries(EXTRA)) {
    out[key as keyof typeof EXTRA] = read(expr);
  }
  probe.remove();
  return out;
}

/** Whether the app is currently painting its dark surfaces. Client-only. */
export function isDarkMode(): boolean {
  const root = document.documentElement;
  const mode = root.dataset.mode;
  if (mode === "dark") return true;
  if (mode === "light") return false;
  const scheme = getComputedStyle(root).colorScheme;
  if (scheme === "dark") return true;
  if (scheme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Call `onChange` whenever the theme, mode or appearance axes change, or the
 * OS flips light/dark. Returns the unsubscribe.
 */
export function watchAppearance(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-theme",
      "data-mode",
      "data-surface",
      "style",
      "class",
    ],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}
