import {
  attributeValue,
  AXES,
  axisById,
  isAxisValue,
  normalizeAppearance,
  type AppearanceValues,
  type AxisId,
  type ResolvedMode,
} from "@/lib/theme";

export type AppearanceState = {
  /** What the user chose, per axis. The mode may still be 'system'. */
  values: AppearanceValues;
  /** What the mode actually resolved to, which is what is on screen. */
  resolved: ResolvedMode;
};

export type ThemeStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => AppearanceState;
  getServerSnapshot: () => AppearanceState;
  /** Apply and mirror one axis. Persisting to the row is the caller's job. */
  set: (axis: AxisId, value: string) => void;
};

/**
 * Appearance lives in localStorage and `prefers-color-scheme`, both of which
 * are external to React, so it is exposed as a store for `useSyncExternalStore`
 * rather than mirrored into state by an effect. That gets three things for free:
 * the hydration render uses the server snapshot (no mismatch), post-hydration
 * renders read the real choice (no flash, no `mounted` flag), and OS or
 * cross-tab changes push straight through.
 *
 * Every axis is handled by walking `AXES` — there is no `mode` or `theme` named
 * anywhere below. That is not tidiness: the pre-paint script has to inline its
 * own copy of this logic, and the two agreeing on which values are valid is the
 * difference between a clean load and a frame of the wrong theme. They agree
 * because they read the same list.
 *
 * The defaults are the server-side values — the User record's choices, or the
 * role default (dark for STAFF, light for admin and finance) and the house
 * theme — used until the browser has stored a choice. Persisting a change back
 * to the server is the caller's job: this store owns the mirror and the paint,
 * and knows nothing about actions.
 */
export function createThemeStore(defaults: AppearanceValues): ThemeStore {
  const modeAxis = axisById("mode");

  function stateOf(values: AppearanceValues): AppearanceState {
    return {
      values,
      resolved: attributeValue(modeAxis, values.mode) as ResolvedMode,
    };
  }

  // `resolved` on the server is whatever resolveMode() says without a window,
  // which is 'light'; the pre-paint script has already put the real answer on
  // <html>, so this only has to match what the server rendered.
  const serverState = stateOf(defaults);

  // useSyncExternalStore compares snapshots by identity, so the same object is
  // handed back until one of the values actually changes.
  let cache: AppearanceState = serverState;
  const listeners = new Set<() => void>();
  let media: MediaQueryList | null = null;
  // This session's choices, so every axis still switches when storage is
  // blocked. Storage wins when readable, so another tab's change still lands.
  const chosen: Partial<AppearanceValues> = {};

  function mediaQuery() {
    media ??= window.matchMedia("(prefers-color-scheme: dark)");
    return media;
  }

  function read(): AppearanceState {
    const stored: Partial<Record<AxisId, unknown>> = {};
    for (const axis of AXES) {
      stored[axis.id] = chosen[axis.id];
      try {
        const value = localStorage.getItem(axis.storageKey);
        if (isAxisValue(axis, value)) stored[axis.id] = value;
      } catch {
        // Storage unavailable (private mode, blocked cookies) — the session
        // choice, then the server-supplied default, carry it.
      }
    }
    return stateOf(normalizeAppearance(stored, defaults));
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    subscribe(onChange) {
      if (listeners.size === 0) {
        mediaQuery().addEventListener("change", notify);
        window.addEventListener("storage", notify);
      }
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          mediaQuery().removeEventListener("change", notify);
          window.removeEventListener("storage", notify);
        }
      };
    },

    getSnapshot() {
      const next = read();
      const changed =
        next.resolved !== cache.resolved ||
        AXES.some((axis) => next.values[axis.id] !== cache.values[axis.id]);
      if (changed) cache = next;
      return cache;
    },

    getServerSnapshot: () => serverState,

    set(axis, value) {
      const definition = axisById(axis);
      if (!isAxisValue(definition, value)) return;
      chosen[axis] = value;
      try {
        localStorage.setItem(definition.storageKey, value);
      } catch {
        // Non-fatal: `chosen` keeps it applied for this session, and the
        // server-side choice restores it on the next load.
      }
      notify();
    },
  };
}
