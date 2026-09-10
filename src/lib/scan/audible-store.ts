/**
 * Whether the scanner makes a sound, remembered per device.
 *
 * A store for `useSyncExternalStore` rather than state mirrored by an effect —
 * the same shape and the same reasoning as `lib/theme-store`: the hydration
 * render uses the server snapshot so there is no mismatch, post-hydration reads
 * get the real choice with no `mounted` flag, and a second tab flipping it
 * pushes straight through.
 *
 * **Per device, not per user, and deliberately.** The phone in the warehouse
 * should beep and the shared desk in the office probably should not, and it is
 * the same person at both. A column on `User` would make one of those two
 * wrong, and would cost a migration to do it.
 *
 * Default off. There is no `prefers-reduced-sound` to honour, so the honest
 * equivalents are opting in rather than out, a low peak gain, and never making
 * a noise the person did not cause.
 */

export const AUDIBLE_STORAGE_KEY = "vfxnow-amc-scan-audible";

export type AudibleStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
  set: (audible: boolean) => void;
};

function read(): boolean {
  try {
    return window.localStorage.getItem(AUDIBLE_STORAGE_KEY) === "on";
  } catch {
    // Private mode, or site data blocked. Silence is the safe default.
    return false;
  }
}

export function createAudibleStore(): AudibleStore {
  // Held in memory as well, so the toggle still works when localStorage throws.
  let chosen: boolean | null = null;
  const listeners = new Set<() => void>();

  function snapshot(): boolean {
    if (chosen !== null) return chosen;
    return read();
  }

  function announce() {
    for (const listener of listeners) listener();
  }

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key === AUDIBLE_STORAGE_KEY) {
          chosen = null;
          onChange();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: snapshot,
    // The server cannot know a per-device choice, so it always renders "off"
    // and the first client snapshot corrects it. Nothing visible depends on it
    // beyond the state of one checkbox.
    getServerSnapshot: () => false,
    set(audible) {
      chosen = audible;
      try {
        window.localStorage.setItem(AUDIBLE_STORAGE_KEY, audible ? "on" : "off");
      } catch {
        // Kept in memory for this session instead.
      }
      announce();
    },
  };
}

/**
 * One store for the app.
 *
 * The choice is per device, so there is nothing to scope per component — and a
 * store created during render trips `react-hooks/refs`, correctly: a ref read
 * while rendering is exactly the pattern that breaks under concurrent
 * rendering. Creating it at module scope is safe because nothing here touches
 * `window` until `subscribe` or `getSnapshot` is called.
 */
export const audibleStore = createAudibleStore();
