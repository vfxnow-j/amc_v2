"use client";

import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { CloudHostDialog } from "@/components/reservations/cloud-host-dialog";
import { CloudEnvPicker } from "@/components/reservations/cloud-env-picker";
import {
  PERIOD_NOUN,
  priceCloudEnv,
  priceCloudHost,
  type CloudEnvInput,
  type CloudHostInput,
  type CloudProductRow,
} from "@/lib/cloud/host";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * The new-order builder's body for a cloud order: hosts composed from the
 * catalogue, and the environment (internet, shared storage, add-ons) — in place
 * of the equipment search. Nothing here needs a unit; availability doesn't apply.
 *
 * The lines live in the builder (this is controlled) and are sent with the
 * order. The money shown is the same pure call the server stores with.
 */
export function CloudLines({
  products,
  hosts,
  setHosts,
  env,
  setEnv,
}: {
  products: CloudProductRow[] | null;
  hosts: CloudHostInput[];
  setHosts: (next: CloudHostInput[]) => void;
  env: CloudEnvInput[];
  setEnv: (next: CloudEnvInput[]) => void;
}) {
  // `null` is closed, -1 a new host, otherwise the index being edited.
  const [editing, setEditing] = useState<number | null>(null);

  const describe = (h: CloudHostInput) => {
    try {
      return products ? priceCloudHost(products, h) : null;
    } catch {
      return null;
    }
  };
  const envLine = (e: CloudEnvInput) => {
    try {
      return products ? priceCloudEnv(products, e) : null;
    } catch {
      return null;
    }
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-panel pt-[14px] shadow-sm">
      <header className="flex items-center gap-2 px-4 pb-3">
        <h2 className="text-card-title">Cloud</h2>
        <span className="text-detail text-ink-muted">
          Drafted from a spec — no hardware is assigned
        </span>
      </header>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => setEditing(-1)}
          disabled={!products}
          className="flex items-center gap-1 rounded-pill bg-accent-solid px-3 py-1 text-pill text-accent-on-solid disabled:opacity-50"
        >
          <Plus className="size-[13px]" aria-hidden />
          {products ? "Add a cloud host" : "Loading the catalogue…"}
        </button>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {hosts.length === 0 && env.length === 0 ? (
          <li className="px-2 py-6 text-center text-body text-ink-muted">
            Nothing on this order yet — add a host, then any internet, storage or add-ons.
          </li>
        ) : null}

        {hosts.map((host, index) => {
          const priced = describe(host);
          return (
            <li key={`host-${index}`} className="rounded-bubble bg-row-alt p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_28px_28px] items-baseline gap-2 px-1">
                <span className="min-w-0 break-words font-bold">
                  {priced?.description ?? "Incomplete host"}
                </span>
                <span className="text-right font-bold tabular-nums">
                  {priced ? MONEY.format(priced.totalSell) : "—"}
                </span>
                <button
                  type="button"
                  aria-label="Edit host"
                  onClick={() => setEditing(index)}
                  className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                >
                  <Pencil className="size-3" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Remove host"
                  onClick={() => setHosts(hosts.filter((_, i) => i !== index))}
                  className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
              {priced ? (
                <p className="mt-1 px-1 text-detail text-ink-muted">
                  {priced.quantity} {priced.quantity === 1 ? "host" : "hosts"} × {MONEY.format(priced.perHostSell)} per{" "}
                  {PERIOD_NOUN[priced.period]}
                </p>
              ) : null}
            </li>
          );
        })}

        {env.map((line, index) => {
          const priced = envLine(line);
          return (
            <li key={`env-${index}`} className="rounded-bubble bg-row-alt p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_28px] items-baseline gap-2 px-1">
                <span className="min-w-0 break-words font-bold">
                  {priced?.description ?? "Unavailable item"}
                  {line.quantity > 1 ? <span className="font-normal text-ink-faint"> ×{line.quantity}</span> : null}
                </span>
                <span className="text-right font-bold tabular-nums">
                  {priced ? MONEY.format(priced.rate * priced.quantity) : "—"}
                  <span className="text-micro font-normal text-ink-faint"> /month</span>
                </span>
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => setEnv(env.filter((_, i) => i !== index))}
                  className="rounded-tile p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-hairline px-4 py-3">
        <CloudEnvPicker
          products={products}
          onAdd={(product, quantity) => setEnv([...env, { cloudProductId: product.id, quantity }])}
        />
      </div>

      <CloudHostDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        products={products}
        title={editing !== null && editing >= 0 ? "Edit cloud host" : "Configure a cloud host"}
        submitLabel={editing !== null && editing >= 0 ? "Save host" : "Add host"}
        initial={editing !== null && editing >= 0 ? hosts[editing] ? { ...hosts[editing], hostName: hosts[editing].hostName ?? null, rows: hosts[editing].rows } : null : null}
        onConfirm={(input) => {
          if (editing !== null && editing >= 0) setHosts(hosts.map((h, i) => (i === editing ? input : h)));
          else setHosts([...hosts, input]);
        }}
      />
    </section>
  );
}
