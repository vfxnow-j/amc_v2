"use client";

import { useState, useTransition } from "react";
import { applyRateCard, type ApplyRatesOutcome } from "@/lib/revenue/actions";

/**
 * The bulk rate update, behind the list of what it would change.
 *
 * Two clicks, and the first one only reveals the sentence describing what the
 * second would do. A price change that takes one click is one nobody checked,
 * and `Asset` keeps no rate history to undo from.
 *
 * The count is sent back to the action, which recomputes the gap and refuses if
 * it has moved. That is the useful guard here: this screen can sit open for an
 * hour while somebody thinks about it, and the catalog does not hold still.
 */
export function ApplyRatesPanel({
  rateCardId,
  changes,
  assets,
}: {
  rateCardId: string;
  changes: number;
  assets: number;
}) {
  const [armed, setArmed] = useState(false);
  const [outcome, setOutcome] = useState<ApplyRatesOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  if (outcome?.status === "ok") {
    return (
      <p role="status" className="px-4 pb-4 text-detail text-ink-muted">
        {outcome.message}
      </p>
    );
  }

  return (
    <div className="border-t border-hairline px-4 py-3">
      {armed ? (
        <>
          <p className="pb-2 text-detail text-balance text-ink">
            This rewrites {changes} {changes === 1 ? "rate" : "rates"} across{" "}
            {assets} {assets === 1 ? "asset" : "assets"}, and there is no rate
            history to undo it from. Orders already priced keep the rate they
            were priced at — each line stores its own — so this changes what the
            next order costs, not what anybody has already agreed.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  setOutcome(await applyRateCard(rateCardId, changes));
                })
              }
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
            >
              {busy ? "Writing…" : `Rewrite ${changes}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setArmed(false)}
              className="text-detail text-ink-muted underline-offset-2 hover:underline"
            >
              Leave the catalog alone
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
        >
          Apply this card to the catalog
        </button>
      )}

      {/* Success has already returned above, so anything still here refused. */}
      {outcome ? (
        <p
          role="status"
          className="mt-2 rounded-well bg-accent-tint p-2 text-detail text-accent-on-tint"
        >
          {outcome.message}
        </p>
      ) : null}
    </div>
  );
}
