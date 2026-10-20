"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { loadCloudProducts } from "@/lib/actions/cloud-host";
import {
  CLOUD_PERIODS,
  HOST_CATEGORIES,
  HOST_CATEGORY_LABEL,
  PERIOD_NOUN,
  cleanMarginOverride,
  priceCloudHost,
  type CloudHostInput,
  type CloudPeriod,
  type CloudProductRow,
  type HostCategory,
} from "@/lib/cloud/host";
import { resolveCloudSellPrice } from "@/lib/cloud-products";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-body text-ink outline-none placeholder:text-ink-faint";
const SMALL =
  "h-8 w-full rounded-row border-0 bg-sunken px-2 text-detail text-ink outline-none";
const LABEL = "mb-[6px] block text-micro uppercase text-ink-muted";

type Row = { key: number; category: HostCategory; productId: string; qty: string };

/**
 * Compose a cloud host from the catalogue: CPU, RAM, drives, GPUs, networking —
 * the spec-based way to draft a cloud order, with no hardware behind it.
 *
 * v1's configurator (cloud-host-configurator, c956e1a), on this app's dialog.
 * CPU and RAM are required; everything else can be added as often as the host
 * needs ("2x GPU", a second drive). The quantity is how many hosts (nodes) the
 * client takes; the spec line the order shows is built from the parts, so it
 * can't drift from them.
 *
 * It only collects ids and counts. The price shown here is the same pure call
 * the server stores with (`priceCloudHost`), but the server prices again from
 * the catalogue — nothing typed or shown here is stored as money.
 */
type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  submitLabel?: string;
  /** An existing host's configuration (edit), or null for a new one. */
  initial?: {
    period: CloudPeriod;
    quantity: number;
    hostName: string | null;
    /** Only a draft remembers it; a saved host stores the prices it came to. */
    marginOverride?: number | null;
    rows: Array<{ cloudProductId: string; qtyPerHost: number }>;
  } | null;
  defaultPeriod?: CloudPeriod;
  /** The catalogue, when the caller already has it; otherwise it is fetched on first open. */
  products?: CloudProductRow[] | null;
  /** Returns a message to show when the save is refused, or null/undefined when it worked. */
  onConfirm: (input: CloudHostInput) => Promise<string | null | void> | string | null | void;
};

/**
 * Mounted only while open, so every opening starts from its own props — add and
 * edit can never leak into each other — and the form below can seed its state
 * from them directly rather than syncing it in an effect.
 */
export function CloudHostDialog(props: DialogProps) {
  if (!props.open) return null;
  return <Loader {...props} />;
}

function Loader(props: DialogProps) {
  const [fetched, setFetched] = useState<CloudProductRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const products = props.products ?? fetched;

  // The catalogue is fetched when the dialog first opens, not shipped with the page.
  useEffect(() => {
    if (props.products) return;
    let live = true;
    loadCloudProducts()
      .then((found) => {
        if (!live) return;
        if (found.length === 0) setLoadError("The cloud catalogue is empty — add products under Pricing → Cloud.");
        setFetched(found);
      })
      .catch(() => live && setLoadError("The cloud catalogue couldn't be loaded."));
    return () => {
      live = false;
    };
  }, [props.products]);

  if (!products || loadError) {
    return (
      <Modal
        open
        onOpenChange={props.onOpenChange}
        wide
        title={props.title ?? "Configure a cloud host"}
        footer={<ModalCancel />}
      >
        {loadError ? (
          <p className="text-detail text-destructive">{loadError}</p>
        ) : (
          <p className="text-detail text-ink-muted">Loading the catalogue…</p>
        )}
      </Modal>
    );
  }
  return <HostForm {...props} products={products} />;
}

let rowKey = 0;
const newKey = () => ++rowKey;

