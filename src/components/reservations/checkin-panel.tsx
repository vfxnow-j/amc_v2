"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import {
  scanUnitIn,
  type CheckinCondition,
  type CheckinOutcome,
} from "@/lib/actions/desk";

const CONDITIONS: { value: CheckinCondition; label: string }[] = [
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "DAMAGED", label: "Damaged" },
];

type Entry = {
  id: number;
  tone: "ok" | "error";
  message: string;
  order?: { id: string; reservationNumber: string };
  workOrder?: { id: string; number: string };
};

/**
 * Check-in on the order record.
 *
 * The condition applies to the next scan rather than being asked afterwards,
 * because the person is holding the unit when they know the answer, and a
 * modal per unit would make returning twenty of them unbearable. It stays put
 * between scans — a pallet that came back wet came back wet.
 *
 * A unit that is out on a different order isn't an error, it's a wrong turn:
 * the log offers the order it actually belongs to.
 */
export function CheckinPanel({ reservationId }: { reservationId: string }) {
  const [barcode, setBarcode] = useState("");
  const [condition, setCondition] = useState<CheckinCondition>("GOOD");
  const [damageNotes, setDamageNotes] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  function handle(outcome: CheckinOutcome) {
    setLog((entries) =>
      [
        {
          id: nextId.current++,
          tone: outcome.status === "ok" ? ("ok" as const) : ("error" as const),
          message: outcome.message,
          order: outcome.status === "wrong-order" ? outcome.order : undefined,
          workOrder: outcome.status === "ok" ? outcome.workOrder : undefined,
        },
        ...entries,
      ].slice(0, 8),
    );
    inputRef.current?.focus();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const scanned = barcode.trim();
    if (!scanned || busy) return;
    setBarcode("");
    startTransition(async () => {
      handle(await scanUnitIn(reservationId, scanned, condition, damageNotes));
    });
  }

  const damaged = condition === "DAMAGED";

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Check in</h2>
        <span className="text-detail text-ink-muted">
          Scan a unit coming back
        </span>
      </header>

      <div className="px-4">
        <div
          role="radiogroup"
          aria-label="Condition on return"
          className="mb-2 inline-flex gap-px rounded-pill bg-segmented-track p-[3px]"
        >
          {CONDITIONS.map((option) => {
            const selected = option.value === condition;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setCondition(option.value)}
                className={`rounded-pill px-3 py-1 text-pill transition-colors duration-200 ${
                  selected
                    ? "bg-segmented-thumb text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit}>
          <label className="flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
            <PackageCheck
              className="size-4 flex-none text-ink-faint"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Scan or type a barcode"
              aria-label="Unit barcode"
              className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
            />
            {busy ? (
              <span className="flex-none text-detail text-ink-faint">
                Working…
              </span>
            ) : null}
          </label>

          {damaged ? (
            <textarea
              value={damageNotes}
              onChange={(event) => setDamageNotes(event.target.value)}
              rows={2}
              placeholder="What's wrong with it? This is recorded against the unit."
              aria-label="Damage notes"
              className="mt-2 w-full resize-none rounded-well bg-sunken px-[10px] py-2 text-detail text-ink outline-none placeholder:text-ink-faint"
            />
          ) : null}
        </form>

        {damaged ? (
          <p className="mt-2 text-detail text-ink-muted">
            Marked damaged on return. A work order is raised as it comes back,
            which takes the unit off the shelf until the bench clears it.
          </p>
        ) : null}
      </div>

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
              {entry.workOrder ? (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/service/work-orders/${entry.workOrder.id}`}
                    className="text-accent-text underline-offset-2 hover:underline"
                  >
                    Open {entry.workOrder.number} →
                  </Link>
                </>
              ) : null}
              {entry.order ? (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/reservations/${entry.order.id}`}
                    className="text-accent-text underline-offset-2 hover:underline"
                  >
                    Open {entry.order.reservationNumber} →
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-3 pb-4 text-detail text-ink-muted">
          Nothing checked in yet — set the condition, then scan a unit coming
          back.
        </p>
      )}
    </section>
  );
}
