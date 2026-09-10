"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { audioReady, buzz, playTone, unlockAudio, type Tone } from "@/lib/scan/audio";
import { audibleStore } from "@/lib/scan/audible-store";

/**
 * The field a barcode gun types into.
 *
 * **It never drops a scan.** Both existing scan panels — the order record's
 * check-out and check-in wells — open with `if (!scanned || busy) return`, and
 * Next dispatches Server Functions one at a time. A gun firing faster than the
 * round trip therefore discards units silently, which on an outbound of sixty
 * boxes means an order that says it shipped complete and did not. Here the
 * input clears synchronously and the code goes onto a queue that drains one at
 * a time; the person is never made to wait for the network, and nothing is lost
 * if they outrun it.
 *
 * The queue is capped. Past the cap a scan is refused out loud rather than
 * accepted into a backlog — sixty scans into a stalled network is worse than
 * being told to stop at twenty-five.
 *
 * A gun ends a code with a carriage return, so the terminator is the signal:
 * Enter commits, and so does Tab, which some guns are configured to send
 * instead. No keystroke-timing heuristics — they break the person typing a
 * serial by hand, which is the other half of what this field is for.
 *
 * An identical code within 400ms is ignored. That is a stuttering gun
 * re-emitting one scan; no two units share a barcode, and a person deliberately
 * re-scanning the same unit is always slower than that and gets the server's
 * honest answer.
 *
 * The armed strip is not decoration. A gun firing into a blurred document is
 * the number one silent failure on surfaces like this, and today's screen gives
 * no indication at all that focus has gone.
 */

export type ScanCommit = (code: string) => Promise<Tone> | Tone;

const QUEUE_CAP = 25;
const REPEAT_MS = 400;

export function ScanField({
  onCommit,
  placeholder = "Scan or type a barcode",
  /** Blocked while a prompt is open — a scan must not queue behind a question. */
  blocked = false,
  blockedReason,
  pending,
}: {
  onCommit: ScanCommit;
  placeholder?: string;
  blocked?: boolean;
  blockedReason?: string;
  /** How many scans are waiting, shown so a backlog is never invisible. */
  pending?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const [armed, setArmed] = useState(true);
  const [hint, setHint] = useState("");

  const audible = useSyncExternalStore(
    audibleStore.subscribe,
    audibleStore.getSnapshot,
    audibleStore.getServerSnapshot,
  );

  const sound = useCallback(
    (tone: Tone) => {
      if (!audible) return;
      playTone(tone);
      if (tone === "error") buzz();
      if (!audioReady()) setHint("Tap the field once to let the browser play the chime.");
    },
    [audible],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length > 0) {
        const code = queue.current.shift()!;
        const tone = await onCommit(code);
        sound(tone);
      }
    } finally {
      draining.current = false;
    }
  }, [onCommit, sound]);

  function commit() {
    const input = inputRef.current;
    if (!input) return;
    const code = input.value.trim();
    // Cleared before anything async, so the next scan has somewhere to land in
    // the same tick.
    input.value = "";
    if (!code) return;

    if (blocked) {
      setHint(blockedReason ?? "Answer the question above first.");
      sound("error");
      return;
    }

    const now = Date.now();
    const previous = lastCode.current;
    if (previous && previous.code === code && now - previous.at < REPEAT_MS) {
      return;
    }
    lastCode.current = { code, at: now };

    if (queue.current.length >= QUEUE_CAP) {
      setHint("The network is behind — stop scanning until this catches up.");
      sound("error");
      return;
    }

    setHint("");
    queue.current.push(code);
    void drain();
  }

  // Keep the gun pointed at the field. A click on a button or a link is a
  // deliberate move away; anything else in the panel returns focus.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, select, textarea, [role='dialog']")) {
        return;
      }
      inputRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
          <span className="sr-only">Barcode or serial</span>
          <input
            ref={inputRef}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder={placeholder}
            onFocus={() => {
              setArmed(true);
              unlockAudio();
            }}
            onBlur={() => setArmed(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Tab") {
                // Tab would otherwise move focus and disarm the scanner
                // mid-session.
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.currentTarget.value = "";
              }
            }}
            className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
          />
        </label>

        <label className="flex items-center gap-2 rounded-pill bg-panel px-3 py-2 shadow-sm">
          <input
            type="checkbox"
            checked={audible}
            onChange={(event) => {
              // The click is the gesture the browser wants before it will make
              // a sound at all.
              unlockAudio();
              audibleStore.set(event.target.checked);
              if (event.target.checked) playTone("ok");
            }}
            className="size-4 rounded-[4px] accent-accent-solid"
          />
          <span className="text-pill text-ink">Audible</span>
        </label>
      </div>

      {!armed ? (
        <p
          role="status"
          className="rounded-well bg-[var(--warning)] px-3 py-1 text-detail text-[var(--warning-on)]"
        >
          Scanner not armed — click the field before scanning.
        </p>
      ) : null}

      {pending ? (
        <p role="status" className="text-detail text-ink-muted">
          {pending} {pending === 1 ? "scan" : "scans"} still going through…
        </p>
      ) : null}

      {hint ? (
        <p role="status" className="text-detail text-accent-text">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
