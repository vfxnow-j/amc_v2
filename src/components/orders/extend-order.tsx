"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import { extendOrder } from "@/lib/actions/extend-order";
import {
  addDays,
  businessToday,
  dayLabel,
  parseDateInput,
  toDateInput,
} from "@/lib/billing/calendar";
import {
  quoteExtension,
  type ExtensionLine,
  type ExtensionMode,
} from "@/lib/billing/extension";
import { formatPeriodCount } from "@/lib/pricing/periods";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * A fixed-term rental out with the client: when it is due back (or how late it
 * is), and the way to extend it.
 *
 * The dialog prices the extension as it is set up — the same function the
 * server invoices with (lib/billing/extension.ts) — so what is confirmed is
 * what is billed. It bills from the day after the old return date, late days
 * included, and each extension chooses prorated days or whole periods.
 */
export function ExtendOrder({
  reservationId,
  endDate,
  lines,
}: {
  reservationId: string;
  /** The current return date, as a stored day (ISO). */
  endDate: string;
  lines: ExtensionLine[];
}) {
  const router = useRouter();
  const oldEnd = new Date(endDate);
  const today = businessToday();
  const late = Math.max(0, Math.round((today.getTime() - oldEnd.getTime()) / 86_400_000));
  const overdue = oldEnd.getTime() < today.getTime();
  const left = Math.round((oldEnd.getTime() - today.getTime()) / 86_400_000);

  const [open, setOpen] = useState(false);
  const [newEnd, setNewEnd] = useState(
    toDateInput(addDays(oldEnd.getTime() > today.getTime() ? oldEnd : today, 7)),
  );
  const [mode, setMode] = useState<ExtensionMode>("prorate");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ message: string; href?: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const requested = parseDateInput(newEnd);
  const quote = requested ? quoteExtension(oldEnd, requested, mode, lines) : null;

  function confirm() {
    setError("");
    startTransition(async () => {
      const result = await extendOrder(reservationId, { newEnd, mode });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDone({ message: result.message, href: result.href });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">{overdue ? "Past its return date" : "Return date"}</h2>
        {overdue ? (
          <span className="text-detail font-bold text-destructive">
            {late} {late === 1 ? "day" : "days"} late
          </span>
        ) : (
          <span className="text-detail text-ink-muted">
            {left === 0 ? "due back today" : `back in ${left} ${left === 1 ? "day" : "days"}`}
          </span>
        )}
      </header>
      {done ? (
        <div className="px-4 pb-3">
          <Notice tone="ok">
            {done.message}
            {done.href ? (
              <Link href={done.href} className="ml-2 text-accent-text hover:underline">
                Open invoice →
              </Link>
            ) : null}
          </Notice>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4">
        <p className="min-w-0 flex-1 text-detail text-ink-muted">
          Due back {dayLabel(oldEnd)}. Extending moves the return date and invoices
          the extra time, from {dayLabel(addDays(oldEnd, 1))}.
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setOpen(true);
          }}
          className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid"
        >
          Extend
        </button>
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        wide
        title="Extend rental"
        blurb={
          overdue
            ? `Bills from ${dayLabel(addDays(oldEnd, 1))}, the day after it was due back, to the new return date — the ${late} late ${late === 1 ? "day is" : "days are"} included.`
            : `Bills from ${dayLabel(addDays(oldEnd, 1))}, the day after the current return date, to the new one.`
        }
        footer={
          <>
            {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
            <ModalCancel />
            <ModalConfirm onClick={confirm} disabled={busy || !quote || quote.lines.length === 0}>
              {busy ? "Extending…" : quote ? `Extend & invoice ${MONEY.format(quote.total)}` : "Extend"}
            </ModalConfirm>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-ink-muted">New return date</span>
            <input
              id="extend-new-end"
              type="date"
              value={newEnd}
              min={toDateInput(addDays(oldEnd, 1))}
              onChange={(event) => setNewEnd(event.target.value)}
              className="h-9 rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none"
            />
          </label>
          <div role="radiogroup" aria-label="How to bill the extension" className="inline-flex gap-px rounded-pill bg-segmented-track p-[3px]">
            {(
              [
                ["prorate", "Prorate the days"],
                ["whole", "Whole periods"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`rounded-pill px-3 py-1 text-pill transition-colors ${
                  mode === value ? "bg-segmented-thumb text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {quote ? (
          <>
            <p className="mt-3 text-detail text-ink-muted">
              {mode === "whole" && requested && quote.to.getTime() !== requested.getTime()
                ? `Rounded up to whole periods — the return date becomes ${dayLabel(quote.to)}. `
                : ""}
              {dayLabel(quote.from)} – {dayLabel(quote.to)}, {quote.days} {quote.days === 1 ? "day" : "days"}.
            </p>
            <ul className="mt-2 flex flex-col gap-px">
              {quote.lines.map((line) => (
                <li
                  key={line.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_96px] items-baseline gap-3 rounded-row px-2 py-[5px] text-detail odd:bg-row-alt"
                >
                  <span className="min-w-0 truncate">{line.label}</span>
                  <span className="tabular-nums text-ink-muted">
                    {line.quantity} × {MONEY.format(line.rate)}/{line.unit} × {formatPeriodCount(line.periods)}
                  </span>
                  <span className="text-right font-bold tabular-nums">{MONEY.format(line.amount)}</span>
                </li>
              ))}
              <li className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 px-2 pt-2 text-detail">
                <span className="text-right text-ink-muted">Extension, before tax</span>
                <span className="text-right font-bold tabular-nums">{MONEY.format(quote.total)}</span>
              </li>
            </ul>
            {lines.some((line) => line.isOneTime) ? (
              <p className="mt-2 text-micro text-ink-faint">One-time charges aren&rsquo;t billed again.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-detail text-destructive">
            Choose a return date after {dayLabel(oldEnd)}.
          </p>
        )}
      </Modal>
    </section>
  );
}
