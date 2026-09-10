"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/feedback/notice";
import { ThemePicker } from "@/components/theme/theme-picker";
import { useAppearance } from "@/components/theme/theme-provider";
import { saveAppearance } from "@/lib/actions/appearance";
import { AXES, type Axis } from "@/lib/theme";

/**
 * Settings → My profile → Appearance: the choices that make the app look like
 * yours, and the only settings on that screen that take effect as you click
 * rather than on submit.
 *
 * Five of them now — how bright the app is, which of the six themes it wears,
 * and three that are grain rather than look: how far the page sits below its
 * panels, and what the rail and the dashboard tiles are made of. They are one
 * loop over `AXES` rather than five hand-written fieldsets, so a sixth axis
 * appears here the moment it is added to that list. The theme is the only one
 * with its own control, because it is the only one whose options are colours
 * and need showing rather than naming.
 *
 * There is no Save button on purpose. The store applies the change to <html>
 * immediately, so the page you are looking at *is* the preview — including the
 * rail beside it and the page under it, which is exactly what three of these
 * change. That matters more than it did when this only swapped an accent:
 * asking somebody to confirm a whole look they hadn't seen yet would be the
 * wrong way round. The write to your user row rides along behind it.
 *
 * That write is the only thing that can fail, and it fails softly: the choice
 * is already applied and already mirrored to localStorage, so all that is lost
 * is it following you to another browser. Saying so is more useful than a
 * blocking error on a theme picker.
 */
export function AppearanceControls() {
  const { values, resolved, set } = useAppearance();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function choose(axis: Axis, next: string) {
    set(axis.id, next);
    setFailed(false);
    startTransition(async () => {
      try {
        await saveAppearance({ [axis.id]: next });
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

      {AXES.map((axis) => {
        const value = values[axis.id];
        const isTheme = axis.id === "theme";

        return (
          <fieldset key={axis.id}>
            <legend className="mb-2 text-micro uppercase text-ink-faint">
              {axis.label}
            </legend>

            {isTheme ? (
              <ThemePicker onFail={setFailed} />
            ) : (
              <div
                role="radiogroup"
                aria-label={axis.label}
                className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
              >
                {axis.options.map((option) => {
                  const selected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={option.hint}
                      onClick={() => choose(axis, option.value)}
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
            )}

            {!isTheme ? (
              <p className="mt-2 text-detail text-ink-muted">
                {axis.asksTheDevice && value === "system"
                  ? `Following this device, which is currently ${resolved}.`
                  : axis.options.find((option) => option.value === value)?.hint}
              </p>
            ) : null}

            {axis.blurb ? (
              <p className="mt-2 text-detail text-ink-faint text-balance">
                {axis.blurb}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
