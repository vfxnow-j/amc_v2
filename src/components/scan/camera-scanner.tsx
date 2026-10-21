"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { confirmHaptic, type Tone } from "@/lib/scan/audio";

/**
 * Scan with the phone's camera instead of a gun.
 *
 * A full-screen viewfinder that stays open, so a whole shelf can be scanned
 * without reopening it. Every decoded code goes to `onDetect`, which is the
 * ScanField's own commit path — the same queue, repeat guard and chime a gun
 * gets — so the camera is only another way of typing into that field.
 *
 * Decoding is html5-qrcode with v1's settings, which already read our labels on
 * iPhone: a wide, short scan band across the middle of the frame (a linear
 * barcode needs a band, not a square), the native detector where the browser
 * has one, and a fixed list of formats.
 *
 * Camera access needs a secure context (https or localhost) and a tap, which
 * opening this overlay is.
 */

/** The same code held in frame is one scan, not a stream of them. */
const SAME_CODE_MS = 3000;

const FORMATS = [
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

const REGION_ID = "amc-camera-scanner";

/** How long the answer stays on screen, frozen, before the camera looks again. */
const HOLD_MS = 1100;
/** If the server never answers, look again rather than stay frozen. */
const GIVE_UP_MS = 5000;

export function CameraScanner({
  onDetect,
  onClose,
  result,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
  /** The server's answer to the latest scan. */
  result: { id: number; tone: Tone; code: string } | null;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // null = looking; "reading" = a code was caught and we are waiting on the answer.
  const [flash, setFlash] = useState<null | "reading" | { tone: Tone; code: string }>(null);
  const timers = useRef<number[]>([]);
  const baseline = useRef(result?.id ?? 0);

  function resumeAfter(ms: number) {
    timers.current.push(
      window.setTimeout(() => {
        setFlash(null);
        try {
          scannerRef.current?.resume();
        } catch {
          // not paused
        }
      }, ms),
    );
  }

  // The answer arrives: show it, tap only for an accepted scan, then carry on.
  useEffect(() => {
    if (!result || result.id <= baseline.current) return;
    baseline.current = result.id;
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    if (result.tone === "ok") confirmHaptic();
    setFlash({ tone: result.tone, code: result.code });
    resumeAfter(HOLD_MS);
  }, [result]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const [error, setError] = useState("");
  const [last, setLast] = useState("");
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [count, setCount] = useState(0);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    let stopped = false;
    let scanner: Html5Qrcode | null = null;
    let seen: { code: string; at: number } | null = null;

    function accept(code: string) {
      const now = Date.now();
      if (seen && seen.code === code && now - seen.at < SAME_CODE_MS) {
        // Still in frame: keep it quiet until the label has been away a while.
        seen.at = now;
        return;
      }
      seen = { code, at: now };
      setLast(code);
      setCount((n) => n + 1);
      // Hold the frame so one pass of the label is one scan, and say so.
      try {
        scanner?.pause(true);
      } catch {
        // already paused
      }
      setFlash("reading");
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
      resumeAfter(GIVE_UP_MS);
      onDetectRef.current(code);
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError("The camera needs a secure (https) connection. Open AMC at its https address.");
        return;
      }
      // html5-qrcode measures its element when it starts; give the overlay a
      // few frames to lay out first, as v1 does.
      for (let i = 0; i < 20; i++) {
        const el = document.getElementById(REGION_ID);
        if (el && el.clientWidth > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (stopped) return;
      }
      const config = {
        fps: 20,
        qrbox: (width: number, height: number) => ({
          width: Math.max(Math.floor(width * 0.85), 250),
          height: Math.max(Math.floor(height * 0.4), 100),
        }),
        aspectRatio: 1.777,
        disableFlip: false,
      };
      try {
        scanner = new Html5Qrcode(REGION_ID, { formatsToSupport: FORMATS, verbose: false, useBarCodeDetectorIfSupported: true });
        scannerRef.current = scanner;
        try {
          await scanner.start({ facingMode: "environment" }, config, accept, undefined);
        } catch {
          // No rear camera (a laptop): the front one.
          await scanner.start({ facingMode: "user" }, config, accept, undefined);
        }
        if (stopped) await scanner.stop().catch(() => {});
        else setStarting(false);
      } catch (e) {
        setStarting(false);
        const message = e instanceof Error ? e.message : String(e);
        setError(
          /NotAllowed|Permission/i.test(message)
            ? "Camera permission was denied. Allow the camera for this site in the browser settings, then try again."
            : /NotFound|not found/i.test(message)
              ? "No camera was found on this device."
              : /NotReadable|Could not start/i.test(message)
                ? "The camera is in use by another app. Close it and try again."
                : "The camera could not be started.",
        );
      }
    }

    void start();
    return () => {
      stopped = true;
      const current = scanner;
      if (current) {
        void (async () => {
          try {
            await current.stop();
          } catch {
            // already stopped
          }
          try {
            current.clear();
          } catch {
            // already cleared
          }
        })();
      }
    };
  }, [attempt]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On the body, like v1: inside the page a transformed or clipped parent can
  // collapse a fixed overlay, and the camera then has nothing to measure.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera scanner"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div className="relative min-h-0 flex-1">
        <div id={REGION_ID} className="size-full [&_video]:size-full [&_video]:object-cover" />
        {error ? (
          <div role="alert" className="absolute inset-x-4 top-6 flex flex-col gap-2 rounded-well bg-[var(--warning)] px-3 py-2 text-body text-[var(--warning-on)]">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setStarting(true);
                setAttempt((n) => n + 1);
              }}
              className="min-h-10 self-start rounded-pill bg-white px-4 text-pill font-medium text-black"
            >
              Try again
            </button>
          </div>
        ) : flash ? (
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white ${
              flash === "reading"
                ? "bg-black/60"
                : flash.tone === "ok"
                  ? "bg-emerald-600/90"
                  : flash.tone === "warn"
                    ? "bg-amber-600/90"
                    : "bg-red-700/90"
            }`}
          >
            <span className="text-6xl leading-none">
              {flash === "reading" ? "…" : flash.tone === "ok" ? "✓" : flash.tone === "warn" ? "!" : "✕"}
            </span>
            <span className="text-2xl font-semibold">
              {flash === "reading"
                ? "Reading…"
                : flash.tone === "ok"
                  ? "Scanned"
                  : flash.tone === "warn"
                    ? "Check this one"
                    : "Not accepted"}
            </span>
            <span className="max-w-full truncate font-mono text-body">{flash === "reading" ? last : flash.code}</span>
          </div>
        ) : starting ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 text-body text-white">
            Starting camera… allow access if asked.
          </p>
        ) : null}
      </div>
      <div
        className="flex items-center gap-3 bg-black px-4 py-3 text-white"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <p role="status" className="min-w-0 flex-1 truncate text-body">
          {count > 0 ? `${count} scanned · ${last}` : "Point at a barcode — scans automatically."}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-pill bg-white px-5 text-pill font-medium text-black"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
