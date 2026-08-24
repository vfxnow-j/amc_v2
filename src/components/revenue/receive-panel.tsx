"use client";

import { useState, useTransition } from "react";
import { receivePOLines, type ReceiveOutcome } from "@/lib/revenue/actions";
import type { ReceiveMode } from "@/lib/revenue/labels";

export type ReceiveLine = {
  id: string;
  description: string;
  remaining: number;
  mode: ReceiveMode;
};

/**
 * Booking hardware in against a purchase order.
 *
 * Receiving is the moment bought hardware becomes bookable stock, so it is a
 * physical event with a commercial consequence: a serialized line writes one
 * `AssetUnit` per item, at the PO's purchase method, in the location chosen
 * here. That is why the location is required and why quantities start at zero —
 * the receiver counts what is on the pallet, rather than confirming a number the
 * screen guessed for them.
 *
 * Serials are optional and positional: the first serial goes on the first unit.
 * A line with fewer serials than units still receives — a box arriving without
 * its paperwork is normal, and refusing it would leave the stock invisible.
 *
 * An inventoried line with no product type linked cannot make units. It is
 * offered with that said plainly rather than hidden: receiving it records the
 * quantity so the PO closes, but nothing lands in the fleet.
 */
export function ReceivePanel({
  purchaseOrderId,
  lines,
  locations,
  defaultLocationId,
}: {
  purchaseOrderId: string;
  lines: ReceiveLine[];
  locations: { id: string; name: string }[];
  defaultLocationId: string | null;
}) {
  const [locationId, setLocationId] = useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<ReceiveOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  const total = lines.reduce(
    (sum, line) => sum + (Number(quantities[line.id]) || 0),
    0,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setOutcome(null);
    startTransition(async () => {
      const result = await receivePOLines(
        purchaseOrderId,
        locationId,
        lines.map((line) => ({
          poItemId: line.id,
          quantity: Number(quantities[line.id]) || 0,
          serials: (serials[line.id] ?? "")
            .split(/[\n,]/)
            .map((serial) => serial.trim())
            .filter(Boolean),
        })),
      );
      setOutcome(result);
      if (result.status === "ok") {
        setQuantities({});
        setSerials({});
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm"
    >
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Receive</h2>
        <span className="text-detail text-ink-muted">
          Count what arrived, line by line
        </span>
      </header>

      <label className="mx-4 flex items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
        <span className="flex-none text-micro uppercase text-ink-muted">
          Landed at
        </span>
        <select
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          required
          className="w-full border-0 bg-transparent text-detail text-ink outline-none"
        >
          {locations.length === 0 ? <option value="">No locations</option> : null}
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {lines.map((line) => (
          <li key={line.id} className="rounded-bubble bg-row-alt p-2">
            <div className="grid grid-cols-[1fr_86px] items-baseline gap-2">
              <span className="truncate text-detail">{line.description}</span>
              <span className="flex items-center gap-1 justify-self-end">
                <input
                  type="number"
                  min={0}
                  max={line.remaining}
                  step={1}
                  value={quantities[line.id] ?? ""}
                  placeholder="0"
                  aria-label={`Quantity received of ${line.description}`}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: event.target.value,
                    }))
                  }
                  className="w-[46px] rounded-well bg-panel px-2 py-[3px] text-right text-detail tabular-nums text-ink outline-none focus:ring-1 focus:ring-accent-solid"
                />
                <span className="text-detail tabular-nums text-ink-faint">
                  /{line.remaining}
                </span>
              </span>
            </div>

            {line.mode === "unlinked" ? (
              <p className="pt-1 text-detail text-accent-text">
                No product type linked — the quantity is recorded, but no units
                are created. Link an asset to this line first if the serials
                matter.
              </p>
            ) : null}

            {(line.mode === "units" || line.mode === "serials") &&
            (Number(quantities[line.id]) || 0) > 0 ? (
              <textarea
                rows={2}
                value={serials[line.id] ?? ""}
                placeholder="Serial numbers, one per line — optional"
                aria-label={`Serial numbers for ${line.description}`}
                onChange={(event) =>
                  setSerials((current) => ({
                    ...current,
                    [line.id]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-well bg-panel px-2 py-1 text-detail text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent-solid"
              />
            ) : null}
          </li>
        ))}
      </ul>

      <footer className="flex items-center gap-3 px-4 py-3">
        <button
          type="submit"
          disabled={busy || total === 0 || !locationId}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Receiving…" : "Receive"}
        </button>
        <span className="text-detail text-ink-muted">
          {total === 0
            ? "Nothing counted yet"
            : `${total} ${total === 1 ? "item" : "items"} across ${
                lines.filter((line) => (Number(quantities[line.id]) || 0) > 0).length
              } lines`}
        </span>
      </footer>

      {outcome ? (
        <p
          role="status"
          className={`mx-4 mb-3 rounded-well p-2 text-detail ${
            outcome.status === "ok"
              ? "bg-sunken text-ink-muted"
              : "bg-accent-tint text-accent-on-tint"
          }`}
        >
          {outcome.message}
        </p>
      ) : null}
    </form>
  );
}
