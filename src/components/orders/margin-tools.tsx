"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { setAllMargins, setInternalCosts, type StageOutcome } from "@/lib/actions/order-stage";

const INPUT =
  "w-[80px] rounded-row border border-hairline bg-transparent px-1 text-right tabular-nums text-ink outline-none focus:bg-sunken disabled:opacity-50";
const BUTTON =
  "rounded-row border border-hairline px-2 text-ink hover:bg-row-hover disabled:opacity-50";

/**
 * The order-wide cost and margin controls of a sale: one margin across every
 * line, and the costs that sit on no line (shipping, sub-rental, hardware).
 * The margin changes prices, so it is offered only while the quote can change.
 */
export function MarginTools({
  reservationId,
  canPrice,
  shipping,
  subRental,
  hardware,
}: {
  reservationId: string;
  canPrice: boolean;
  shipping: number;
  subRental: number;
  hardware: number;
}) {
  const router = useRouter();
  const [margin, setMargin] = useState("");
  const [costs, setCosts] = useState({
    ship: shipping.toFixed(2),
    sub: subRental.toFixed(2),
    hw: hardware.toFixed(2),
  });
  const [message, setMessage] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function done(result: StageOutcome) {
    setMessage(result);
    if (result.status !== "error") router.refresh();
  }

  const dirty =
    Number(costs.ship) !== shipping || Number(costs.sub) !== subRental || Number(costs.hw) !== hardware;

  return (
    <div className="flex w-full flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-2 text-detail text-ink-muted">
      {canPrice ? (
        <span className="flex items-baseline gap-1">
          Set every line&rsquo;s margin to
          <input
            value={margin}
            inputMode="decimal"
            disabled={busy}
            aria-label="Margin percent for every line"
            onChange={(event) => setMargin(event.target.value)}
            className={`${INPUT} w-[56px]`}
          />
          %
          <button
            type="button"
            disabled={busy || margin.trim() === ""}
            onClick={() => startTransition(async () => done(await setAllMargins(reservationId, Number(margin))))}
            className={BUTTON}
          >
            Apply
          </button>
        </span>
      ) : null}
      {(
        [
          ["ship", "Shipping cost"],
          ["sub", "Sub-rental cost"],
          ["hw", "Hardware cost"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-baseline gap-1">
          {label}
          <input
            value={costs[key]}
            inputMode="decimal"
            disabled={busy}
            aria-label={label}
            onChange={(event) => setCosts({ ...costs, [key]: event.target.value })}
            className={INPUT}
          />
        </label>
      ))}
      {dirty ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            startTransition(async () =>
              done(
                await setInternalCosts(reservationId, {
                  internalShippingCost: Number(costs.ship),
                  subRentalCost: Number(costs.sub),
                  hardwareCost: Number(costs.hw),
                }),
              ),
            )
          }
          className={BUTTON}
        >
          Save costs
        </button>
      ) : null}
      {message ? (
        <Notice tone={message.status === "error" ? "error" : "ok"} className="w-full">
          {message.message}
        </Notice>
      ) : null}
    </div>
  );
}
