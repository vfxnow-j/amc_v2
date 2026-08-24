"use client";

import { useTransition } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import { ACCENTS, type AccentId } from "@/lib/theme";

/**
 * Picking an accent, in the two shapes the app needs it.
 *
 * One component rather than two, because "how you choose an accent" is one
 * thing: the selection, the swatch color for the current theme, the write to
 * your user row and the quiet failure when that write doesn't land are
 * identical in both places. Only the layout differs.
 *
 * - `pills` — labeled, for the Appearance card on your profile, where there is
 *   room to say what each color is called.
 * - `grid` — swatches only, for the account menu in the rail, which is 208px
 *   wide. The name is on the `title` and the accessible name, so the control is
 *   still labeled for anyone who can't see the color.
 *
 * The swatch is the only place in the app that inlines a literal color. It has
 * to: the eleven ramps you are *not* on aren't loaded, so their color cannot
 * come from a token.
 */
export function AccentSwatches({
  layout = "pills",
  onFail,
}: {
  layout?: "pills" | "grid";
  /** Told when the write to the user row failed; the choice still applied. */
  onFail?: (failed: boolean) => void;
}) {
  const { theme, accent, setAccent } = useTheme();
  const [, startTransition] = useTransition();

  function choose(next: AccentId) {
    setAccent(next);
    onFail?.(false);
    startTransition(async () => {
      try {
        await saveAppearance({ accent: next });
      } catch {
        onFail?.(true);
      }
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Accent color"
      className={
        layout === "grid"
          ? "grid grid-cols-6 gap-1"
          : "flex flex-wrap gap-2"
      }
    >
      {ACCENTS.map((option) => {
        const selected = accent === option.id;
        const swatch = theme === "dark" ? option.swatch.dark : option.swatch.light;

        if (layout === "grid") {
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => choose(option.id)}
              className={`flex size-7 items-center justify-center rounded-tile transition-shadow ${
                selected
                  ? "ring-2 ring-ink ring-offset-2 ring-offset-panel"
                  : "hover:ring-1 hover:ring-hairline"
              }`}
            >
              <span
                aria-hidden
                className="size-5 rounded-tile ring-1 ring-hairline ring-inset"
                style={{ background: swatch }}
              />
            </button>
          );
        }

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.note ?? option.label}
            onClick={() => choose(option.id)}
            className={`flex items-center gap-2 rounded-pill py-1 pl-1 pr-3 text-pill transition-colors ${
              selected
                ? "bg-accent-tint text-accent-on-tint"
                : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink"
            }`}
          >
            <span
              aria-hidden
              className="size-5 rounded-tile ring-1 ring-hairline ring-inset"
              style={{ background: swatch }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
