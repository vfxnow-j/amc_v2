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
 *
 * Given a `group`, it adds a part to that sales build instead: the quantity is
 * per machine, the price is typed (a sale is priced by what we quote, not by the
 * rental rate the search shows), and a part may be a custom line with no asset
 * behind it. Packages are not offered — a build is assembled part by part.
 * On a rental (`rental`) the parts are ordinary rental lines instead: the search
 * rate and basis, the rate basis for a custom part, priced over the term; only
 * the quantity (per machine) and the grouping differ.
 */

type TemplateHit = Awaited<ReturnType<typeof findTemplates>>[number];

const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };
export function AddLine({
  reservationId,
  start,
  end,
  packageId,
  optionName,
  group,
  rental = false,
}: {
  reservationId: string;
  start: string;
  end: string;
  /** Add parts to this sales build rather than lines to the order. */
  group?: { id: string; name: string };
  /** The build is on a rental: its parts price as rental lines, not as typed one-time prices. */
  rental?: boolean;
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
  const [price, setPrice] = useState("");
  const [custom, setCustom] = useState<{ name: string } | null>(null);
  // An ad-hoc line outside a build: how its rate is read. "ONCE" is a flat charge.
  const [basis, setBasis] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "ONCE">("DAILY");
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const latest = useRef(0);
  // A sale's build part is typed and one-time; a rental's keeps rental pricing.
  const saleBuild = !!group && !rental;

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || chosen || chosenPackage) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const [found, bundles] = await Promise.all([
        lookupAssets(needle, start, end),
        group ? Promise.resolve([]) : findTemplates(needle),
      ]);
      if (ticket === latest.current) {
        setHits(found);
        setPackages(bundles);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [query, chosen, chosenPackage, start, end, group]);

  function reset() {
    setChosen(null);
    setChosenPackage(null);
    setQuery("");
    setHits([]);
    setPackages([]);
    setQuantity("1");
    setPrice("");
    setCustom(null);
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
        rate: saleBuild ? Number(price) : chosen.rate,
        pricingType: saleBuild ? "PROJECT" : (chosen.pricingType as PricingType),
        quantity: Number(quantity),
        ...(saleBuild ? { isOneTime: true } : {}),
        ...(group ? { groupId: group.id } : {}),
      }, packageId);
      setOutcome(result);
      if (result.status === "ok") {
        reset();
        router.refresh();
      }
    });
  }

  function addCustom() {
    if (!custom) return;
    startTransition(async () => {
      const once = saleBuild || basis === "ONCE";
      const result = await addOrderLine(reservationId, {
        description: custom.name,
        rate: Number(price),
        pricingType: once ? "PROJECT" : (basis as PricingType),
        quantity: Number(quantity),
        isOneTime: once,
        ...(group ? { groupId: group.id } : {}),
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
          {group ? "Add a part" : optionName ? `Add to ${optionName}` : "Add a line"}
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

      {custom ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="min-w-0 flex-1">
            <span className="mb-[6px] block text-micro uppercase text-ink-muted">
              {group ? `Part in ${group.name}` : "Custom item — not in inventory"}
            </span>
            <input
              autoFocus
              value={custom.name}
              aria-label="Item description"
              placeholder={group ? "What the part is" : "What it is — e.g. 8× RTX 6000 node (to be sourced)"}
              onChange={(event) => setCustom({ name: event.target.value })}
              className="h-9 w-full rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint"
            />
          </span>
          {saleBuild ? (
            <PartFields quantity={quantity} setQuantity={setQuantity} price={price} setPrice={setPrice} />
          ) : (
            <>
              <span>
                <span className="mb-[6px] block text-micro uppercase text-ink-muted">Qty</span>
                <input
                  value={quantity}
                  inputMode="numeric"
                  aria-label="Quantity"
                  onChange={(event) => setQuantity(event.target.value)}
                  className="h-9 w-16 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
                />
              </span>
              <span>
                <span className="mb-[6px] block text-micro uppercase text-ink-muted">Rate</span>
                <input
                  value={price}
                  inputMode="decimal"
                  aria-label="Rate"
                  onChange={(event) => setPrice(event.target.value)}
                  className="h-9 w-24 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
                />
              </span>
              <select
                value={basis}
                aria-label="Rate basis"
                onChange={(event) => setBasis(event.target.value as typeof basis)}
                className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
              >
                <option value="DAILY">/day</option>
                <option value="WEEKLY">/week</option>
                <option value="MONTHLY">/month</option>
                <option value="ONCE">once</option>
              </select>
            </>
          )}
          <button
            type="button"
            disabled={busy || !custom.name.trim() || !(Number(price) >= 0) || price === ""}
            onClick={addCustom}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => setCustom(null)}
            className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
          >
            Back
          </button>
        </div>
      ) : chosenPackage ? (
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
          {saleBuild ? (
            <PartFields quantity={quantity} setQuantity={setQuantity} price={price} setPrice={setPrice} />
          ) : (
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
          )}
          <button
            type="button"
            disabled={busy || (saleBuild && (price === "" || !(Number(price) >= 0)))}
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
            placeholder={group ? "Search assets to add as a part" : "Search assets and our packages"}
            aria-label={group ? "Search assets" : "Search assets and packages"}
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
                    onClick={() => {
                      setChosen(hit);
                      if (saleBuild) setPrice(hit.rate ? hit.rate.toFixed(2) : "");
                    }}
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
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => setCustom({ name: query.trim() })}
              className="text-detail text-accent-text hover:underline"
            >
              {group ? "Add a custom part instead" : "Add a custom item (not in inventory)"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-detail text-ink-faint hover:underline"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Quantity per machine and the price each, for a part of a sales build. */
function PartFields({
  quantity,
  setQuantity,
  price,
  setPrice,
}: {
  quantity: string;
  setQuantity: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
}) {
  return (
    <>
      <span>
        <span className="mb-[6px] block text-micro uppercase text-ink-muted">Per machine</span>
        <input
          value={quantity}
          inputMode="numeric"
          aria-label="Quantity per machine"
          onChange={(event) => setQuantity(event.target.value)}
          className="h-9 w-20 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
        />
      </span>
      <span>
        <span className="mb-[6px] block text-micro uppercase text-ink-muted">Price each</span>
        <input
          value={price}
          inputMode="decimal"
          aria-label="Price each"
          onChange={(event) => setPrice(event.target.value)}
          className="h-9 w-24 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none"
        />
      </span>
    </>
  );
}
