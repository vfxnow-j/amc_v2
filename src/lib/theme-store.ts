import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  isAccentId,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type AccentId,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

export type ThemeState = {
  /** What the user chose — may be 'system'. */
  preference: ThemePreference;
  /** What is actually on screen. */
  theme: ResolvedTheme;
  /** Which accent ramp is loaded. Independent of light/dark. */
  accent: AccentId;
};

export type ThemeStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => ThemeState;
  getServerSnapshot: () => ThemeState;
  setPreference: (preference: ThemePreference) => void;
  setAccent: (accent: AccentId) => void;
};

/**
 * The theme lives in localStorage and `prefers-color-scheme`, both of which are
 * external to React, so it is exposed as a store for `useSyncExternalStore`
 * rather than mirrored into state by an effect. That gets three things for free:
 * the hydration render uses the server snapshot (no mismatch), post-hydration
 * renders read the real preference (no flash, no `mounted` flag), and OS or
 * cross-tab changes push straight through.
 *
 * The defaults are the server-side values — the User record's choices, or the
 * role default (dark for STAFF, light for admin/finance) and the brand accent —
 * used until the browser has stored a choice. Persisting a change back to the
 * server is the caller's job: this store owns the mirror and the paint, and
 * knows nothing about actions.
 */
export function createThemeStore(
  defaultPreference: ThemePreference,
  defaultAccent: AccentId = DEFAULT_ACCENT,
): ThemeStore {
  const serverState: ThemeState = {
    preference: defaultPreference,
    theme: resolveTheme(defaultPreference),
    accent: defaultAccent,
  };

  // useSyncExternalStore compares snapshots by identity, so the same object is
  // handed back until one of the values actually changes.
  let cache: ThemeState = serverState;
  const listeners = new Set<() => void>();
  let media: MediaQueryList | null = null;
  // This session's choices, so both still switch when storage is blocked.
  // Storage wins when readable, so another tab's change still lands here.
  let chosen: ThemePreference | null = null;
  let chosenAccent: AccentId | null = null;

  function mediaQuery() {
    media ??= window.matchMedia("(prefers-color-scheme: dark)");
    return media;
  }

  function read(): ThemeState {
    let preference = chosen ?? defaultPreference;
    let accent = chosenAccent ?? defaultAccent;
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(stored)) preference = stored;
      const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (isAccentId(storedAccent)) accent = storedAccent;
    } catch {
      // Storage unavailable (private mode, blocked cookies) — fall back to the
      // server-supplied defaults.
    }
    return { preference, theme: resolveTheme(preference), accent };
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
        next.theme !== cache.theme ||
        next.accent !== cache.accent
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
        // Non-fatal: `chosen` keeps the theme applied for this session, and the
        // server-side preference restores it on the next load.
      }
      notify();
    },

    setAccent(accent) {
      chosenAccent = accent;
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, accent);
      } catch {
        // As above.
      }
      notify();
    },
  };
}
