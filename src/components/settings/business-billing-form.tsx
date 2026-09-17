"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  MONTHLY_ANCHOR_LABEL,
  WEEKDAY_LABEL,
  type BillingAnchor,
} from "@/lib/billing/calendar";
import { saveBillingAnchor } from "@/lib/settings/business-actions";

const FIELD =
  "h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The two days every anchored order bills on. Super admins only reach this. */
export function BusinessBillingForm({ anchor }: { anchor: BillingAnchor }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [monthly, setMonthly] = useState(String(anchor.monthly));
  const [weekly, setWeekly] = useState(anchor.weekly);

  const changed = monthly !== String(anchor.monthly) || weekly !== anchor.weekly;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved("");
    startTransition(async () => {
      const result = await saveBillingAnchor({ monthly, weekly });
      if (result.status === "error") setError(result.message);
      else {
        setSaved(result.message);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="ok">{saved}</Notice> : null}

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Monthly orders bill on</span>
        <select
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
          className={FIELD}
        >
          {Object.entries(MONTHLY_ANCHOR_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
              {value === "1" ? " (in client agreements)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Weekly orders bill every</span>
        <select
          value={weekly}
          onChange={(event) => setWeekly(Number(event.target.value))}
          className={FIELD}
        >
          {WEEKDAY_LABEL.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {changed ? (
        <p className="rounded-well bg-sunken p-2 text-detail text-ink-muted">
          This moves the billing day of every running monthly or weekly order.
          Each keeps the invoice date it already has, and that invoice bills a
          prorated stretch up to the new day.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !changed}
        className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save billing days"}
      </button>
    </form>
  );
}
