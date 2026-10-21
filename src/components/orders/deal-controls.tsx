"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { associateOrder, leaveDeal, setDealTemperature, type DealOutcome } from "@/lib/actions/deal-groups";

const INPUT = "h-8 w-44 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";
const BUTTON = "rounded-pill bg-sunken px-3 py-[3px] text-pill text-ink hover:bg-row-hover disabled:opacity-50";

/** Link this order with another by number, leave the deal, set its temperature. */
export function DealControls({
  orderId,
  inDeal,
  temperature,
}: {
  orderId: string;
  inDeal: boolean;
  temperature: "HOT" | "WARM" | "COLD" | null;
}) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<DealOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<DealOutcome>, onOk?: () => void) {
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={number}
        aria-label="Order number to link with"
        placeholder="Link with order no., e.g. SALE-2026-00036"
        onChange={(event) => setNumber(event.target.value)}
        className={`${INPUT} w-72`}
      />
      <button
        type="button"
        disabled={busy || !number.trim()}
        onClick={() => run(() => associateOrder(orderId, number), () => setNumber(""))}
        className={BUTTON}
      >
        Link
      </button>
      {inDeal ? (
        <>
          <select
            aria-label="How likely this deal is"
            disabled={busy}
            value={temperature ?? ""}
            onChange={(event) =>
              run(() => setDealTemperature(orderId, (event.target.value || null) as "HOT" | "WARM" | "COLD" | null))
            }
            className="rounded-pill border border-hairline bg-panel px-2 py-[2px] text-pill text-ink"
          >
            <option value="">Likelihood: by stage</option>
            <option value="HOT">Hot</option>
            <option value="WARM">Warm</option>
            <option value="COLD">Cold</option>
          </select>
          <button type="button" disabled={busy} onClick={() => run(() => leaveDeal(orderId))} className={BUTTON}>
            Leave this deal
          </button>
        </>
      ) : null}
      {result ? (
        <span role="status" className={`text-detail ${result.ok ? "text-ink-muted" : "text-destructive"}`}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
