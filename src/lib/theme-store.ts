import {
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

export type ThemeState = {
  /** What the user chose — may be 'system'. */
  preference: ThemePreference;
  /** What is actually on screen. */
  theme: ResolvedTheme;
};

export type ThemeStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ThemeState;
  getServerSnapshot: () => ThemeState;
  setPreference: (preference: ThemePreference) => void;
};

/**
 * The theme lives in localStorage and `prefers-color-scheme`, both of which are
 * external to React, so it is exposed as a store for `useSyncExternalStore`
 * rather than mirrored into state by an effect. That gets three things for free:
 * the hydration render uses the server snapshot (no mismatch), post-hydration
 * renders read the real preference (no flash, no `mounted` flag), and OS or
 * cross-tab changes push straight through.
 *
 * `defaultPreference` is the server-side value — the User record's theme, or the
 * role default (dark for STAFF, light for admin/finance) — used until the
 * browser has stored a choice.
 */
export function createThemeStore(
  defaultPreference: ThemePreference,
): ThemeStore {
  const serverState: ThemeState = {
    preference: defaultPreference,
    theme: resolveTheme(defaultPreference),
  };

  // useSyncExternalStore compares snapshots by identity, so the same object is
  // handed back until one of the values actually changes.
  let cache: ThemeState = serverState;
  const listeners = new Set<() => void>();
  let media: MediaQueryList | null = null;
  // This session's choice, so the theme still switches when storage is blocked.
  // Storage wins when readable, so another tab's change still lands here.
  let chosen: ThemePreference | null = null;

  function mediaQuery() {
    media ??= window.matchMedia("(prefers-color-scheme: dark)");
    return media;
  }

  function read(): ThemeState {
    let preference = chosen ?? defaultPreference;
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(stored)) preference = stored;
    } catch {
      // Storage unavailable (private mode, blocked cookies) — fall back to the
      // server-supplied default.
    }
    return { preference, theme: resolveTheme(preference) };
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
      if (
        next.preference !== cache.preference ||
        next.theme !== cache.theme
      ) {
        cache = next;
      }
      return cache;
    },

    getServerSnapshot: () => serverState,

    setPreference(preference) {
      chosen = preference;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // Non-fatal: `chosen` keeps the theme applied for this session, it just
        // won't survive a reload until the server-side preference lands.
      }
      notify();
    },
  };
}
