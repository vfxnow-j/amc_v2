"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { lookupParts } from "@/lib/actions/asset-build";
import {
  receivePO,
  type ReceiveLineInput,
  type ReceiveOutcome,
  type ReceivePartInput,
  type ReceiveUnitInput,
} from "@/lib/procurement/po-receive";
import { RECEIVE_CONDITIONS } from "@/lib/procurement/po-labels";
import { parseBarcodeWithPrefix } from "@/lib/utils/barcode";

/**
 * Booking hardware in against a purchase order.
 *
 * The main way a model and its units enter the fleet. Each outstanding line is
 * counted, and what the count produces depends on the line:
 *
 * - a fleet line with a model makes one unit per item, each with its own
 *   barcode, serial, location and condition;
 * - a fleet line with no model gets one here — created new, with its category,
 *   maker and optionally the build it is sold as, or pointed at a model that
 *   already exists — and then makes its units;
 * - a resale line captures serials on the line and makes nothing;
 * - a consumable is counted and nothing more.
 *
 * Quantities start at zero, so the receiver counts what is on the pallet rather
 * than confirming a number the screen guessed. Bulk entry is for the pallet of
 * forty: a starting barcode numbers every unit on the screen in order, a pasted
 * column of serials fills the serial boxes in order, and a location or
 * condition can be set for a whole line at once. A blank barcode is generated
 * on receipt; a blank serial stays blank — a box without its paperwork still
 * belongs in the fleet.
 */

export type ReceiveLine = {
  id: string;
  description: string;
  remaining: number;
  mode: "units" | "serials" | "consumable" | "unlinked";
  assetName: string | null;
};

type Option = { id: string; name: string };

type NewModel = {
  kind: "new";
  name: string;
  categoryId: string;
  manufacturer: string;
  model: string;
  build: (ReceivePartInput & { name: string })[];
};

type LineState = {
  quantity: string;
  units: ReceiveUnitInput[];
  serials: string;
  model: NewModel | { kind: "existing"; assetId: string } | { kind: "count" };
};

function blankUnit(locationId: string): ReceiveUnitInput {
  return { barcode: "", serial: "", locationId, condition: "New" };
}

