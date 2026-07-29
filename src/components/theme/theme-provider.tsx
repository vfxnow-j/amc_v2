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
import { THEME_ATTRIBUTE, type ThemePreference } from "@/lib/theme";

const ThemeContext = createContext<ThemeStore | null>(null);

/**
 * Publishes the theme store and keeps `data-theme` on <html> in step with it.
 *
 * The attribute is already correct before hydration — ThemeScript resolves it in
 * <head>, ahead of any React code — so the effect below is only there to carry
 * later changes (a user switching themes, the OS flipping while the preference
 * is 'system') back out to the DOM.
 *
 * `defaultPreference` comes from the server: the User record's theme, or the
 * role default. Persisting a change back to the server is wired up when auth
 * lands; the localStorage mirror is what prevents the pre-paint flash.
 */
export function ThemeProvider({
  children,
  defaultPreference = "system",
}: {
  children: React.ReactNode;
  defaultPreference?: ThemePreference;
}) {
  const [store] = useState(() => createThemeStore(defaultPreference));
  const { theme } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute(THEME_ATTRIBUTE) !== theme) {
      root.setAttribute(THEME_ATTRIBUTE, theme);
    }
  }, [theme]);

  return <ThemeContext value={store}>{children}</ThemeContext>;
}

export function useTheme() {
  const store = useContext(ThemeContext);
  if (!store) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  return useMemo(
    () => ({ ...state, setPreference: store.setPreference }),
    [state, store],
  );
}
