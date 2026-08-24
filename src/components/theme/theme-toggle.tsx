"use client";

import { useTransition } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
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
 *
 * Theme and accent together are Settings → My profile → Appearance; this is the
 * theme half on its own, for the foundations reference. It writes to the user
 * row like the full control does, so switching here isn't a choice that quietly
 * behaves differently from the same switch one screen over. A failed write is
 * swallowed: the localStorage mirror already holds it for this browser, and a
 * reference page is no place to surface a database error.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const [, startTransition] = useTransition();

  function choose(next: ThemePreference) {
    setPreference(next);
    startTransition(async () => {
      try {
        await saveAppearance({ preference: next });
      } catch {
        // Applied and mirrored regardless; see above.
      }
    });
  }

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