export function POReceive({
  purchaseOrderId,
  poNumber,
  lines,
  locations,
  categories,
  assets,
  defaultLocationId,
}: {
  purchaseOrderId: string;
  poNumber: string;
  lines: ReceiveLine[];
  locations: Option[];
  categories: Option[];
  assets: { id: string; name: string; detail: string }[];
  defaultLocationId: string;
}) {
  const router = useRouter();
  const [receivedOn, setReceivedOn] = useState(() => localDay());
  const [startBarcode, setStartBarcode] = useState("");
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        {
          quantity: "",
          units: [],
          serials: "",
          model: {
            kind: "new",
            name: line.description,
            categoryId: "",
            manufacturer: "",
            model: "",
            build: [],
          },
        },
      ]),
    ),
  );
  const [outcome, setOutcome] = useState<ReceiveOutcome | null>(null);
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const patch = (id: string, next: Partial<LineState>) =>
    setState((current) => ({ ...current, [id]: { ...current[id], ...next } }));

  /** Whether a line makes units, given its mode and the model choice. */
  const makesUnits = (line: ReceiveLine) =>
    line.mode === "units" ||
    (line.mode === "unlinked" && state[line.id].model.kind !== "count");

  function setQuantity(line: ReceiveLine, raw: string) {
    const count = Math.max(0, Math.min(line.remaining, Math.floor(Number(raw) || 0)));
    setState((current) => {
      // Growing keeps what was typed on the units already there; shrinking
      // drops the last ones. A receiver who mistypes 40 for 4 loses nothing
      // they wrote on the first four.
      const units = current[line.id].units.slice(0, count);
      while (units.length < count) {
        units.push(blankUnit(units.at(-1)?.locationId ?? defaultLocationId));
      }
      const next = {
        ...current,
        [line.id]: { ...current[line.id], quantity: raw === "" ? "" : String(count), units },
      };
      // A starting barcode keeps numbering the whole screen as counts change.
      return startBarcode.trim() ? renumber(next, startBarcode) : next;
    });
  }

  function setUnit(lineId: string, index: number, next: Partial<ReceiveUnitInput>) {
    setState((current) => {
      const units = current[lineId].units.map((unit, i) =>
        i === index ? { ...unit, ...next } : unit,
      );
      return { ...current, [lineId]: { ...current[lineId], units } };
    });
  }

  /** Every unit on the screen, in order, from one starting barcode. */
  function renumber(current: Record<string, LineState>, value: string) {
    const parsed = parseBarcodeWithPrefix(value.trim());
    if (!parsed) return current;
    let counter = 0;
    const next = { ...current };
    for (const line of lines) {
      const unlinkedCount =
        line.mode === "unlinked" && current[line.id].model.kind === "count";
      if (line.mode === "serials" || line.mode === "consumable" || unlinkedCount) continue;
      next[line.id] = {
        ...next[line.id],
        units: next[line.id].units.map((unit) => ({
          ...unit,
          barcode:
            parsed.prefix +
            String(parsed.number + counter++).padStart(parsed.padLength, "0"),
        })),
      };
    }
    return next;
  }

  function numberAll(value: string) {
    setStartBarcode(value);
    setState((current) => renumber(current, value));
  }

  const unitCount = lines.reduce(
    (sum, line) => sum + (makesUnits(line) ? state[line.id].units.length : 0),
    0,
  );
  const counted = lines.filter((line) => Number(state[line.id].quantity) > 0);
  const parsedStart = parseBarcodeWithPrefix(startBarcode.trim());

  function submit() {
    setOutcome(null);
    startTransition(async () => {
      const payload: ReceiveLineInput[] = lines.map((line) => {
        const current = state[line.id];
        const quantity = Number(current.quantity) || 0;
        const model = current.model;
        return {
          poItemId: line.id,
          quantity,
          units: makesUnits(line) ? current.units : [],
          serials: current.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          model:
            line.mode !== "unlinked"
              ? undefined
              : model.kind === "new"
                ? {
                    ...model,
                    build: model.build.map((part) => ({
                      componentAssetId: part.componentAssetId,
                      quantity: part.quantity,
                      priceMode: part.priceMode,
                      isDefault: part.isDefault,
                    })),
                  }
                : model,
        };
      });
      const result = await receivePO(purchaseOrderId, { receivedOn, lines: payload });
      setOutcome(result);
      if (result.status === "ok") {
        router.push(`/dashboard/purchase-orders/${purchaseOrderId}`);
        router.refresh();
      } else {
        formRef.current?.scrollIntoView({ block: "end" });
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
      className="flex flex-col gap-3"
    >
      <section className="grid gap-3 rounded-card bg-panel p-4 shadow-sm sm:grid-cols-3">
        <Field label="Arrived on" hint="Units date their receipt, and depreciation, from this.">
          <input
            type="date"
            value={receivedOn}
            max={localDay()}
            onChange={(event) => setReceivedOn(event.target.value)}
            required
            className={INPUT}
          />
        </Field>
        <Field
          label="Starting barcode"
          hint={
            unitCount === 0
              ? "Count a fleet line first, then number its units from here."
              : parsedStart
                ? `Numbers all ${unitCount} units: ${startBarcode.trim()} to ${parsedStart.prefix}${String(parsedStart.number + unitCount - 1).padStart(parsedStart.padLength, "0")}.`
                : "Optional. Blank barcodes are generated on receipt."
          }
        >
          <input
            value={startBarcode}
            onChange={(event) => numberAll(event.target.value)}
            onKeyDown={stopEnter}
            placeholder="006825 or VFX0001"
            disabled={unitCount === 0}
            className={`${INPUT} font-mono disabled:opacity-50`}
          />
        </Field>
        <p className="self-center text-detail text-balance text-ink-muted">
          Receiving against {poNumber}. Every unit is stamped with this PO, its
          vendor, and its lease if it has one — that is the trail the unit record
          reads back.
        </p>
      </section>

      {lines.map((line) => (
        <LineCard
          key={line.id}
          line={line}
          state={state[line.id]}
          locations={locations}
          categories={categories}
          assets={assets}
          makesUnits={makesUnits(line)}
          onQuantity={(raw) => setQuantity(line, raw)}
          onPatch={(next) => patch(line.id, next)}
          onUnit={(index, next) => setUnit(line.id, index, next)}
        />
      ))}

      <section className="sticky bottom-0 flex flex-col gap-2 rounded-card bg-panel px-4 py-3 shadow-sm">
        {outcome ? (
          <Notice tone={outcome.status === "ok" ? "ok" : "error"}>{outcome.message}</Notice>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || counted.length === 0}
            className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
          >
            {busy ? "Receiving…" : "Receive"}
          </button>
          <Link
            href={`/dashboard/purchase-orders/${purchaseOrderId}`}
            className="h-9 rounded-pill bg-sunken px-4 text-pill leading-9 text-ink hover:bg-row-hover"
          >
            Back to the PO
          </Link>
          <span className="text-detail text-ink-muted">
            {counted.length === 0
              ? "Nothing counted yet"
              : `${counted.length} ${counted.length === 1 ? "line" : "lines"} counted · ${unitCount} ${unitCount === 1 ? "unit" : "units"} to create`}
          </span>
        </div>
      </section>
    </form>
  );
}

function LineCard({
  line,
  state,
  locations,
  categories,
  assets,
  makesUnits,
  onQuantity,
  onPatch,
  onUnit,
}: {
  line: ReceiveLine;
  state: LineState;
  locations: Option[];
  categories: Option[];
  assets: { id: string; name: string; detail: string }[];
  makesUnits: boolean;
  onQuantity: (raw: string) => void;
  onPatch: (next: Partial<LineState>) => void;
  onUnit: (index: number, next: Partial<ReceiveUnitInput>) => void;
}) {
  const quantity = Number(state.quantity) || 0;
  const [paste, setPaste] = useState("");

  const note =
    line.mode === "units"
      ? `Fleet · ${line.assetName}`
      : line.mode === "unlinked"
        ? "Fleet · no model yet"
        : line.mode === "serials"
          ? "Resale — serials only, no units"
          : "Consumable — counted, nothing enters the fleet";

  return (
    <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-card-title">{line.description}</h2>
          <p className="text-detail text-ink-muted">{note}</p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-micro uppercase text-ink-muted">Arrived</span>
          <input
            type="number"
            min={0}
            max={line.remaining}
            step={1}
            value={state.quantity}
            placeholder="0"
            onChange={(event) => onQuantity(event.target.value)}
            onKeyDown={stopEnter}
            aria-label={`Quantity received of ${line.description}`}
            className="h-9 w-[64px] rounded-well bg-sunken px-2 text-right text-detail tabular-nums text-ink outline-none focus:ring-1 focus:ring-accent-solid"
          />
          <span className="text-detail tabular-nums text-ink-faint">of {line.remaining}</span>
        </label>
      </header>

      {line.mode === "unlinked" && quantity > 0 ? (
        <ModelChoice
          state={state}
          categories={categories}
          assets={assets}
          onPatch={onPatch}
        />
      ) : null}

      {line.mode === "serials" && quantity > 0 ? (
        <textarea
          rows={Math.min(6, quantity + 1)}
          value={state.serials}
          onChange={(event) => onPatch({ serials: event.target.value })}
          placeholder="Serial numbers, one per line — optional"
          aria-label={`Serial numbers for ${line.description}`}
          className={`${INPUT} h-auto resize-y py-2 font-mono`}
        />
      ) : null}

      {makesUnits && quantity > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2 rounded-well bg-sunken p-2">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-micro uppercase text-ink-muted">
                Paste serials, one per line
              </span>
              <textarea
                rows={1}
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                className="h-9 w-full resize-y rounded-well bg-panel px-2 py-2 font-mono text-detail text-ink outline-none"
              />
            </label>
            <button
              type="button"
              disabled={!paste.trim()}
              onClick={() => {
                const list = paste.split(/[\n,\t]/).map((s) => s.trim()).filter(Boolean);
                state.units.forEach((_, index) => {
                  if (list[index] !== undefined) onUnit(index, { serial: list[index] });
                });
                setPaste("");
              }}
              className="h-9 rounded-pill bg-panel px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
            >
              Fill serials
            </button>
            <label>
              <span className="mb-1 block text-micro uppercase text-ink-muted">All to</span>
              <select
                value=""
                onChange={(event) =>
                  event.target.value &&
                  state.units.forEach((_, index) => onUnit(index, { locationId: event.target.value }))
                }
                className="h-9 rounded-well bg-panel px-2 text-detail text-ink outline-none"
              >
                <option value="">Location…</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-micro uppercase text-ink-muted">All as</span>
              <select
                value=""
                onChange={(event) =>
                  event.target.value &&
                  state.units.forEach((_, index) => onUnit(index, { condition: event.target.value }))
                }
                className="h-9 rounded-well bg-panel px-2 text-detail text-ink outline-none"
              >
                <option value="">Condition…</option>
                {RECEIVE_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px] gap-2 px-1 text-colhead uppercase text-ink-muted">
            <span>#</span>
            <span>Barcode</span>
            <span>Serial</span>
            <span>Location</span>
            <span>Condition</span>
          </div>
          <ol className="flex flex-col gap-[2px]">
            {state.units.map((unit, index) => (
              <li
                key={index}
                className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px] items-center gap-2 rounded-row bg-row-alt p-1"
              >
                <span className="text-right text-detail tabular-nums text-ink-faint">{index + 1}</span>
                <input
                  value={unit.barcode}
                  onChange={(event) => onUnit(index, { barcode: event.target.value })}
                  onKeyDown={advance}
                  data-scan="barcode"
                  placeholder="Generated if blank"
                  aria-label={`${line.description} unit ${index + 1} barcode`}
                  className={`${ROW_INPUT} font-mono`}
                />
                <input
                  value={unit.serial}
                  onChange={(event) => onUnit(index, { serial: event.target.value })}
                  onKeyDown={advance}
                  data-scan="serial"
                  placeholder="Scan or type"
                  aria-label={`${line.description} unit ${index + 1} serial`}
                  className={`${ROW_INPUT} font-mono`}
                />
                <select
                  value={unit.locationId}
                  onChange={(event) => onUnit(index, { locationId: event.target.value })}
                  aria-label={`${line.description} unit ${index + 1} location`}
                  className={ROW_INPUT}
                >
                  <option value="">Where?</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <select
                  value={unit.condition}
                  onChange={(event) => onUnit(index, { condition: event.target.value })}
                  aria-label={`${line.description} unit ${index + 1} condition`}
                  className={ROW_INPUT}
                >
                  {RECEIVE_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/**
 * What a fleet line with no model becomes.
 *
 * New is the default because it is the common case: the line was written before
 * anyone knew what the catalog should call it. Existing is for the line somebody
 * forgot to link. Count only keeps the old behaviour — the quantity is recorded
 * so the PO can close, and nothing enters the fleet — for the line that should
 * never have been marked as fleet hardware.
 */
function ModelChoice({
  state,
  categories,
  assets,
  onPatch,
}: {
  state: LineState;
  categories: Option[];
  assets: { id: string; name: string; detail: string }[];
  onPatch: (next: Partial<LineState>) => void;
}) {
  const model = state.model;
  const [remembered, setRemembered] = useState<NewModel | null>(
    model.kind === "new" ? model : null,
  );

  function choose(kind: "new" | "existing" | "count") {
    if (model.kind === "new") setRemembered(model);
    if (kind === "new") {
      onPatch({
        model: remembered ?? {
          kind: "new",
          name: "",
          categoryId: "",
          manufacturer: "",
          model: "",
          build: [],
        },
      });
    } else if (kind === "existing") {
      onPatch({ model: { kind: "existing", assetId: "" } });
    } else {
      onPatch({ model: { kind: "count" } });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-well bg-sunken p-3">
      <div className="flex flex-wrap gap-4 text-detail">
        {(
          [
            ["new", "Create a new model"],
            ["existing", "It is a model we already have"],
            ["count", "Count only — no units"],
          ] as const
        ).map(([kind, label]) => (
          <label key={kind} className="flex items-center gap-2">
            <input
              type="radio"
              checked={model.kind === kind}
              onChange={() => choose(kind)}
              className="accent-[var(--color-accent-solid)]"
            />
            {label}
          </label>
        ))}
      </div>

      {model.kind === "new" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Name">
              <input
                value={model.name}
                onChange={(event) => onPatch({ model: { ...model, name: event.target.value } })}
                onKeyDown={stopEnter}
                className={ROW_INPUT_TALL}
              />
            </Field>
            <Field label="Category">
              <select
                value={model.categoryId}
                onChange={(event) => onPatch({ model: { ...model, categoryId: event.target.value } })}
                className={ROW_INPUT_TALL}
              >
                <option value="">Choose…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Manufacturer">
              <input
                value={model.manufacturer}
                onChange={(event) => onPatch({ model: { ...model, manufacturer: event.target.value } })}
                onKeyDown={stopEnter}
                className={ROW_INPUT_TALL}
              />
            </Field>
            <Field label="Model">
              <input
                value={model.model}
                onChange={(event) => onPatch({ model: { ...model, model: event.target.value } })}
                onKeyDown={stopEnter}
                className={ROW_INPUT_TALL}
              />
            </Field>
          </div>
          <BuildPicker model={model} onChange={(build) => onPatch({ model: { ...model, build } })} />
          <p className="text-micro text-ink-faint">
            Rates, depreciation and market price are set on the model&rsquo;s record
            afterwards — receiving knows what it cost, not what it rents for.
          </p>
        </>
      ) : model.kind === "existing" ? (
        <Field label="Model">
          <select
            value={model.assetId}
            onChange={(event) => onPatch({ model: { kind: "existing", assetId: event.target.value } })}
            className={ROW_INPUT_TALL}
          >
            <option value="">Choose the model…</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
                {asset.detail ? ` — ${asset.detail}` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-detail text-ink-muted">
          The quantity is recorded so the PO can close. No model and no units are
          created, so none of this hardware can be booked or tracked.
        </p>
      )}
    </div>
  );
}

/**
 * The build the new model is sold as — optional, and the same bill of
 * materials the model record edits. Parts are looked up with asset-build's own
 * search, which already leaves out anything that has a build of its own.
 */
function BuildPicker({
  model,
  onChange,
}: {
  model: NewModel;
  onChange: (build: NewModel["build"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; categoryName: string | null }[]>([]);
  const [, startLookup] = useTransition();

  function search(value: string) {
    setQuery(value);
    startLookup(async () => {
      const found = await lookupParts(value, "");
      setResults(found.filter((part) => !model.build.some((row) => row.componentAssetId === part.id)));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-micro uppercase text-ink-muted">
        Build <span className="normal-case text-ink-faint">— optional: what one of these is made of</span>
      </p>
      {model.build.length > 0 ? (
        <ul className="flex flex-col gap-[2px]">
          {model.build.map((part, index) => (
            <li
              key={part.componentAssetId}
              className="grid grid-cols-[minmax(0,1fr)_56px_120px_96px_24px] items-center gap-2 rounded-row bg-panel px-2 py-1 text-detail"
            >
              <span className="truncate">{part.name}</span>
              <input
                type="number"
                min={1}
                value={part.quantity}
                onChange={(event) =>
                  onChange(model.build.map((row, i) => (i === index ? { ...row, quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) } : row)))
                }
                onKeyDown={stopEnter}
                aria-label={`${part.name} quantity`}
                className="h-7 rounded-well bg-sunken px-2 text-right tabular-nums outline-none"
              />
              <select
                value={part.priceMode}
                onChange={(event) =>
                  onChange(model.build.map((row, i) => (i === index ? { ...row, priceMode: event.target.value as "INCLUDED" | "ADDS" } : row)))
                }
                aria-label={`${part.name} pricing`}
                className="h-7 rounded-well bg-sunken px-1 outline-none"
              >
                <option value="INCLUDED">Included</option>
                <option value="ADDS">Adds its rate</option>
              </select>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={part.isDefault}
                  onChange={(event) =>
                    onChange(model.build.map((row, i) => (i === index ? { ...row, isDefault: event.target.checked } : row)))
                  }
                  className="accent-[var(--color-accent-solid)]"
                />
                Standard
              </label>
              <button
                type="button"
                aria-label={`Remove ${part.name}`}
                onClick={() => onChange(model.build.filter((_, i) => i !== index))}
                className="text-ink-faint hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <input
          value={query}
          onChange={(event) => search(event.target.value)}
          onKeyDown={stopEnter}
          placeholder="Add a part — search the catalog"
          aria-label="Search for a part"
          className={ROW_INPUT_TALL}
        />
        {query.trim().length >= 2 && results.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 flex flex-col gap-px rounded-well bg-panel p-1 shadow-lg">
            {results.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([
                      ...model.build,
                      {
                        componentAssetId: part.id,
                        name: part.name,
                        quantity: 1,
                        priceMode: "INCLUDED",
                        isDefault: true,
                      },
                    ]);
                    setQuery("");
                    setResults([]);
                  }}
                  className="flex w-full items-baseline gap-2 rounded-row px-2 py-1 text-left text-detail hover:bg-row-hover"
                >
                  <span className="font-bold">{part.name}</span>
                  {part.categoryName ? <span className="text-ink-faint">{part.categoryName}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Today in the browser's zone, as a date input wants it. */
function localDay(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A scanner ends every read with Enter; it must not submit the receipt. */
function stopEnter(event: React.KeyboardEvent) {
  if (event.key === "Enter") event.preventDefault();
}

/**
 * Enter moves barcode → serial on the same unit, and serial → the next unit's
 * serial, so a receiver can scan a pallet without touching the mouse.
 */
function advance(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const current = event.currentTarget;
  const scope = current.closest("form");
  if (!scope) return;
  const serials = Array.from(scope.querySelectorAll<HTMLInputElement>('input[data-scan="serial"]'));
  const row = current.closest("li");
  const next =
    current.dataset.scan === "barcode"
      ? row?.querySelector<HTMLInputElement>('input[data-scan="serial"]')
      : serials[serials.indexOf(current) + 1];
  next?.focus();
  next?.select();
}

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";
const ROW_INPUT =
  "h-8 w-full rounded-well border-0 bg-panel px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent-solid";
const ROW_INPUT_TALL =
  "h-9 w-full rounded-well border-0 bg-panel px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent-solid";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-[6px] text-micro uppercase text-ink-muted">{label}</p>
      {children}
      {hint ? <p className="mt-1 text-micro text-ink-faint">{hint}</p> : null}
    </div>
  );
}
