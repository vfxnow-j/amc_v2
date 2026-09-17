"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Modal, ModalCancel } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  addBuildComponent,
  editBuildOption,
  lookupConfigurableCandidates,
  lookupParts,
  removeBuildComponent,
  updateBuildComponent,
  type BuildOutcome,
  type BuildRow,
} from "@/lib/actions/asset-build";
import type { ConfigSlot } from "@/generated/prisma/client";

const SLOTS: { value: ConfigSlot; label: string; hint: string }[] = [
  { value: "GPU", label: "GPU", hint: "Graphics cards — usually assets, scanned out with the machine" },
  { value: "MEMORY", label: "Memory", hint: "RAM configurations — one per machine, priced per option" },
  { value: "STORAGE", label: "Storage", hint: "Drives — a base drive, plus any extra drives on top" },
  { value: "ADDON", label: "Add-ons", hint: "Capture cards, network cards, anything extra" },
  { value: "OTHER", label: "Other", hint: "" },
];

const FIELD =
  "h-8 rounded-well border border-hairline bg-sunken px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

/** Header action: pick the item to make configurable, then build it out. */
export function MakeConfigurable() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof lookupConfigurableCandidates>>>([]);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = query.trim().length >= 2 ? await lookupConfigurableCandidates(query) : [];
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-pill bg-accent-solid px-[14px] py-2 text-pill text-accent-on-solid"
      >
        <Plus className="size-[13px]" aria-hidden /> Make an item configurable
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Make an item configurable"
        blurb="Choose the machine. You'll add its base parts and options next."
        footer={<ModalCancel />}
      >
        <input
          id="configurable-search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search assets, e.g. Threadripper"
          className={`${FIELD} h-9 w-full`}
        />
        <ul className="mt-2 flex flex-col gap-px">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => router.push(`/dashboard/settings/configurable-items/${hit.id}`)}
                className="flex w-full items-baseline gap-2 rounded-row px-2 py-[6px] text-left text-detail hover:bg-row-hover"
              >
                <span className="min-w-0 flex-1 truncate font-bold">{hit.name}</span>
                <span className="text-ink-faint">{hit.categoryName ?? ""}</span>
                {hit.configurable ? <span className="text-accent-text">configured</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

/**
 * The options one item can be configured with, grouped by slot.
 *
 * "Base" parts go out with every order of the item and are included in its
 * rate — listed on the quote as spec. Every other option is an upgrade, priced
 * on top: a rental price per the order's period (per month, usually) and a sale
 * price for machines sold outright. An asset option (a GPU) is scanned out with
 * the machine; a spec option (128GB DDR5) is just a name and a price.
 */
export function ConfigurableItemEditor({
  assetId,
  assetName,
  options,
}: {
  assetId: string;
  assetName: string;
  options: BuildRow[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<BuildOutcome>) {
    startTransition(async () => {
      const result = await action();
      setOutcome(result);
      if (result.status === "ok") router.refresh();
    });
  }

  return (
    <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[1.7fr_1fr]">
      <div className="flex flex-col gap-3">
        {SLOTS.filter((slot) => slot.value !== "OTHER" || options.some((option) => option.slot === "OTHER")).map(
          (slot) => {
            const rows = options.filter((option) => option.slot === slot.value);
            return (
              <section key={slot.value} className="flex flex-col rounded-card bg-panel pt-[14px] shadow-sm">
                <header className="flex items-baseline gap-2 px-4 pb-2">
                  <h2 className="text-card-title">{slot.label}</h2>
                  <span className="text-detail text-ink-muted">{slot.hint}</span>
                </header>
                {rows.length > 0 ? (
                  <div className="overflow-x-auto px-2">
                    <table className="w-full min-w-[620px] border-separate border-spacing-y-px text-detail">
                      <thead>
                        <tr className="text-micro uppercase text-ink-muted">
                          <th className="px-2 text-left font-normal">Option</th>
                          <th className="w-[64px] px-1 text-left font-normal">Base</th>
                          <th className="w-[56px] px-1 text-left font-normal">Qty</th>
                          <th className="w-[110px] px-1 text-left font-normal">Rental price</th>
                          <th className="w-[110px] px-1 text-left font-normal">Sale price</th>
                          <th className="w-[56px]" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <OptionRow key={row.id} assetId={assetId} row={row} busy={busy} run={run} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-4 pb-2 text-detail text-ink-faint">No {slot.label.toLowerCase()} options.</p>
                )}
                <AddOption assetId={assetId} slot={slot.value} busy={busy} run={run} />
              </section>
            );
          },
        )}
      </div>

      <div className="flex flex-col gap-3">
        {outcome ? <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice> : null}
        <section className="rounded-card bg-panel p-4 text-detail text-ink-muted shadow-sm">
          <h2 className="mb-2 text-card-title text-ink">How it works on an order</h2>
          <p>
            Adding {assetName} to an order brings its <span className="text-ink">base</span> parts with it, included in
            its rate and listed as its spec. The line&rsquo;s <span className="text-ink">Configure</span> button offers
            everything here: one memory choice, and any drives, GPUs and add-ons — several at once, like a 1TB base drive
            plus a 4TB add-on — each upgrade priced on top.
          </p>
          <p className="mt-2">
            An option chosen from stock (&ldquo;An asset we stock&rdquo;, like a GPU) is a unit to scan: the order
            expects one scan per piece at check-out and check-in, and a scanned GPU attaches under its machine
            instead of opening a separate line. Spec options are never scanned.
          </p>
          <p className="mt-2">
            A blank price follows the part asset&rsquo;s own rate. For a spec option, blank means no charge.
          </p>
        </section>
      </div>
    </div>
  );
}

function money(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function OptionRow({
  assetId,
  row,
  busy,
  run,
}: {
  assetId: string;
  row: BuildRow;
  busy: boolean;
  run: (action: () => Promise<BuildOutcome>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(row.quantity));
  const [rental, setRental] = useState(row.rateOverride === null ? "" : String(row.rateOverride));
  const [sale, setSale] = useState(row.salePrice === null ? "" : String(row.salePrice));

  function savePrices() {
    const q = Number(quantity) || 1;
    const r = money(rental);
    const s = money(sale);
    if (q === row.quantity && r === row.rateOverride && s === row.salePrice) return;
    run(() => updateBuildComponent(row.id, { quantity: q, rateOverride: r, salePrice: s }));
  }

  return (
    <>
    <tr className="bg-row-alt">
      <td className="rounded-l-row px-2 py-[6px]">
        <span className="block truncate font-bold">{row.name}</span>
        <span className="block text-micro text-ink-faint">
          {row.componentAssetId ? `asset · ${row.fleet} in fleet · scanned` : "spec option"}
          {row.isDefault ? " · included in base rate" : " · upgrade"}
        </span>
      </td>
      <td className="px-1">
        <input
          type="checkbox"
          aria-label={`${row.name} is part of the base build`}
          checked={row.isDefault}
          disabled={busy}
          onChange={(event) =>
            run(() =>
              updateBuildComponent(row.id, {
                isDefault: event.target.checked,
                // Base parts are included in the machine's rate; upgrades add.
                priceMode: event.target.checked ? "INCLUDED" : "ADDS",
              }),
            )
          }
          className="size-4 accent-accent-solid"
        />
      </td>
      <td className="px-1">
        <input
          aria-label={`${row.name} quantity`}
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value.replace(/[^\d]/g, ""))}
          onBlur={savePrices}
          className={`${FIELD} w-full text-right tabular-nums`}
        />
      </td>
      <td className="px-1">
        <input
          aria-label={`${row.name} rental price`}
          inputMode="decimal"
          value={rental}
          placeholder={row.isDefault ? "included" : row.componentAssetId ? row.rate.toFixed(2) : "0.00"}
          onChange={(event) => setRental(event.target.value.replace(/[^\d.]/g, ""))}
          onBlur={savePrices}
          className={`${FIELD} w-full text-right tabular-nums`}
        />
      </td>
      <td className="px-1">
        <input
          aria-label={`${row.name} sale price`}
          inputMode="decimal"
          value={sale}
          placeholder={row.isDefault ? "included" : "—"}
          onChange={(event) => setSale(event.target.value.replace(/[^\d.]/g, ""))}
          onBlur={savePrices}
          className={`${FIELD} w-full text-right tabular-nums`}
        />
      </td>
      <td className="rounded-r-row px-1">
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            aria-label={`Edit ${row.name}`}
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
            className={`hover:text-ink disabled:opacity-50 ${editing ? "text-ink" : "text-ink-faint"}`}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Remove ${row.name}`}
            onClick={() => run(() => removeBuildComponent(row.id))}
            className="text-ink-faint hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </span>
      </td>
    </tr>
    {editing ? (
      <tr>
        <td colSpan={6} className="px-2 pb-2">
          <EditOption
            assetId={assetId}
            row={row}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(input) => {
              run(() => editBuildOption(row.id, input));
              setEditing(false);
            }}
          />
        </td>
      </tr>
    ) : null}
    </>
  );
}

/** Change what an option is — its name, the asset it stands for, or its group. */
function EditOption({
  assetId,
  row,
  busy,
  onCancel,
  onSave,
}: {
  assetId: string;
  row: BuildRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { slot: ConfigSlot; componentAssetId: string | null; label: string | null }) => void;
}) {
  const [slot, setSlot] = useState<ConfigSlot>(row.slot);
  const [kind, setKind] = useState<"spec" | "asset">(row.componentAssetId ? "asset" : "spec");
  const [label, setLabel] = useState(row.componentAssetId ? "" : row.name);
  const [part, setPart] = useState<{ id: string; name: string } | null>(
    row.componentAssetId ? { id: row.componentAssetId, name: row.name } : null,
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof lookupParts>>>([]);
  const latest = useRef(0);

  useEffect(() => {
    if (kind !== "asset" || part) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = query.trim().length >= 2 ? await lookupParts(query, assetId) : [];
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [query, kind, part, assetId]);

  const ready = kind === "spec" ? label.trim().length > 0 : part !== null;

  return (
    <div className="flex flex-col gap-2 rounded-well border border-hairline bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Option kind" className="inline-flex w-fit gap-px rounded-pill bg-segmented-track p-[3px]">
          {(
            [
              ["spec", "Spec with a price"],
              ["asset", "An asset we stock"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-pill px-3 py-1 text-pill ${kind === value ? "bg-segmented-thumb text-ink shadow-sm" : "text-ink-muted"}`}
            >
              {text}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-detail">
          <span className="text-micro uppercase text-ink-muted">Group</span>
          <select
            aria-label={`${row.name} group`}
            value={slot}
            onChange={(event) => setSlot(event.target.value as ConfigSlot)}
            className={FIELD}
          >
            {SLOTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind === "spec" ? (
        <input
          aria-label="Option name"
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. 128GB DDR5"
          className={`${FIELD} h-9`}
        />
      ) : part ? (
        <div className="flex items-center gap-2 text-detail">
          <span className="font-bold">{part.name}</span>
          <button type="button" onClick={() => setPart(null)} className="text-accent-text hover:underline">
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            aria-label="Search assets"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets, e.g. RTX 4090"
            className={`${FIELD} h-9`}
          />
          {hits.length > 0 ? (
            <ul className="flex flex-col gap-px rounded-well bg-sunken p-1">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => setPart({ id: hit.id, name: hit.name })}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[5px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="text-ink-faint">{hit.fleet} in fleet</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <p className="text-micro text-ink-faint">
        Orders already configured keep the parts they have; the change applies the next time a line is configured.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() =>
            onSave({
              slot,
              componentAssetId: kind === "asset" ? (part?.id ?? null) : null,
              label: kind === "spec" ? label : null,
            })
          }
          className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Save option
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddOption({
  assetId,
  slot,
  busy,
  run,
}: {
  assetId: string;
  slot: ConfigSlot;
  busy: boolean;
  run: (action: () => Promise<BuildOutcome>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"spec" | "asset">(slot === "GPU" || slot === "ADDON" ? "asset" : "spec");
  const [label, setLabel] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof lookupParts>>>([]);
  const [part, setPart] = useState<{ id: string; name: string } | null>(null);
  const [rental, setRental] = useState("");
  const [sale, setSale] = useState("");
  const [base, setBase] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (kind !== "asset" || part) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      const found = query.trim().length >= 2 ? await lookupParts(query, assetId) : [];
      if (ticket === latest.current) setHits(found);
    }, 160);
    return () => clearTimeout(timer);
  }, [query, kind, part, assetId]);

  function reset() {
    setOpen(false);
    setLabel("");
    setQuery("");
    setHits([]);
    setPart(null);
    setRental("");
    setSale("");
    setBase(false);
  }

  function add() {
    run(() =>
      addBuildComponent(assetId, {
        slot,
        componentAssetId: kind === "asset" ? part?.id : null,
        label: kind === "spec" ? label : null,
        isDefault: base,
        priceMode: base ? "INCLUDED" : "ADDS",
        tracked: kind === "asset" && (slot === "GPU" || slot === "ADDON"),
        rateOverride: money(rental),
        salePrice: money(sale),
      }),
    );
    reset();
  }

  if (!open) {
    return (
      <div className="px-4 pb-3 pt-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
        >
          <Plus className="size-[13px]" aria-hidden /> Add option
        </button>
      </div>
    );
  }

  const ready = kind === "spec" ? label.trim().length > 0 : part !== null;

  return (
    <div className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
      <div role="radiogroup" aria-label="Option kind" className="inline-flex w-fit gap-px rounded-pill bg-segmented-track p-[3px]">
        {(
          [
            ["spec", "Spec with a price"],
            ["asset", "An asset we stock"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-pill px-3 py-1 text-pill ${kind === value ? "bg-segmented-thumb text-ink shadow-sm" : "text-ink-muted"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {kind === "spec" ? (
        <input
          id={`option-label-${slot}`}
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={slot === "MEMORY" ? "e.g. 128GB DDR5" : slot === "STORAGE" ? "e.g. 4TB NVMe" : "Option name"}
          className={`${FIELD} h-9`}
        />
      ) : part ? (
        <div className="flex items-center gap-2 text-detail">
          <span className="font-bold">{part.name}</span>
          <button type="button" onClick={() => setPart(null)} className="text-accent-text hover:underline">
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={`option-asset-${slot}`}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets, e.g. RTX 4090"
            className={`${FIELD} h-9`}
          />
          {hits.length > 0 ? (
            <ul className="flex flex-col gap-px rounded-well bg-sunken p-1">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => setPart({ id: hit.id, name: hit.name })}
                    className="flex w-full items-baseline gap-2 rounded-row px-2 py-[5px] text-left text-detail hover:bg-row-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="text-ink-faint">{hit.fleet} in fleet</span>
                    <span className="tabular-nums text-ink-faint">{hit.rate.toFixed(2)}/mo</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-detail">
          <input
            type="checkbox"
            checked={base}
            onChange={(event) => setBase(event.target.checked)}
            className="size-4 accent-accent-solid"
          />
          Part of the base build
        </label>
        {!base ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase text-ink-muted">Rental price</span>
              <input
                inputMode="decimal"
                value={rental}
                onChange={(event) => setRental(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder={kind === "asset" ? "asset's rate" : "per month"}
                className={`${FIELD} w-28 text-right tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase text-ink-muted">Sale price</span>
              <input
                inputMode="decimal"
                value={sale}
                onChange={(event) => setSale(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="optional"
                className={`${FIELD} w-28 text-right tabular-nums`}
              />
            </label>
          </>
        ) : null}
        <button
          type="button"
          disabled={busy || !ready}
          onClick={add}
          className="h-8 rounded-pill bg-accent-solid px-3 text-pill text-accent-on-solid disabled:opacity-50"
        >
          Add option
        </button>
        <button type="button" onClick={reset} className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover">
          Cancel
        </button>
      </div>
    </div>
  );
}
