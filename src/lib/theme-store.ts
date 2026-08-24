import {
  DEFAULT_THEME,
  isColorMode,
  isThemeId,
  MODE_STORAGE_KEY,
  resolveMode,
  THEME_STORAGE_KEY,
  type ColorMode,
  type ResolvedMode,
  type ThemeId,
} from "@/lib/theme";

export type AppearanceState = {
  /** What the user chose — may be 'system'. */
  mode: ColorMode;
  /** What is actually on screen. */
  resolved: ResolvedMode;
  /** Which of the six themes is loaded. Independent of the mode. */
  theme: ThemeId;
};

export type ThemeStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => AppearanceState;
  getServerSnapshot: () => AppearanceState;
  setMode: (mode: ColorMode) => void;
  setTheme: (theme: ThemeId) => void;
};

/**
 * Appearance lives in localStorage and `prefers-color-scheme`, both of which
 * are external to React, so it is exposed as a store for `useSyncExternalStore`
 * rather than mirrored into state by an effect. That gets three things for free:
 * the hydration render uses the server snapshot (no mismatch), post-hydration
 * renders read the real choice (no flash, no `mounted` flag), and OS or
 * cross-tab changes push straight through.
 *
 * The defaults are the server-side values — the User record's choices, or the
 * role default (dark for STAFF, light for admin and finance) and the house
 * theme — used until the browser has stored a choice. Persisting a change back
 * to the server is the caller's job: this store owns the mirror and the paint,
 * and knows nothing about actions.
 */
export function createThemeStore(
  defaultMode: ColorMode,
  defaultTheme: ThemeId = DEFAULT_THEME,
): ThemeStore {
  const serverState: AppearanceState = {
    mode: defaultMode,
    resolved: resolveMode(defaultMode),
    theme: defaultTheme,
  };

  // useSyncExternalStore compares snapshots by identity, so the same object is
  // handed back until one of the values actually changes.
  let cache: AppearanceState = serverState;
  const listeners = new Set<() => void>();
  let media: MediaQueryList | null = null;
  // This session's choices, so both still switch when storage is blocked.
  // Storage wins when readable, so another tab's change still lands here.
  let chosenMode: ColorMode | null = null;
  let chosenTheme: ThemeId | null = null;

  function mediaQuery() {
    media ??= window.matchMedia("(prefers-color-scheme: dark)");
    return media;
  }

  function read(): AppearanceState {
    let mode = chosenMode ?? defaultMode;
    let theme = chosenTheme ?? defaultTheme;
    try {
      const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
      if (isColorMode(storedMode)) mode = storedMode;
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(storedTheme)) theme = storedTheme;
    } catch {
      // Storage unavailable (private mode, blocked cookies) — fall back to the
      // server-supplied defaults.
    }
    return { mode, resolved: resolveMode(mode), theme };
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
        next.mode !== cache.mode ||
        next.resolved !== cache.resolved ||
        next.theme !== cache.theme
      ) {
        cache = next;
      }
      return cache;
    },

    getServerSnapshot: () => serverState,

    setMode(mode) {
      chosenMode = mode;
      try {
        localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch {
        // Non-fatal: `chosenMode` keeps it applied for this session, and the
        // server-side choice restores it on the next load.
      }
      notify();
    },

    setTheme(theme) {
      chosenTheme = theme;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // As above.
      }
      notify();
    },
  };
}
