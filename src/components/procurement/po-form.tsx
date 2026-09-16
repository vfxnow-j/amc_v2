"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import { moneyExact } from "@/lib/format";
import {
  raisePurchaseOrder,
  savePurchaseOrder,
  type POOutcome,
} from "@/lib/procurement/po-actions";
import {
  LINE_KIND_LABEL,
  PO_METHOD_LABEL,
  PO_METHODS,
  PO_ORDER_TYPE_LABEL,
  PO_ORDER_TYPES,
  poTotals,
  type LineKind,
} from "@/lib/procurement/po-labels";

/**
 * Raising or editing a purchase order.
 *
 * Only what the PO cannot exist without is required — the vendor and the date.
 * A draft is where an order gets assembled, often before the vendor has quoted,
 * so lines, prices and tax can all be filled in later; the record will not let
 * it be submitted with nothing on it.
 *
 * Numbers are held as the strings the inputs give, and parsed once on save. A
 * number state turns a half-typed "12." into 12 under the cursor.
 *
 * A line's receiving mode is chosen here because it decides what receiving
 * does: a fleet line makes one unit per item, a resale line captures serials
 * only, a consumable is counted and nothing more. A fleet line needs no model
 * yet — receiving creates one when the hardware lands.
 */

export type POFormLine = {
  id?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  assetId: string | null;
  kind: LineKind;
  /** Already received — the line cannot be removed or dropped below this. */
  received?: number;
};

export type POFormValues = {
  vendorId: string;
  shipToLocationId: string;
  orderDate: string;
  expectedDate: string;
  orderType: string;
  purchaseMethod: string;
  creditTerms: string;
  discountType: "" | "PERCENTAGE" | "FIXED";
  discountValue: string;
  freightAmount: string;
  taxAmount: string;
  taxExempt: boolean;
  notes: string;
  lines: POFormLine[];
  fees: { description: string; amount: string }[];
};

type Option = { id: string; name: string };
type AssetOption = { id: string; name: string; detail: string };

const BLANK_LINE: POFormLine = {
  description: "",
  quantity: "1",
  unitPrice: "",
  assetId: null,
  kind: "units",
};

const num = (value: string) => {
  const parsed = Number(value);
  return value.trim() === "" || !Number.isFinite(parsed) ? 0 : parsed;
};

