"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/feedback/notice";
import { ThemePicker } from "@/components/theme/theme-picker";
import { useAppearance } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import type { ColorMode } from "@/lib/theme";

const MODES: { value: ColorMode; label: string; hint: string }[] = [
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
 * like yours — how bright it is, and which of the six themes it wears — and the
 * only settings on that screen that take effect as you click rather than on
 * submit.
 *
 * There is no Save button on purpose. The store applies the change to <html>
 * immediately, so the page you are looking at *is* the preview. That matters
 * more now than it did when this only swapped an accent: a theme repaints every
 * surface, and asking somebody to confirm a whole look they hadn't seen yet
 * would be the wrong way round. The write to your user row rides along behind
 * it.
 *
 * That write is the only thing that can fail, and it fails softly: the choice
 * is already applied and already mirrored to localStorage, so all that is lost
 * is it following you to another browser. Saying so is more useful than a
 * blocking error on a theme picker.
 */
export function AppearanceControls() {
  const { mode, resolved, setMode } = useAppearance();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function chooseMode(next: ColorMode) {
    setMode(next);
    setFailed(false);
    startTransition(async () => {
      try {
        await saveAppearance({ mode: next });
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
          {MODES.map((option) => {
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                title={option.hint}
                onClick={() => chooseMode(option.value)}
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
        <p className="mt-2 text-detail text-ink-muted">
          {mode === "system"
            ? `Following this device, which is currently ${resolved}.`
            : MODES.find((option) => option.value === mode)?.hint}
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-micro uppercase text-ink-faint">
          Theme
        </legend>
        <ThemePicker onFail={setFailed} />

        <p className="mt-2 text-detail text-ink-muted">
          A theme repaints everything — backgrounds, cards, wells, rules, text
          and the accent — and each one has a light and a dark face, so the
          setting above still does what it says. Status colors are the
          exception: overdue, paid and damaged never follow the theme, so red
          keeps meaning red in all six.
        </p>
      </fieldset>
    </div>
  );
}
