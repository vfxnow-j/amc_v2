"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { loadCloudProducts } from "@/lib/actions/cloud-host";
import {
  ENV_CATEGORIES,
  ENV_LINE,
  type CloudProductRow,
  type EnvCategory,
} from "@/lib/cloud/host";
import { resolveCloudSellPrice } from "@/lib/cloud-products";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const SMALL = "h-8 rounded-row border-0 bg-sunken px-2 text-detail text-ink outline-none";

/**
 * Add an environment item — internet, shared storage, an add-on — to a cloud
 * order: pick the kind, the product and how many. Environment lines are plain
 * monthly lines (v1 priced them the same way), so the price shown is the
 * catalogue's monthly price and the server prices again when it is stored.
 */
export function CloudEnvPicker({
  products: given,
  onAdd,
  busy = false,
}: {
  /** The catalogue, when the caller already has it; otherwise it is fetched on first use. */
  products?: CloudProductRow[] | null;
  onAdd: (product: CloudProductRow, quantity: number) => void;
  busy?: boolean;
}) {
  const [fetched, setFetched] = useState<CloudProductRow[] | null>(null);
  const products = given ?? fetched;
  const [category, setCategory] = useState<EnvCategory>("ENV_INTERNET");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    if (given) return;
    let live = true;
    loadCloudProducts().then((found) => live && setFetched(found));
    return () => {
      live = false;
    };
  }, [given]);

  const options = (products ?? []).filter((p) => p.category === category);
  const chosen = options.find((p) => p.id === productId) ?? options[0];
  const qty = Math.max(1, Math.floor(Number(quantity)) || 1);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <span>
        <span className="mb-[6px] block text-micro uppercase text-ink-muted">Environment</span>
        <select
          aria-label="Kind of environment item"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as EnvCategory);
            setProductId("");
          }}
          className={SMALL}
        >
          {ENV_CATEGORIES.map((c) => (
            <option key={c} value={c}>{ENV_LINE[c].label}</option>
          ))}
        </select>
      </span>
      <select
        aria-label="Environment product"
        value={chosen?.id ?? ""}
        onChange={(e) => setProductId(e.target.value)}
        className={`${SMALL} min-w-[10rem]`}
      >
        {options.length === 0 ? <option value="">{products ? "Nothing in the catalogue" : "Loading…"}</option> : null}
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {MONEY.format(resolveCloudSellPrice(p, "MONTHLY"))}/mo
          </option>
        ))}
      </select>
      <input
        aria-label="Quantity"
        inputMode="numeric"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className={`${SMALL} w-14 text-right tabular-nums`}
      />
      <button
        type="button"
        disabled={!chosen || busy}
        onClick={() => chosen && onAdd(chosen, qty)}
        className="flex h-8 items-center gap-1 rounded-pill bg-sunken px-3 text-pill text-ink hover:bg-row-hover disabled:opacity-50"
      >
        <Plus className="size-[13px]" aria-hidden />
        Add
      </button>
    </div>
  );
}
