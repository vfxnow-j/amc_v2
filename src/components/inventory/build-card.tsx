"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Notice } from "@/components/feedback/notice";
import {
  addBuildComponent,
  lookupParts,
  removeBuildComponent,
  updateBuildComponent,
  type BuildOutcome,
  type BuildRow,
} from "@/lib/actions/asset-build";
import type { ComponentPriceMode } from "@/generated/prisma/client";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

type Part = Awaited<ReturnType<typeof lookupParts>>[number];

/**
 * What this SKU is built from.
 *
 * The build is the answer to "what is in one of these", recorded once instead
 * of reconstructed on every order. Adding the SKU to an order expands the
 * default parts onto it, already priced.
 *
 * Two switches per part, and they are different questions:
 *
 * - **Included / Adds** is about money. A base machine's memory and storage are
 *   Included — listed on the quote so the client sees the specification,
 *   charging nothing because the SKU's own price already covers them. A GPU
 *   upgrade Adds, at its own rate.
 * - **Default / Option** is about whether it lands on the order automatically.
 *   A default part comes with the SKU; an option is offered and picked.
 *
 * `Tracked` records that a part has its own units and is meant to be scanned —
 * graphics cards and network cards are, storage is not yet. It is stored from
 * the start so the catalogue is ready, and check-out does not act on it yet.
 */