export function POForm({
  mode,
  poId,
  initial,
  vendors,
  locations,
  assets,
  onLease = false,
  funding,
  cancelHref,
}: {
  mode: "create" | "edit";
  poId?: string;
  initial: POFormValues;
  vendors: Option[];
  locations: Option[];
  assets: AssetOption[];
  /** The PO is on a lease, which fixes its purchase method. */
  onLease?: boolean;
  /** Create only: the funding request this PO will be attached to. */
  funding?: { id: string; requestNumber: string } | null;
  cancelHref: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<POFormValues>(initial);
  const [outcome, setOutcome] = useState<POOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  const set = (patch: Partial<POFormValues>) =>
    setForm((current) => ({ ...current, ...patch }));
  const setLine = (index: number, patch: Partial<POFormLine>) =>
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const totals = poTotals({
    lines: form.lines.map((line) => ({
      quantity: num(line.quantity),
      unitPrice: num(line.unitPrice),
    })),
    fees: form.fees.map((fee) => ({ amount: num(fee.amount) })),
    discountType: form.discountType || null,
    discountValue: num(form.discountValue),
    freight: num(form.freightAmount),
    tax: num(form.taxAmount),
    taxExempt: form.taxExempt,
  });

  function submit() {
    setOutcome(null);
    startTransition(async () => {
      const input = {
        vendorId: form.vendorId,
        shipToLocationId: form.shipToLocationId || null,
        orderDate: form.orderDate,
        expectedDate: form.expectedDate || null,
        orderType: form.orderType || null,
        purchaseMethod: onLease ? "LOAN" : form.purchaseMethod || null,
        creditTerms: form.purchaseMethod === "VENDOR_CREDIT" ? form.creditTerms : null,
        discountType: form.discountType || null,
        discountValue: num(form.discountValue),
        freightAmount: num(form.freightAmount),
        taxAmount: num(form.taxAmount),
        taxExempt: form.taxExempt,
        notes: form.notes,
        // A quantity typed as "2.5" must reach the server as 2.5 and be refused
        // there with the line named, not be rounded here into something nobody
        // typed.
        lines: form.lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity.trim() === "" ? NaN : Number(line.quantity),
          unitPrice: num(line.unitPrice),
          assetId: line.assetId,
          kind: line.kind,
        })),
        fees: form.fees.map((fee) => ({
          description: fee.description,
          amount: num(fee.amount),
        })),
        fundingRequestId: funding?.id ?? null,
      };

      const result =
        mode === "create"
          ? await raisePurchaseOrder(input)
          : await savePurchaseOrder(poId!, input);
      setOutcome(result);
      if (result.status === "ok" && result.id) {
        router.push(`/dashboard/purchase-orders/${result.id}`);
      }
    });
  }

  const noTax = !form.taxExempt && num(form.taxAmount) === 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
      className="grid items-start gap-3 lg:grid-cols-[1.6fr_1fr]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
          {funding ? (
            <Notice tone="ok">
              Raised against funding request {funding.requestNumber} — it is attached
              when this PO is created.
              {initial.lines.length > 0
                ? " The lines below are the request's itemised equipment at the requester's estimated cost; replace the prices with the vendor's."
                : ""}
            </Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor" hint="Required.">
              <select
                value={form.vendorId}
                onChange={(event) => set({ vendorId: event.target.value })}
                required
                autoFocus={mode === "create" && !form.vendorId}
                className={INPUT}
              >
                <option value="">Choose a vendor…</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ship to" hint="Receiving defaults each unit to this location.">
              <select
                value={form.shipToLocationId}
                onChange={(event) => set({ shipToLocationId: event.target.value })}
                className={INPUT}
              >
                <option value="">Not set</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ordered" hint="Required.">
              <input
                type="date"
                value={form.orderDate}
                onChange={(event) => set({ orderDate: event.target.value })}
                required
                className={INPUT}
              />
            </Field>
            <Field label="Expected">
              <input
                type="date"
                value={form.expectedDate}
                min={form.orderDate || undefined}
                onChange={(event) => set({ expectedDate: event.target.value })}
                className={INPUT}
              />
            </Field>
            <Field label="Bought as">
              <select
                value={form.orderType}
                onChange={(event) => set({ orderType: event.target.value })}
                className={INPUT}
              >
                <option value="">Not recorded</option>
                {PO_ORDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PO_ORDER_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Paid by"
              hint={
                onLease
                  ? "Fixed by the lease this PO is on — change the lease on the record."
                  : "Received units are owned this way. Unset lands them as cash."
              }
            >
              <select
                value={onLease ? "LOAN" : form.purchaseMethod}
                onChange={(event) => set({ purchaseMethod: event.target.value })}
                disabled={onLease}
                className={`${INPUT} disabled:opacity-60`}
              >
                <option value="">Not recorded</option>
                {PO_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PO_METHOD_LABEL[method]}
                  </option>
                ))}
              </select>
            </Field>
            {form.purchaseMethod === "VENDOR_CREDIT" && !onLease ? (
              <Field label="Credit terms">
                <input
                  value={form.creditTerms}
                  onChange={(event) => set({ creditTerms: event.target.value })}
                  placeholder="Net 30"
                  className={INPUT}
                />
              </Field>
            ) : null}
          </div>
        </section>

        <Lines form={form} setForm={setForm} setLine={setLine} assets={assets} />
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0">
        <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
          <h2 className="text-card-title">Cost</h2>

          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Discount">
              <select
                value={form.discountType}
                onChange={(event) =>
                  set({ discountType: event.target.value as POFormValues["discountType"] })
                }
                className={INPUT}
              >
                <option value="">None</option>
                <option value="PERCENTAGE">Percent off the lines</option>
                <option value="FIXED">Amount off the lines</option>
              </select>
            </Field>
            <Field label={form.discountType === "PERCENTAGE" ? "%" : "$"}>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.discountValue}
                disabled={!form.discountType}
                onChange={(event) => set({ discountValue: event.target.value })}
                className={`${INPUT} text-right tabular-nums disabled:opacity-50`}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Freight">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.freightAmount}
                onChange={(event) => set({ freightAmount: event.target.value })}
                className={`${INPUT} text-right tabular-nums`}
              />
            </Field>
            <Field label="Tax">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.taxExempt ? "" : form.taxAmount}
                placeholder={form.taxExempt ? "Exempt" : "0.00"}
                disabled={form.taxExempt}
                onChange={(event) => set({ taxAmount: event.target.value })}
                className={`${INPUT} text-right tabular-nums disabled:opacity-50`}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-detail text-ink">
            <input
              type="checkbox"
              checked={form.taxExempt}
              onChange={(event) => set({ taxExempt: event.target.checked })}
              className="size-4 accent-[var(--color-accent-solid)]"
            />
            Tax exempt — no tax applies to this order
          </label>

          <div className="flex flex-col gap-2">
            <p className="text-micro uppercase text-ink-muted">Fees</p>
            {form.fees.map((fee, index) => (
              <div key={index} className="grid grid-cols-[1fr_96px_28px] gap-2">
                <input
                  value={fee.description}
                  onChange={(event) =>
                    set({
                      fees: form.fees.map((f, i) =>
                        i === index ? { ...f, description: event.target.value } : f,
                      ),
                    })
                  }
                  placeholder="Restocking, handling…"
                  aria-label={`Fee ${index + 1} description`}
                  className={INPUT}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={fee.amount}
                  onChange={(event) =>
                    set({
                      fees: form.fees.map((f, i) =>
                        i === index ? { ...f, amount: event.target.value } : f,
                      ),
                    })
                  }
                  aria-label={`Fee ${index + 1} amount`}
                  className={`${INPUT} text-right tabular-nums`}
                />
                <RemoveButton
                  label={`Remove fee ${index + 1}`}
                  onClick={() => set({ fees: form.fees.filter((_, i) => i !== index) })}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ fees: [...form.fees, { description: "", amount: "" }] })}
              className="self-start text-detail text-accent-text hover:underline"
            >
              Add a fee
            </button>
          </div>

          <div className="flex flex-col gap-1 border-t border-hairline pt-3 text-detail">
            <Sum label="Lines" value={totals.subtotal} />
            {totals.discount > 0 ? <Sum label="Discount" value={-totals.discount} /> : null}
            {num(form.freightAmount) > 0 ? (
              <Sum label="Freight" value={num(form.freightAmount)} />
            ) : null}
            {totals.fees > 0 ? <Sum label="Fees" value={totals.fees} /> : null}
            <Sum label={form.taxExempt ? "Tax · exempt" : "Tax"} value={totals.tax} />
            <Sum label="Total" value={totals.total} loud />
            {noTax && totals.subtotal > 0 ? (
              <p className="text-micro text-ink-faint">
                No tax entered, so the total assumes none. Tick exempt if that is
                right, or add the vendor&rsquo;s figure when it comes.
              </p>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-panel p-4 shadow-sm">
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
              rows={3}
              placeholder="Quote reference, delivery instructions…"
              className={`${INPUT} h-auto resize-none py-2`}
            />
          </Field>

          {outcome?.status === "error" ? (
            <Notice tone="error">{outcome.message}</Notice>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !form.vendorId || !form.orderDate}
              className="h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50"
            >
              {busy
                ? mode === "create"
                  ? "Raising…"
                  : "Saving…"
                : mode === "create"
                  ? "Raise as draft"
                  : "Save changes"}
            </button>
            <Link
              href={cancelHref}
              className="h-9 rounded-pill bg-sunken px-4 text-pill leading-9 text-ink hover:bg-row-hover"
            >
              Cancel
            </Link>
          </div>
          {mode === "create" ? (
            <p className="text-micro text-ink-faint">
              It is saved as a draft. Nothing goes to the vendor until it is
              submitted from the record.
            </p>
          ) : null}
        </section>
      </div>
    </form>
  );
}

/** The ordered lines, each with the model it is for and how it will be received. */
function Lines({
  form,
  setForm,
  setLine,
  assets,
}: {
  form: POFormValues;
  setForm: React.Dispatch<React.SetStateAction<POFormValues>>;
  setLine: (index: number, patch: Partial<POFormLine>) => void;
  assets: AssetOption[];
}) {
  const byId = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  return (
    <section className="flex flex-col gap-2 rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4">
        <h2 className="text-card-title">Lines</h2>
        <span className="text-detail text-ink-muted">
          {form.lines.length === 0
            ? "nothing on order yet"
            : `${form.lines.length} ${form.lines.length === 1 ? "line" : "lines"}`}
        </span>
      </header>

      {form.lines.length === 0 ? (
        <p className="px-4 text-body text-ink-muted">
          Add what is being ordered. A draft can be saved without lines, but it
          cannot be sent to the vendor until it has one.
        </p>
      ) : null}

      <ul className="flex flex-col gap-[2px] px-2">
        {form.lines.map((line, index) => {
          const received = line.received ?? 0;
          const linked = line.assetId ? byId.get(line.assetId) : null;
          return (
            <li key={line.id ?? `new-${index}`} className="rounded-bubble bg-row-alt p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_64px_96px_96px_28px] items-center gap-2">
                <input
                  value={line.description}
                  onChange={(event) => setLine(index, { description: event.target.value })}
                  placeholder="What is being ordered"
                  aria-label={`Line ${index + 1} description`}
                  className={INPUT_ON_ROW}
                />
                <input
                  type="number"
                  min={Math.max(1, received)}
                  step={1}
                  value={line.quantity}
                  onChange={(event) => setLine(index, { quantity: event.target.value })}
                  aria-label={`Line ${index + 1} quantity`}
                  title={received > 0 ? `${received} already received — cannot go below that` : undefined}
                  className={`${INPUT_ON_ROW} text-right tabular-nums`}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={line.unitPrice}
                  placeholder="Unit $"
                  onChange={(event) => setLine(index, { unitPrice: event.target.value })}
                  aria-label={`Line ${index + 1} unit price`}
                  className={`${INPUT_ON_ROW} text-right tabular-nums`}
                />
                <span className="text-right text-detail tabular-nums text-ink-muted">
                  {moneyExact(num(line.quantity) * num(line.unitPrice))}
                </span>
                <RemoveButton
                  label={`Remove line ${index + 1}`}
                  disabled={received > 0}
                  title={received > 0 ? `${received} received — a received line stays on the PO` : undefined}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      lines: current.lines.filter((_, i) => i !== index),
                    }))
                  }
                />
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                <select
                  value={line.kind}
                  onChange={(event) =>
                    setLine(index, {
                      kind: event.target.value as LineKind,
                      // Only fleet lines hang units off a model.
                      assetId: event.target.value === "units" ? line.assetId : null,
                    })
                  }
                  aria-label={`Line ${index + 1} receiving mode`}
                  className={INPUT_ON_ROW}
                >
                  {(Object.keys(LINE_KIND_LABEL) as LineKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {LINE_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
                {line.kind === "units" ? (
                  <AssetPicker
                    assets={assets}
                    linked={linked ?? null}
                    onPick={(asset) =>
                      setLine(index, {
                        assetId: asset?.id ?? null,
                        description: line.description.trim() || asset?.name || "",
                      })
                    }
                  />
                ) : (
                  <span className="self-center text-detail text-ink-faint">
                    {line.kind === "resale"
                      ? "Serials are recorded on the line; nothing enters the fleet."
                      : "Counted on receipt; never touches the fleet."}
                  </span>
                )}
              </div>
              {received > 0 ? (
                <p className="pt-1 text-micro text-ink-faint">{received} already received</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() =>
            setForm((current) => ({ ...current, lines: [...current.lines, { ...BLANK_LINE }] }))
          }
          className="h-8 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover"
        >
          Add a line
        </button>
      </div>
    </section>
  );
}

/**
 * Which model a fleet line is for.
 *
 * Optional. Hardware the catalog has never seen gets its model when it is
 * received — that is where the manufacturer, category and build are known — so
 * leaving this blank is normal, not a gap.
 */
function AssetPicker({
  assets,
  linked,
  onPick,
}: {
  assets: AssetOption[];
  linked: AssetOption | null;
  onPick: (asset: AssetOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const needle = query.trim().toLowerCase();
  const matches =
    needle.length < 2
      ? []
      : assets
          .filter(
            (asset) =>
              asset.name.toLowerCase().includes(needle) ||
              asset.detail.toLowerCase().includes(needle),
          )
          .slice(0, 8);

  if (linked) {
    return (
      <span className="flex min-w-0 items-center gap-2 self-center text-detail">
        <span className="truncate">
          For <span className="font-bold">{linked.name}</span>
          {linked.detail ? <span className="text-ink-faint"> · {linked.detail}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex-none text-accent-text hover:underline"
        >
          Change
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Existing model — or leave blank and create it on receipt"
        aria-label="Existing model for this line"
        className={INPUT_ON_ROW}
      />
      {open && matches.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 flex flex-col gap-px rounded-well bg-panel p-1 shadow-lg">
          {matches.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(asset);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start rounded-row px-2 py-1 text-left text-detail hover:bg-row-hover"
              >
                <span className="font-bold">{asset.name}</span>
                {asset.detail ? <span className="text-ink-faint">{asset.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";
const INPUT_ON_ROW =
  "h-8 w-full rounded-well border-0 bg-panel px-2 text-detail text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent-solid";

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

function Sum({ label, value, loud }: { label: string; value: number; loud?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={loud ? "font-bold" : "text-ink-muted"}>{label}</span>
      <span
        className={`ml-auto tabular-nums ${loud ? "text-[16px] font-bold" : "text-ink-muted"}`}
      >
        {value < 0 ? `−${moneyExact(-value)}` : moneyExact(value)}
      </span>
    </span>
  );
}

function RemoveButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-well text-ink-faint hover:bg-row-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      ×
    </button>
  );
}
