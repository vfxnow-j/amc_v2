"use client";

import { useRef, useState, useTransition } from "react";
import { ScanLine } from "lucide-react";
import { scanUnitOut, type ScanOutcome } from "@/lib/actions/desk";
import { OverScanPrompt } from "@/components/scan/over-scan-prompt";
import type {
  OverScanConflict,
  OverScanResolution,
} from "@/lib/reservations/over-scan";

type Entry = { id: number; tone: "ok" | "error"; message: string };

/**
 * Check-out on the order record. The scan well stays focused, because the
 * barcode gun types and presses Enter.
 *
 * When a scan goes past what the line says was ordered, the action writes
 * nothing and hands back the conflict; this renders it as a question with
 * priced ways out. Nothing about the order changes until one is chosen — that
 * is the whole point, and why the input locks while the question is open.
 */
export function CheckoutPanel({ reservationId }: { reservationId: string }) {
  const [barcode, setBarcode] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [conflict, setConflict] = useState<OverScanConflict | null>(null);
  const [pendingBarcode, setPendingBarcode] = useState("");
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  function record(tone: Entry["tone"], message: string) {
    setLog((entries) =>
      [{ id: nextId.current++, tone, message }, ...entries].slice(0, 8),
    );
  }

  function handle(outcome: ScanOutcome, scanned: string) {
    if (outcome.status === "conflict") {
      setPendingBarcode(scanned);
      setConflict(outcome.conflict);
      return;
    }
    if (outcome.status === "not-on-order") {
      // The record never opts out of the ad-hoc line, so this cannot reach
      // here — the union is shared with the scan surface, which does.
      record("error", `${outcome.assetName} is not on this order.`);
      inputRef.current?.focus();
      return;
    }
    record(outcome.status === "ok" ? "ok" : "error", outcome.message);
    inputRef.current?.focus();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const scanned = barcode.trim();
    if (!scanned || busy) return;
    setBarcode("");
    startTransition(async () => {
      handle(await scanUnitOut(reservationId, scanned), scanned);
    });
  }

  function resolve(resolution: OverScanResolution) {
    const scanned = pendingBarcode;
    setConflict(null);
    startTransition(async () => {
      handle(await scanUnitOut(reservationId, scanned, resolution), scanned);
    });
  }


  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Check out</h2>
        <span className="text-detail text-ink-muted">
          Scan a unit to send it out on this order
        </span>
      </header>

      <form onSubmit={submit} className="px-4">
        <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
          <ScanLine className="size-4 flex-none text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            // The gun types straight into whatever has focus.
            autoFocus
            disabled={!!conflict}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              conflict ? "Answer the question below first" : "Scan or type a barcode"
            }
            aria-label="Unit barcode"
            className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint disabled:opacity-60"
          />
          {busy ? (
            <span className="flex-none text-detail text-ink-faint">Working…</span>
          ) : null}
        </label>
      </form>

      {conflict ? (
        <OverScanPrompt
          conflict={conflict}
          busy={busy}
          onResolve={resolve}
          onDismiss={() => {
            setConflict(null);
            record("error", `${pendingBarcode} was not checked out.`);
            inputRef.current?.focus();
          }}
          className="mx-4 mt-3"
        />
      ) : null}

      {log.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-px px-2 pb-3">
          {log.map((entry) => (
            <li
              key={entry.id}
              className={`rounded-row px-2 py-[5px] text-detail ${
                entry.tone === "ok" ? "text-ink-muted" : "text-destructive"
              }`}
            >
              {entry.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-3 pb-4 text-detail text-ink-muted">
          Nothing scanned yet — scan a unit barcode, or type one in by hand.
        </p>
      )}
    </section>
  );
}
