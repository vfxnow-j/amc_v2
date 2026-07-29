"use client";

import { useTheme } from "@/components/theme/theme-provider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
];

/**
 * Segmented pill control, per the "Segmented pill controls" spec: a sunken
 * track with a raised thumb on the selected option.
 *
 * The hydration render shows the server-side default; the store swaps in the
 * stored preference immediately after. Page colours never flash — ThemeScript
 * settled those before first paint — only the thumb moves.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(option.value)}
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
