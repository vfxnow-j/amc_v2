"use client";

import { useTransition } from "react";
import { useAppearance } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import { THEMES } from "@/lib/theme";

/**
 * Picking a theme, in the two shapes the app needs it.
 *
 * One component rather than two, because "how you choose a theme" is one thing:
 * the selection, the chip for the current mode, the write to your user row and
 * the quiet failure when that write doesn't land are identical in both places.
 * Only the layout differs.
 *
 * - `cards` — named, with a blurb, for the Appearance card on your profile.
 * - `grid` — chips only, for the account menu in the rail, which is 208px wide.
 *   The name is on the `title` and the accessible name, so the control is still
 *   labelled for anyone who can't see the colours.
 *
 * The chip shows three colours, not one. A theme sets every surface now, so a
 * single dot could not say what you were choosing — ground, panel and accent
 * together are the smallest honest preview of what the app will look like. They
 * are read off the same generated ramps the CSS uses, so the chip cannot drift
 * from the theme it advertises.
 *
 * This is the only place in the app that inlines literal colours. It has to:
 * the eleven themes you are *not* on aren't loaded, so their colours cannot
 * come from a token. `grid` is three across, so twelve themes is four tidy
 * rows in a 208px rail; a thirteenth would want a scroll or a fourth column.
 */
export function ThemePicker({
  layout = "cards",
  onFail,
}: {
  layout?: "cards" | "grid";
  /** Told when the write to the user row failed; the choice still applied. */
  onFail?: (failed: boolean) => void;
}) {
  const { resolved, values, set } = useAppearance();
  const [, startTransition] = useTransition();

  function choose(next: string) {
    set("theme", next);
    onFail?.(false);
    startTransition(async () => {
      try {
        await saveAppearance({ theme: next });
      } catch {
        onFail?.(true);
      }
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={
        layout === "grid" ? "grid grid-cols-3 gap-1" : "grid gap-2 sm:grid-cols-2"
      }
    >
      {THEMES.map((option) => {
        const selected = values.theme === option.id;
        const chip = resolved === "dark" ? option.swatch.dark : option.swatch.light;

        const preview = (
          <span
            aria-hidden
            className="flex flex-none overflow-hidden rounded-tile ring-1 ring-hairline ring-inset"
          >
            <span className="size-5" style={{ background: chip.ground }} />
            <span className="size-5" style={{ background: chip.panel }} />
            <span className="size-5" style={{ background: chip.accent }} />
          </span>
        );

        if (layout === "grid") {
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={`${option.label} — ${option.blurb}`}
              onClick={() => choose(option.id)}
              className={`flex items-center justify-center rounded-well p-1 transition-shadow ${
                selected
                  ? "ring-2 ring-ink ring-offset-2 ring-offset-panel"
                  : "hover:ring-1 hover:ring-hairline"
              }`}
            >
              {preview}
            </button>
          );
        }

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(option.id)}
            className={`flex items-start gap-2 rounded-well p-2 text-left transition-colors ${
              selected
                ? "bg-accent-tint text-accent-on-tint"
                : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink"
            }`}
          >
            {preview}
            <span className="min-w-0">
              <span className="block text-pill">{option.label}</span>
              <span className="block text-detail text-balance opacity-80">
                {option.blurb}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
