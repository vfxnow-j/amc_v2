"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { setLineCost, setLineMargin, type StageOutcome } from "@/lib/actions/order-stage";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const CELL =
  "w-[72px] rounded-row border-0 bg-transparent px-1 py-0 text-right tabular-nums text-ink outline-none hover:bg-row-hover focus:bg-sunken disabled:opacity-50";

/** Gross margin on the price, as the server computes it: (rate − cost) / rate. */
function marginOf(rate: number, cost: number | null): number | null {
  if (cost == null || cost <= 0 || rate <= 0) return null;
  return Math.round(((rate - cost) / rate) * 10000) / 100;
}

/**
 * A sale line's cost and margin, edited in place.
 *
 * Cost is what one unit cost us: changing it keeps the price and moves the
 * margin. Margin prices the line off its cost (price = cost ÷ (1 − margin)), so
 * it changes the quote and is offered only while the quote can change
 * (`canPrice`). The margin shown is derived from the rate and the cost, so a
 * rate typed in the line above is reflected rather than a stale stored figure.
 */
export function CostMarginEditor({
  reservationId,
  itemId,
  rate,
  quantity,
  cost,
  canPrice,
}: {
  reservationId: string;
  itemId: string;
  rate: number;
  quantity: number;
  cost: number | null;
  canPrice: boolean;
}) {
  const router = useRouter();
  const margin = marginOf(rate, cost);
  const [costText, setCostText] = useState(cost == null ? "" : cost.toFixed(2));
  const [marginText, setMarginText] = useState(margin == null ? "" : String(margin));
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  // Follow the server after a refresh without a sync effect: compare to the
  // props the inputs were last seeded from.
  const [seed, setSeed] = useState({ cost, margin });
  if (seed.cost !== cost || seed.margin !== margin) {
    setSeed({ cost, margin });
    setCostText(cost == null ? "" : cost.toFixed(2));
    setMarginText(margin == null ? "" : String(margin));
  }

  function revert() {
    setCostText(cost == null ? "" : cost.toFixed(2));
    setMarginText(margin == null ? "" : String(margin));
  }

  function handle(result: StageOutcome) {
    if (result.status === "error") {
      setError(result.message);
      revert();
    } else {
      setError("");
      router.refresh();
    }
  }

  function commitCost() {
    if (costText.trim() === "") return revert();
    const next = Number(costText);
    if (next === cost) return;
    startTransition(async () => handle(await setLineCost(reservationId, itemId, next)));
  }

  function commitMargin() {
    if (marginText.trim() === "") return revert();
    const next = Number(marginText);
    if (next === margin) return;
    if (cost == null || cost <= 0) {
      setError("Enter a cost first — the margin prices the line off it.");
      return revert();
    }
    startTransition(async () => handle(await setLineMargin(reservationId, itemId, next)));
  }

  const keys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      revert();
      event.currentTarget.blur();
    }
  };

  const profit = cost != null ? (rate - cost) * quantity : null;

  return (
    <div className="mt-1 flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 px-1 text-detail text-ink-faint">
      <label className="flex items-baseline gap-1">
        Cost each
        <input
          value={costText}
          inputMode="decimal"
          disabled={busy}
          aria-label="Cost per unit"
          onChange={(event) => setCostText(event.target.value)}
          onBlur={commitCost}
          onKeyDown={keys}
          className={CELL}
        />
      </label>
      {canPrice ? (
        <label className="flex items-baseline gap-1">
          Margin
          <input
            value={marginText}
            inputMode="decimal"
            disabled={busy}
            aria-label="Margin percent"
            onChange={(event) => setMarginText(event.target.value)}
            onBlur={commitMargin}
            onKeyDown={keys}
            className={`${CELL} w-[56px]`}
          />
          %
        </label>
      ) : (
        <span>Margin {margin == null ? "—" : `${margin}%`}</span>
      )}
      <span className="tabular-nums">Profit {profit == null ? "—" : MONEY.format(profit)}</span>
      {error ? (
        <Notice tone="error" className="w-full">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
