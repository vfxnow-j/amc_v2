"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import { lookupAssets } from "@/lib/actions/order-builder";
import { addOrderLine, type StageOutcome } from "@/lib/actions/order-stage";
import { findTemplates, loadTemplateIntoOrder } from "@/lib/actions/package-templates";
import type { AssetAvailability } from "@/lib/queries/order-builder";
import type { PricingType } from "@/generated/prisma/client";

/**
 * Adding a line to an order that already exists.
 *
 * The builder can do this while an order is being written; afterwards there was
 * no way at all, which is what made "Request revision" a dead end — the stage
 * moved and the only edit available was deleting a line.
 *
 * Availability is checked against this order's own window, the same lookup the
 * builder uses, so adding a machine that is already promised elsewhere says so
 * before it is added rather than after. It does not refuse — overbooking is a
 * real decision here, made knowingly — but it does not hide it either.
 *
 * The rate comes from what was shown next to the availability. Looking it up
 * again at save time is how a price somebody agreed to and a price that got
 * booked come apart.
 *
 * The same search finds our packages (Inventory → Packages). Picking one adds
 * all of its lines — each priced as it would be added by hand, unless the
 * package sets its own rate — to the quote option being viewed.
 */

type TemplateHit = Awaited<ReturnType<typeof findTemplates>>[number];

const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };
export function AddLine({
  reservationId,
  start,
  end,
  packageId,
  optionName,
}: {
  reservationId: string;
  start: string;
  end: string;
  /** The quote option lines are added to. Omitted, the active one. */
  packageId?: string;
  /** Named in the button when the order has more than one option. */
  optionName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AssetAvailability[]>([]);
  const [chosen, setChosen] = useState<AssetAvailability | null>(null);
  const [packages, setPackages] = useState<TemplateHit[]>([]);
  const [chosenPackage, setChosenPackage] = useState<TemplateHit | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || chosen || chosenPackage) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const [found, bundles] = await Promise.all([
        lookupAssets(needle, start, end),
        findTemplates(needle),
      ]);
      if (ticket === latest.current) {
        setHits(found);
        setPackages(bundles);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [query, chosen, chosenPackage, start, end]);

  function reset() {
    setChosen(null);
    setChosenPackage(null);
    setQuery("");
    setHits([]);
    setPackages([]);
    setQuantity("1");
    setOpen(false);
  }

  function addPackage() {
    if (!chosenPackage) return;
    startTransition(async () => {
      const result = await loadTemplateIntoOrder(reservationId, chosenPackage.id, packageId);
      setOutcome(result);
      if (result.status === "ok") {
        reset();
        router.refresh();
      }
    });
  }

  function add() {
    if (!chosen) return;
    startTransition(async () => {
      const result = await addOrderLine(reservationId, {
        assetId: chosen.assetId,
        rate: chosen.rate,
        pricingType: chosen.pricingType as PricingType,
        quantity: Number(quantity),
      }, packageId);
      setOutcome(result);
      if (result.status === "ok") {
        reset();
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <div className="px-4 pb-3">
        {outcome && outcome.status === "ok" ? (
          <Notice tone="ok" className="mb-2">
            {outcome.message}
          </Notice>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setOpen(true);
          }}
          className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          <Plus className="size-[13px]" aria-hidden />
          {optionName ? `Add to ${optionName}` : "Add a line"}
        </button>
      </div>
    );
  }

  const short = chosen ? chosen.free < Number(quantity || 1) : false;

  return (
    <div className="border-t border-hairline px-4 py-3">
      {outcome && outcome.status === "error" ? (
        <Notice tone="error" className="mb-2">
          {outcome.message}
        </Notice>
      ) : null}

      {chosenPackage ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-micro uppercase text-ink-muted">Package</span>
            <span className="block truncate text-body font-bold">{chosenPackage.name}</span>
            <span className="block text-micro text-ink-faint">
              {chosenPackage.lineCount} {chosenPackage.lineCount === 1 ? "line" : "lines"}
              {chosenPackage.summary ? ` · ${chosenPackage.summary}` : ""}
            </span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={addPackage}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Adding…" : `Add ${chosenPackage.lineCount} ${chosenPackage.lineCount === 1 ? "line" : "lines"}`}
          </button>
          <button
            type="button"
            onClick={() => setChosenPackage(null)}
            className="h-9 rounded-pill bg-sunken px-4 text-pill text-ink hover:bg-row-hover"
          >
            Back
          </button>
        </div>
      ) : chosen ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-micro uppercase text-ink-muted">Asset</span>
            <span className="block truncate text-body font-bold">{chosen.name}</span>
            <span className="block text-micro text-ink-faint">
              {chosen.free} free of {chosen.fleet} for this window ·{" "}
              {chosen.rate.toFixed(2)}/{chosen.pricingType.toLowerCase()}
            </span>
          </span>
          <span>
            <span className="mb-[6px] block text-micro uppercase text-ink-muted">
              Qty
            </span>
            <input
              value={quantity}
              inputMode="numeric"
              aria-label="Quantity"
              onChange={(event) => setQuantity(event.target.value)}
              className="h-9 w-16 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
            />
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={add}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
          >
            Change
          </button>
          {short ? (
            <p className="w-full text-detail text-ink-muted">
              Only {chosen.free} free for these dates
              {chosen.freeFrom
                ? `, and the rest come back ${new Date(chosen.freeFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
              . Adding {quantity} books it over — deliberate is fine, accidental
              is not.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets and our packages"
            aria-label="Search assets and packages"
            className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
          />
          {packages.length > 0 || hits.length > 0 ? (
            <ul className="mt-1 flex max-h-72 flex-col gap-px overflow-y-auto rounded-well bg-sunken p-1">
              {packages.length > 0 ? (
                <li className="px-2 pt-1 text-micro uppercase text-ink-muted">Our packages</li>
              ) : null}
              {packages.map((bundle) => (
                <li key={`package-${bundle.id}`}>
                  <button
                    type="button"
                    onClick={() => setChosenPackage(bundle)}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <Package className="size-[13px] flex-none self-center text-accent-text" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-bold">{bundle.name}</span>
                      <span className="text-ink-faint"> · {bundle.lineCount} {bundle.lineCount === 1 ? "line" : "lines"}</span>
                    </span>
                    <span className="flex-none tabular-nums text-ink-faint">
                      {bundle.totals.byPeriod
                        .map((t) => `${t.amount.toFixed(2)}/${PERIOD[t.pricingType] ?? t.pricingType.toLowerCase()}`)
                        .join(" + ") || (bundle.totals.once ? `${bundle.totals.once.toFixed(2)} once` : "")}
                    </span>
                  </button>
                </li>
              ))}
              {packages.length > 0 && hits.length > 0 ? (
                <li className="px-2 pt-2 text-micro uppercase text-ink-muted">Assets</li>
              ) : null}
              {hits.map((hit) => (
                <li key={hit.assetId}>
                  <button
                    type="button"
                    onClick={() => setChosen(hit)}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span
                      className={`flex-none ${hit.free > 0 ? "text-ink-muted" : "text-destructive"}`}
                    >
                      {hit.free} free
                    </span>
                    <span className="flex-none tabular-nums text-ink-faint">
                      {hit.rate.toFixed(2)}/{hit.pricingType.toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-2 text-detail text-ink-faint hover:underline"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
