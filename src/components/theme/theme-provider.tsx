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
import { attributeValue, AXES, type AppearanceValues } from "@/lib/theme";

const ThemeContext = createContext<ThemeStore | null>(null);

/**
 * Publishes the appearance store and keeps every axis attribute on <html> in
 * step with it — `data-mode`, `data-theme`, `data-surface`, `data-nav`,
 * `data-tile`, and whatever is added to `AXES` next.
 *
 * All of them are already correct before hydration — ThemeScript resolves them
 * in <head>, ahead of any React code — so the effect below is only there to
 * carry later changes (a user switching a control, the OS flipping while the
 * mode is 'system') back out to the DOM.
 *
 * The defaults come from the server: the User record's stored choices, or the
 * role default and the house theme. Writing a change back to the User row is
 * `lib/actions/appearance`; the localStorage mirror is what prevents the
 * pre-paint flash on the next load.
 */
export function ThemeProvider({
  children,
  appearance,
}: {
  children: React.ReactNode;
  appearance: AppearanceValues;
}) {
  const [store] = useState(() => createThemeStore(appearance));
  const { values } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    const root = document.documentElement;
    for (const axis of AXES) {
      const next = attributeValue(axis, values[axis.id]);
      if (root.getAttribute(axis.attribute) !== next) {
        root.setAttribute(axis.attribute, next);
      }
    }
  }, [values]);

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

  return useMemo(() => ({ ...state, set: store.set }), [state, store]);
}
