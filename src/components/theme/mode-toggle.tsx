"use client";

import { useTransition } from "react";
import { useAppearance } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import type { ColorMode } from "@/lib/theme";

const OPTIONS: { value: ColorMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
];

/**
 * Segmented pill control, per the "Segmented pill controls" spec: a sunken
 * track with a raised thumb on the selected option.
 *
 * Light / dark / system only — the half of appearance that says how bright the
 * app is. Which of the six themes is loaded is `ThemePicker`, and the two are
 * independent: every theme has a light and a dark face, so this control still
 * means exactly what it says whichever one you are on.
 *
 * The hydration render shows the server-side default; the store swaps in the
 * stored choice immediately after. Page colours never flash — ThemeScript
 * settled those before first paint — only the thumb moves.
 *
 * It writes to the user row like the full control does, so switching here isn't
 * a choice that quietly behaves differently from the same switch one screen
 * over. A failed write is swallowed: the localStorage mirror already holds it
 * for this browser, and a reference page is no place to surface a database
 * error.
 */
export function ModeToggle() {
  const { mode, setMode } = useAppearance();
  const [, startTransition] = useTransition();

  function choose(next: ColorMode) {
    setMode(next);
    startTransition(async () => {
      try {
        await saveAppearance({ mode: next });
      } catch {
        // Applied and mirrored regardless; see above.
      }
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color mode"
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(option.value)}
            className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
              selected
                ? "bg-segmented-thumb text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
