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
  ACCENT_ATTRIBUTE,
  DEFAULT_ACCENT,
  THEME_ATTRIBUTE,
  type AccentId,
  type ThemePreference,
} from "@/lib/theme";

const ThemeContext = createContext<ThemeStore | null>(null);

/**
 * Publishes the theme store and keeps `data-theme` and `data-accent` on <html>
 * in step with it.
 *
 * Both attributes are already correct before hydration — ThemeScript resolves
 * them in <head>, ahead of any React code — so the effects below are only there
 * to carry later changes (a user switching theme or accent, the OS flipping
 * while the preference is 'system') back out to the DOM.
 *
 * The defaults come from the server: the User record's stored choices, or the
 * role default and the brand accent. Writing a change back to the User row is
 * `lib/actions/appearance`; the localStorage mirror is what prevents the
 * pre-paint flash on the next load.
 */
export function ThemeProvider({
  children,
  defaultPreference = "system",
  defaultAccent = DEFAULT_ACCENT,
}: {
  children: React.ReactNode;
  defaultPreference?: ThemePreference;
  defaultAccent?: AccentId;
}) {
  const [store] = useState(() =>
    createThemeStore(defaultPreference, defaultAccent),
  );
  const { theme, accent } = useSyncExternalStore(
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

  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute(ACCENT_ATTRIBUTE) !== accent) {
      root.setAttribute(ACCENT_ATTRIBUTE, accent);
    }
  }, [accent]);

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
    () => ({
      ...state,
      setPreference: store.setPreference,
      setAccent: store.setAccent,
    }),
    [state, store],
  );
}
