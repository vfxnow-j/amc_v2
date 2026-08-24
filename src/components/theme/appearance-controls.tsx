"use client";

import { useState, useTransition } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { Notice } from "@/components/feedback/notice";
import { saveAppearance } from "@/lib/actions/appearance";
import { ACCENTS, type AccentId, type ThemePreference } from "@/lib/theme";

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
 * that needed a confirmation step would be asking you to commit to a colour you
 * hadn't seen yet. The write to your user row rides along behind it.
 *
 * That write is the only thing that can fail, and it fails softly: the choice
 * is already applied and already mirrored to localStorage, so all that is lost
 * is it following you to another browser. Saying so is more useful than a
 * blocking error on a colour picker.
 */
export function AppearanceControls() {
  const { preference, theme, accent, setPreference, setAccent } = useTheme();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function persist(input: { preference?: ThemePreference; accent?: AccentId }) {
    setFailed(false);
    startTransition(async () => {
      try {
        await saveAppearance(input);
      } catch {
        setFailed(true);
      }
    });
  }

  function chooseMode(next: ThemePreference) {
    setPreference(next);
    persist({ preference: next });
  }

  function chooseAccent(next: AccentId) {
    setAccent(next);
    persist({ accent: next });
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
          aria-label="Colour theme"
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
        <div
          role="radiogroup"
          aria-label="Accent colour"
          className="flex flex-wrap gap-2"
        >
          {ACCENTS.map((option) => {
            const selected = accent === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={option.note ?? option.label}
                onClick={() => chooseAccent(option.id)}
                className={`flex items-center gap-2 rounded-pill py-1 pl-1 pr-3 text-pill transition-colors ${
                  selected
                    ? "bg-accent-tint text-accent-on-tint"
                    : "bg-sunken text-ink-muted hover:bg-row-hover hover:text-ink"
                }`}
              >
                <span
                  aria-hidden
                  className="size-5 rounded-tile ring-1 ring-hairline ring-inset"
                  // The one place in the app a literal colour is inlined: the
                  // eleven ramps this picker offers are not loaded, so their
                  // swatch cannot come from a token. `swatch` carries the same
                  // stop the accent would fill with in the current theme.
                  style={{
                    background:
                      theme === "dark"
                        ? option.swatch.dark
                        : option.swatch.light,
                  }}
                />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-detail text-ink-muted">
          Changes buttons, links, selection, the focus ring, the nav highlight
          and the &ldquo;now&rdquo; in the wordmark. Status colours — overdue,
          paid, damaged — never follow the accent, so red keeps meaning red.
        </p>
      </fieldset>
    </div>
  );
}