function HostForm({
  onOpenChange,
  title = "Configure a cloud host",
  submitLabel = "Add host",
  initial = null,
  defaultPeriod = "MONTHLY",
  products,
  onConfirm,
}: DialogProps & { products: CloudProductRow[] }) {
  const byCategory = useMemo(() => {
    const out: Record<string, CloudProductRow[]> = {};
    for (const p of products) (out[p.category] ??= []).push(p);
    return out;
  }, [products]);

  const [period, setPeriod] = useState<CloudPeriod>(initial?.period ?? defaultPeriod);
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [hostName, setHostName] = useState(initial?.hostName ?? "");
  const [margin, setMargin] = useState(initial?.marginOverride != null ? String(initial.marginOverride) : "");
  const [rows, setRows] = useState<Row[]>(() => {
    if (initial) {
      return initial.rows.flatMap((r) => {
        const p = products.find((x) => x.id === r.cloudProductId);
        return p ? [{ key: newKey(), category: p.category as HostCategory, productId: p.id, qty: String(r.qtyPerHost) }] : [];
      });
    }
    // A new host starts with the two parts every host needs.
    return (["HOST_CPU", "HOST_RAM"] as const).flatMap((category) => {
      const first = products.find((p) => p.category === category);
      return first ? [{ key: newKey(), category, productId: first.id, qty: "1" }] : [];
    });
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function addRow(category: HostCategory) {
    const first = (byCategory[category] ?? [])[0];
    setRows((r) => [...r, { key: newKey(), category, productId: first?.id ?? "", qty: "1" }]);
  }
  function patch(key: number, change: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  const input: CloudHostInput = {
    period,
    quantity: Math.max(1, Math.floor(Number(quantity)) || 1),
    hostName: hostName.trim() || null,
    marginOverride: margin.trim() === "" ? null : cleanMarginOverride(Number(margin)),
    rows: rows.filter((r) => r.productId).map((r) => ({ cloudProductId: r.productId, qtyPerHost: Math.max(1, Math.floor(Number(r.qty)) || 1) })),
  };

  let priced: ReturnType<typeof priceCloudHost> | null = null;
  let problem = "";
  try {
    priced = priceCloudHost(products, input);
  } catch (e) {
    problem = e instanceof Error ? e.message : "";
  }
  const incomplete = rows.some((r) => !r.productId);
  const marginBad = margin.trim() !== "" && cleanMarginOverride(Number(margin)) == null;

  async function save() {
    if (!priced) return;
    setError("");
    setBusy(true);
    try {
      const refused = await onConfirm(input);
      if (refused) setError(refused);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      wide
      title={title}
      blurb="Pick the parts and the number of hosts. CPU and RAM are required; add a part again for a second GPU or drive. No hardware is assigned."
      footer={
        <>
          {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
          <ModalCancel />
          <ModalConfirm onClick={save} disabled={busy || !priced || incomplete || marginBad}>
            {busy ? "Saving…" : submitLabel}
          </ModalConfirm>
        </>
      }
    >
      {(
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_90px]">
            <div>
              <label className={LABEL} htmlFor="host-name">Host name</label>
              <input
                id="host-name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="Optional, e.g. HP-VM"
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="host-period">Billed</label>
              <select
                id="host-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as CloudPeriod)}
                className={FIELD}
              >
                {CLOUD_PERIODS.map((p) => (
                  <option key={p} value={p}>per {PERIOD_NOUN[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="host-qty">Hosts</label>
              <input
                id="host-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={`${FIELD} text-right tabular-nums`}
              />
            </div>
          </div>

          <div>
            <span className={LABEL}>Parts of each host</span>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => {
                const options = byCategory[row.category] ?? [];
                const line = priced?.components.find(
                  (c) => c.cloudProductId === row.productId && c.qtyPerHost === Math.max(1, Math.floor(Number(row.qty)) || 1),
                );
                return (
                  <li key={row.key} className="grid grid-cols-[84px_minmax(0,1fr)_56px_84px_24px] items-center gap-2 rounded-bubble bg-row-alt p-2">
                    <select
                      aria-label="Kind of part"
                      value={row.category}
                      onChange={(e) => {
                        const category = e.target.value as HostCategory;
                        patch(row.key, { category, productId: (byCategory[category] ?? [])[0]?.id ?? "" });
                      }}
                      className={SMALL}
                    >
                      {HOST_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{HOST_CATEGORY_LABEL[c]}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`${HOST_CATEGORY_LABEL[row.category]} part`}
                      value={row.productId}
                      onChange={(e) => patch(row.key, { productId: e.target.value })}
                      className={SMALL}
                    >
                      {options.length === 0 ? <option value="">Nothing in the catalogue</option> : null}
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {MONEY.format(resolveCloudSellPrice(p, period))}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Number of this part in each host"
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(e) => patch(row.key, { qty: e.target.value })}
                      className={`${SMALL} text-right tabular-nums`}
                    />
                    <span className="text-right text-detail tabular-nums text-ink-muted">
                      {line ? MONEY.format(line.rate) : "—"}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove part"
                      onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                      className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              {HOST_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addRow(c)}
                  className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
                >
                  <Plus className="size-[13px]" aria-hidden />
                  {HOST_CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            {problem && !incomplete ? <p className="mt-2 text-detail text-ink-muted">{problem}</p> : null}
          </div>

          <details className="rounded-well bg-sunken px-3 py-2">
            <summary className="cursor-pointer text-detail font-bold text-ink">Margin</summary>
            <div className="mt-2 max-w-[14rem]">
              <label className={LABEL} htmlFor="host-margin">Margin override %</label>
              <input
                id="host-margin"
                inputMode="decimal"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                placeholder="Each part's own"
                className={`${FIELD} bg-panel text-right tabular-nums`}
              />
              <p className="mt-[6px] text-detail text-ink-muted">
                Blank prices each part at its catalogue price. A figure reprices every part as cost + that margin.
              </p>
              {marginBad ? <p className="text-detail text-destructive">A margin is a number from 0 to 999.</p> : null}
            </div>
          </details>

          <div className="rounded-bubble bg-row-alt p-3">
            <p className="text-micro uppercase text-ink-muted">What the order will say</p>
            <p className="mt-1 break-words font-bold">{priced?.description ?? "—"}</p>
            {priced ? (
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-detail">
                <dt className="text-ink-muted">One host, per {PERIOD_NOUN[priced.period]}</dt>
                <dd className="text-right tabular-nums">{MONEY.format(priced.perHostSell)}</dd>
                <dt className="text-ink-muted">
                  {priced.quantity} {priced.quantity === 1 ? "host" : "hosts"}, per {PERIOD_NOUN[priced.period]}
                </dt>
                <dd className="text-right font-bold tabular-nums">{MONEY.format(priced.totalSell)}</dd>
                <dt className="text-ink-faint">Internal · cost / margin</dt>
                <dd className="text-right tabular-nums text-ink-faint">
                  {MONEY.format(priced.perHostCost * priced.quantity)} · {priced.marginPercent.toFixed(1)}%
                </dd>
              </dl>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
