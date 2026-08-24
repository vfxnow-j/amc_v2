"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createThemeStore, type ThemeStore } from "@/lib/theme-store";
import {
  DEFAULT_THEME,
  MODE_ATTRIBUTE,
  THEME_ATTRIBUTE,
  type ColorMode,
  type ThemeId,
} from "@/lib/theme";

const ThemeContext = createContext<ThemeStore | null>(null);

/**
 * Publishes the appearance store and keeps `data-mode` and `data-theme` on
 * <html> in step with it.
 *
 * Both attributes are already correct before hydration — ThemeScript resolves
 * them in <head>, ahead of any React code — so the effects below are only there
 * to carry later changes (a user switching mode or theme, the OS flipping while
 * the mode is 'system') back out to the DOM.
 *
 * The defaults come from the server: the User record's stored choices, or the
 * role default and the house theme. Writing a change back to the User row is
 * `lib/actions/appearance`; the localStorage mirror is what prevents the
 * pre-paint flash on the next load.
 */
export function ThemeProvider({
  children,
  defaultMode = "system",
  defaultTheme = DEFAULT_THEME,
}: {
  children: React.ReactNode;
  defaultMode?: ColorMode;
  defaultTheme?: ThemeId;
}) {
  const [store] = useState(() => createThemeStore(defaultMode, defaultTheme));
  const { resolved, theme } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute(MODE_ATTRIBUTE) !== resolved) {
      root.setAttribute(MODE_ATTRIBUTE, resolved);
    }
  }, [resolved]);

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute(THEME_ATTRIBUTE) !== theme) {
      root.setAttribute(THEME_ATTRIBUTE, theme);
    }
  }, [theme]);

  return <ThemeContext value={store}>{children}</ThemeContext>;
}

export function useAppearance() {
  const store = useContext(ThemeContext);
  if (!store) {
    throw new Error("useAppearance must be used within a ThemeProvider");
  }

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  return useMemo(
    () => ({ ...state, setMode: store.setMode, setTheme: store.setTheme }),
    [state, store],
  );
}
