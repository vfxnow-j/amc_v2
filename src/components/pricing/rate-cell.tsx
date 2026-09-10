"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAssetRate } from "@/lib/actions/pricing";
import { usePricingFeedback } from "@/components/pricing/pricing-feedback";

/**
 * One price, edited where it is read.
 *
 * The same reasoning as the order record's line editor: changing a price is
 * mostly changing a number somebody is already looking at, and a modal to turn
 * 400 into 425 is worse than the number being typeable. Committed on blur or
 * Enter and never per keystroke — each save is a write and an audit row, so
 * firing one for the "4" in "425" would record a price nobody chose. Escape
 * puts the original back.
 *
 * An empty field means "no rate", which is a real state and not the same as
 * zero: `pickRate` skips a null tier and falls through to the next one, while a
 * zero is a price of nothing and quotes at nothing. Clearing writes null.
 *
 * A refusal shows under the row and the value reverts, so the screen never
 * shows a figure the database did not accept.
 */

const CELL =
  "w-full rounded-row bg-transparent px-1.5 py-0.5 text-right text-detail tabular-nums outline-none transition-colors duration-[160ms] hover:bg-row-hover focus:bg-sunken disabled:opacity-50";

function format(value: number | null): string {
  return value === null ? "" : String(value);
}

export function RateCell({
  assetId,
  tier,
  value,
  label,
}: {
  assetId: string;
  tier: string;
  value: number | null;
  /** Read out by screen readers — the column header alone isn't announced. */
  label: string;
}) {
  const router = useRouter();
  const { report } = usePricingFeedback();
  const [draft, setDraft] = useState(format(value));
  const [busy, startTransition] = useTransition();

  function revert() {
    setDraft(format(value));
  }

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);

    if (next !== null && !Number.isFinite(next)) {
      report({ status: "error", message: "That isn't a number." });
      revert();
      return;
    }
    if (next === value) return;

    startTransition(async () => {
      const outcome = await setAssetRate(assetId, tier, next);
      report(outcome);
      if (outcome.status === "error") {
        revert();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <input
      value={draft}
      inputMode="decimal"
      disabled={busy}
      aria-label={label}
      placeholder="—"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          revert();
          event.currentTarget.blur();
        }
      }}
      className={CELL}
    />
  );
}