export function BuildCard({
  assetId,
  assetName,
  rows,
}: {
  assetId: string;
  assetName: string;
  rows: BuildRow[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, startTransition] = useTransition();

  function run(work: () => Promise<BuildOutcome>) {
    startTransition(async () => {
      const result = await work();
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  const charged = rows
    .filter((row) => row.priceMode === "ADDS" && row.isDefault)
    .reduce((sum, row) => sum + row.rate * row.quantity, 0);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Build</h2>
        <span className="text-detail text-ink-muted">
          {rows.length === 0
            ? "nothing configured"
            : `${rows.length} ${rows.length === 1 ? "part" : "parts"}${
                charged > 0 ? ` · ${MONEY.format(charged)} on top by default` : ""
              }`}
        </span>
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setOutcome(null);
              setAdding(true);
            }}
            className="ml-auto flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
          >
            <Plus className="size-[13px]" aria-hidden />
            Add a part
          </button>
        ) : null}
      </header>

      {outcome ? (
        <div className="px-4 pb-3">
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>
            {outcome.message}
          </Notice>
        </div>
      ) : null}

      {adding ? (
        <PartPicker
          assetId={assetId}
          busy={busy}
          onCancel={() => setAdding(false)}
          onPick={(part, priceMode, tracked) => {
            run(async () => {
              const result = await addBuildComponent(assetId, {
                componentAssetId: part.id,
                priceMode,
                tracked,
              });
              if (result.status === "ok") setAdding(false);
              return result;
            });
          }}
        />
      ) : null}

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-body text-balance text-ink-muted">
          Nothing recorded for what goes into a {assetName}. Add the parts it
          normally ships with — memory and storage as Included so they show on
          the quote as specification, cards and upgrades as Adds so they carry
          their own price.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-px px-2 pb-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[1fr_46px_86px_82px_78px_20px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
            >
              <span className="min-w-0">
                <span className="block truncate">{row.name}</span>
                <span className="block truncate text-micro text-ink-faint">
                  {row.categoryName ?? "Uncategorised"}
                  {row.tracked
                    ? ` · tracked · ${row.fleet} in fleet`
                    : row.fleet > 0
                      ? ` · ${row.fleet} in fleet`
                      : ""}
                </span>
              </span>

              <input
                defaultValue={row.quantity}
                inputMode="numeric"
                aria-label={`Quantity of ${row.name}`}
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (next !== row.quantity) {
                    run(() => updateBuildComponent(row.id, { quantity: next }));
                  }
                }}
                className="w-full rounded-row border-0 bg-transparent px-1 text-right tabular-nums text-ink outline-none hover:bg-row-hover focus:bg-sunken"
              />

              <select
                defaultValue={row.priceMode}
                aria-label={`How ${row.name} is priced`}
                onChange={(event) =>
                  run(() =>
                    updateBuildComponent(row.id, {
                      priceMode: event.target.value as ComponentPriceMode,
                    }),
                  )
                }
                className="rounded-row border-0 bg-transparent text-detail text-ink outline-none hover:bg-row-hover"
              >
                <option value="INCLUDED">Included</option>
                <option value="ADDS">Adds</option>
              </select>

              <select
                defaultValue={row.isDefault ? "default" : "option"}
                aria-label={`Whether ${row.name} is on by default`}
                onChange={(event) =>
                  run(() =>
                    updateBuildComponent(row.id, {
                      isDefault: event.target.value === "default",
                    }),
                  )
                }
                className="rounded-row border-0 bg-transparent text-detail text-ink outline-none hover:bg-row-hover"
              >
                <option value="default">Default</option>
                <option value="option">Option</option>
              </select>

              <span className="text-right tabular-nums text-ink-muted">
                {row.priceMode === "INCLUDED" ? "—" : MONEY.format(row.rate)}
              </span>

              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${row.name} from the build`}
                onClick={() => run(() => removeBuildComponent(row.id))}
                className="flex size-5 items-center justify-center rounded-well text-ink-faint hover:bg-row-hover hover:text-destructive disabled:opacity-50"
              >
                <X className="size-[13px]" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PartPicker({
  assetId,
  busy,
  onPick,
  onCancel,
}: {
  assetId: string;
  busy: boolean;
  onPick: (part: Part, priceMode: ComponentPriceMode, tracked: boolean) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Part[]>([]);
  const [chosen, setChosen] = useState<Part | null>(null);
  const [priceMode, setPriceMode] = useState<ComponentPriceMode>("ADDS");
  const [tracked, setTracked] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2 || chosen) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = await lookupParts(needle, assetId);
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [query, chosen, assetId]);

  return (
    <div className="border-t border-hairline px-4 py-3">
      {chosen ? (
        <div className="flex flex-wrap items-end gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-micro uppercase text-ink-muted">Part</span>
            <span className="block truncate text-body font-bold">{chosen.name}</span>
            <span className="block text-micro text-ink-faint">
              {chosen.categoryName ?? "Uncategorised"} · {chosen.fleet} in fleet ·{" "}
              {MONEY.format(chosen.rate)} normally
            </span>
          </span>

          <span>
            <span className="mb-[6px] block text-micro uppercase text-ink-muted">
              Price
            </span>
            <select
              value={priceMode}
              onChange={(event) =>
                setPriceMode(event.target.value as ComponentPriceMode)
              }
              aria-label="How this part is priced"
              className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none"
            >
              <option value="INCLUDED">Included in base</option>
              <option value="ADDS">Adds its own rate</option>
            </select>
          </span>

          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={tracked}
              onChange={(event) => setTracked(event.target.checked)}
              className="size-4 accent-[var(--color-accent-solid)]"
            />
            <span className="text-detail text-ink">Tracked</span>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(chosen, priceMode, tracked)}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add part"}
          </button>
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="h-9 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
          >
            Change
          </button>
          <p className="w-full text-micro text-ink-faint">
            Tracked means the part has its own units and will be scanned —
            graphics and network cards are, storage is not yet. It is recorded
            now; check-out does not act on it yet.
          </p>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a part — a GPU, a drive, a capture card"
            aria-label="Search parts"
            className="h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint"
          />
          {hits.length > 0 ? (
            <ul className="mt-1 flex max-h-56 flex-col gap-px overflow-y-auto rounded-well bg-sunken p-1">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(hit)}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="flex-none text-ink-faint">
                      {hit.categoryName ?? "—"}
                    </span>
                    <span className="flex-none tabular-nums text-ink-muted">
                      {MONEY.format(hit.rate)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="mt-2 text-detail text-ink-faint hover:underline"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
