"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMarketPrice,
  type MarketPriceOutcome,
} from "@/lib/inventory/market-actions";

/**
 * Setting the market price by hand.
 *
 * Prices are maintained by hand (owner, 2026-08-12), so this is where they come
 * from. It opens closed: the card's job is to state what is recorded, and a
 * form permanently sitting under it would make an observation look like a
 * prompt.
 *
 * The source field is required and carries the weight here. `lib/market-price`
 * treats a price with a human source as one worth acting on and a scraped one
 * as not, so filling this in is what moves an asset into the rate
 * recommendations — which is why the panel says so rather than leaving somebody
 * to discover it.
 *
 * Imports only the action module, so nothing on this path reaches `lib/prisma`
 * from a client component.
 */
export function MarketPricePanel({
  assetId,
  currentPrice,
  currentSource,
  currentNotes,
  unconfirmed,
}: {
  assetId: string;
  currentPrice: number | null;
  currentSource: string | null;
  currentNotes: string | null;
  /** Nobody has vouched for what is stored — the scraper wrote it. */
  unconfirmed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<MarketPriceOutcome | null>(null);

  const [price, setPrice] = useState(
    currentPrice === null ? "" : String(currentPrice),
  );
  // The stored source is deliberately not carried into the field when it is a
  // scraped one: this form records who is vouching for the figure now, and
  // pre-filling "ebay.com (auto-updated)" would invite somebody to save it back
  // and mark a crawler's guess as checked.
  const [source, setSource] = useState(unconfirmed ? "" : (currentSource ?? ""));
  const [notes, setNotes] = useState(currentNotes ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setOutcome(null);
    startTransition(async () => {
      const result = await saveMarketPrice(assetId, {
        price: Number(price),
        source,
        notes,
      });
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
        >
          {currentPrice === null ? "Set a market price" : "Update the price"}
        </button>
        {outcome?.status === "ok" ? (
          <span role="status" className="text-detail text-ink-muted">
            {outcome.message}
          </span>
        ) : unconfirmed ? (
          <span className="text-detail text-ink-muted">
            Collected by the retired scraper and never checked, so the rate
            recommendations leave it out.
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 border-t border-hairline px-4 py-3"
    >
      {outcome?.status === "error" ? (
        <p
          role="alert"
          className="rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {outcome.message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">Resale price</span>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="rounded-well bg-sunken px-2 py-[6px] text-body tabular-nums text-ink outline-none focus:ring-1 focus:ring-accent-solid"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-muted">
            Where from
          </span>
          <input
            type="text"
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="B&H Photo, dealer quote, eBay sold listing…"
            className="rounded-well bg-sunken px-2 py-[6px] text-body text-ink outline-none focus:ring-1 focus:ring-accent-solid"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-micro uppercase text-ink-muted">
          Notes <span className="normal-case text-ink-faint">(optional)</span>
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Condition, quantity the price was for, anything that qualifies it"
          className="resize-none rounded-well bg-sunken px-2 py-[6px] text-body text-ink outline-none focus:ring-1 focus:ring-accent-solid"
        />
      </label>

      <p className="text-detail text-balance text-ink-muted">
        Naming a source is what marks this price as checked. Rate
        recommendations across Insights and the pricing report read confirmed
        prices only, so this asset joins them once it is saved.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save price"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setOutcome(null);
          }}
          className="text-detail text-ink-muted underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
