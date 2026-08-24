"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/feedback/notice";
import { AccentSwatches } from "@/components/theme/accent-swatches";
import { useTheme } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import type { ThemePreference } from "@/lib/theme";

const MODES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always the light surfaces." },
  {
    value: "system",
    label: "System",
    hint: "Follows this device's appearance setting.",
  },
  { value: "dark", label: "Dark", hint: "Always the dark surfaces." },
];

/**
 * Settings → My profile → Appearance: the two choices that make the app look
 * like yours, and the only settings on that screen that take effect as you
 * click rather than on submit.
 *
 * There is no Save button on purpose. The store applies the change to <html>
 * immediately, so the page you are looking at *is* the preview — a swatch grid
 * that needed a confirmation step would be asking you to commit to a color you
 * hadn't seen yet. The write to your user row rides along behind it.
 *
 * That write is the only thing that can fail, and it fails softly: the choice
 * is already applied and already mirrored to localStorage, so all that is lost
 * is it following you to another browser. Saying so is more useful than a
 * blocking error on a color picker.
 */
export function AppearanceControls() {
  const { preference, theme, setPreference } = useTheme();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function chooseMode(next: ThemePreference) {
    setPreference(next);
    setFailed(false);
    startTransition(async () => {
      try {
        await saveAppearance({ preference: next });
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      {failed ? (
        <Notice tone="error">
          Your choice is applied and will stick on this browser, but it
          couldn&rsquo;t be saved to your account — it won&rsquo;t follow you to
          another machine until it saves. Try again, or reload and re-pick.
        </Notice>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-micro uppercase text-ink-faint">
          Surfaces
        </legend>
        <div
          role="radiogroup"
          aria-label="Color theme"
          className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
        >
          {MODES.map((mode) => {
            const selected = preference === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={selected}
                title={mode.hint}
                onClick={() => chooseMode(mode.value)}
                className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
                  selected
                    ? "bg-segmented-thumb text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-detail text-ink-muted">
          {preference === "system"
            ? `Following this device, which is currently ${theme}.`
            : MODES.find((mode) => mode.value === preference)?.hint}
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-micro uppercase text-ink-faint">
          Accent
        </legend>
        <AccentSwatches onFail={setFailed} />

        <p className="mt-2 text-detail text-ink-muted">
          Changes buttons, links, selection, the focus ring, the nav highlight
          and the &ldquo;now&rdquo; in the wordmark. Status colors — overdue,
          paid, damaged — never follow the accent, so red keeps meaning red.
        </p>
      </fieldset>
    </div>
  );
}
