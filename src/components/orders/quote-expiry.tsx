"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setQuoteExpiry } from "@/lib/actions/quote-tokens";
import {
  EXPIRY_CHOICES,
  EXPIRY_CHOICE_LABEL,
  expiryFromChoice,
  type ExpiryChoice,
} from "@/lib/quotes/expiry";

const FIELD =
  "h-8 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Pick when a quote's pricing stops holding: a date and the quick picks.
 *
 * Saves as it is changed, because the date is one fact with no reason to be
 * held back: the order, the PDF, the email and the live links all move together
 * (`setQuoteExpiry`). Used in the Send quote dialog and on the order record.
 */
export function ExpiryPicker({
  id,
  value,
  onSaved,
}: {
  id: string;
  /** `YYYY-MM-DD`. */
  value: string;
  onSaved?: (date: string) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(value);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, startTransition] = useTransition();

  function save(next: string) {
    setDate(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setQuoteExpiry(id, next);
      if (result.status === "ok") {
        setError(false);
        setMessage("Saved. The link and the quote now end on this date.");
        onSaved?.(next);
        router.refresh();
      } else {
        setError(true);
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          disabled={busy}
          aria-label="Quote expires on"
          onChange={(event) => event.target.value && save(event.target.value)}
          className={FIELD}
        />
        {EXPIRY_CHOICES.map((choice: ExpiryChoice) => (
          <button
            key={choice}
            type="button"
            disabled={busy}
            onClick={() => save(iso(expiryFromChoice(choice)))}
            className="h-8 rounded-pill bg-sunken px-3 text-micro text-ink hover:bg-row-hover disabled:opacity-50"
          >
            {EXPIRY_CHOICE_LABEL[choice]}
          </button>
        ))}
      </div>
      {message ? (
        <p role={error ? "alert" : "status"} className={`text-micro ${error ? "text-danger" : "text-ink-faint"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** "Pricing holds until …" with a Change control, for the order record. */
export function QuoteExpiryLine({
  id,
  expiresOn,
  label,
  expired,
}: {
  id: string;
  expiresOn: string;
  /** The formatted date, already in the app's style. */
  label: string;
  expired: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-detail text-ink-muted">
        {expired ? `Quoted pricing expired ${label}.` : `Quoted pricing holds until ${label}.`}{" "}
        <button type="button" onClick={() => setEditing((on) => !on)} className="underline">
          {editing ? "Close" : expired ? "Extend" : "Change"}
        </button>
      </p>
      {editing ? (
        <ExpiryPicker id={id} value={expiresOn} onSaved={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
