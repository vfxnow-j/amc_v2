"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CloudProductCategory } from "@/generated/prisma/enums";
import {
  createCloudProduct,
  deleteCloudProduct,
  updateCloudProduct,
} from "@/lib/actions/cloud-products";
import { CLOUD_CATEGORIES, resolveCloudSellPrice } from "@/lib/cloud-products";

export type CloudProductDraft = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  costHourly: number;
  costDaily: number;
  costWeekly: number;
  costMonthly: number;
  sellHourly: number | null;
  sellDaily: number | null;
  sellWeekly: number | null;
  sellMonthly: number | null;
  marginPercent: number;
  active: boolean;
  usedOnOrders: number;
};

const PERIODS = [
  { key: "Hourly", label: "Hour", period: "HOURLY" },
  { key: "Daily", label: "Day", period: "DAILY" },
  { key: "Weekly", label: "Week", period: "WEEKLY" },
  { key: "Monthly", label: "Month", period: "MONTHLY" },
] as const;

/**
 * The price of one cloud line item.
 *
 * Cost and margin are what is normally set; the four sell fields are overrides
 * and are left blank almost always. That relationship is the whole design of
 * this form — a blank sell field means "cost plus the margin", and the derived
 * figure is shown beside it as you type so nobody has to work out what leaving
 * it blank will charge. Typing into it pins the price and stops the margin
 * applying to that period.
 *
 * The same rule is what the Cloud services list marks with "·d" and explains in
 * its footer: a derived price is not a price somebody set, and the two are
 * never shown as if they were the same fact.
 */
export function CloudProductForm({
  product,
  canDelete,
}: {
  product: CloudProductDraft | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const [category, setCategory] = useState<CloudProductCategory>(
    (product?.category as CloudProductCategory) ?? "HOST_CPU",
  );
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [margin, setMargin] = useState(String(product?.marginPercent ?? 25));
  const [active, setActive] = useState(product?.active ?? true);
  const [cost, setCost] = useState(() => moneyFields(product, "cost"));
  const [sell, setSell] = useState(() => moneyFields(product, "sell"));

  useEffect(() => {
    setCategory((product?.category as CloudProductCategory) ?? "HOST_CPU");
    setName(product?.name ?? "");
    setDescription(product?.description ?? "");
    setMargin(String(product?.marginPercent ?? 25));
    setActive(product?.active ?? true);
    setCost(moneyFields(product, "cost"));
    setSell(moneyFields(product, "sell"));
    setError("");
    setConfirming(false);
  }, [product]);

  const marginNumber = Number(margin) || 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");

    const payload = {
      category,
      name: name.trim(),
      description: description.trim() || null,
      costHourly: Number(cost.Hourly) || 0,
      costDaily: Number(cost.Daily) || 0,
      costWeekly: Number(cost.Weekly) || 0,
      costMonthly: Number(cost.Monthly) || 0,
      // Empty means "derive it", which is a null in the column — not a zero,
      // which would be a deliberate price of nothing.
      sellHourly: sell.Hourly === "" ? null : Number(sell.Hourly),
      sellDaily: sell.Daily === "" ? null : Number(sell.Daily),
      sellWeekly: sell.Weekly === "" ? null : Number(sell.Weekly),
      sellMonthly: sell.Monthly === "" ? null : Number(sell.Monthly),
      marginPercent: marginNumber,
      active,
    };

    startTransition(async () => {
      try {
        if (product) await updateCloudProduct(product.id, payload);
        else await createCloudProduct(payload);
        router.push("/dashboard/settings/cloud-products");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save.");
      }
    });
  }

  function remove() {
    if (!product) return;
    setError("");
    startTransition(async () => {
      try {
        await deleteCloudProduct(product.id);
        router.push("/dashboard/settings/cloud-products");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not delete.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
      {error ? (
        <p
          role="alert"
          className="rounded-well bg-destructive/10 px-3 py-2 text-detail text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Category</span>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as CloudProductCategory)
            }
            className="h-9 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {CLOUD_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className="text-micro uppercase text-ink-muted">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. 16C"
            className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">
          Description — optional
        </span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="h-9 rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className="text-micro uppercase text-ink-muted">Margin %</span>
        <input
          inputMode="decimal"
          value={margin}
          onChange={(event) => setMargin(event.target.value)}
          className="h-9 w-24 rounded-well border-0 bg-sunken px-3 text-detail tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div>
        <div className="mb-1 grid grid-cols-[64px_1fr_1fr] items-baseline gap-2 text-micro uppercase text-ink-muted">
          <span />
          <span>Our cost</span>
          <span>Sell — blank derives</span>
        </div>
        <div className="flex flex-col gap-1">
          {PERIODS.map((period) => {
            const derived =
              sell[period.key] === ""
                ? resolveCloudSellPrice(
                    {
                      costHourly: Number(cost.Hourly) || 0,
                      costDaily: Number(cost.Daily) || 0,
                      costWeekly: Number(cost.Weekly) || 0,
                      costMonthly: Number(cost.Monthly) || 0,
                      sellHourly: null,
                      sellDaily: null,
                      sellWeekly: null,
                      sellMonthly: null,
                      marginPercent: marginNumber,
                    },
                    period.period,
                  )
                : null;

            return (
              <div
                key={period.key}
                className="grid grid-cols-[64px_1fr_1fr] items-center gap-2"
              >
                <span className="text-detail text-ink-muted">
                  {period.label}
                </span>
                <input
                  inputMode="decimal"
                  aria-label={`Cost per ${period.label.toLowerCase()}`}
                  value={cost[period.key]}
                  onChange={(event) =>
                    setCost({ ...cost, [period.key]: event.target.value })
                  }
                  className="h-8 rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="relative">
                  <input
                    inputMode="decimal"
                    aria-label={`Sell per ${period.label.toLowerCase()}`}
                    value={sell[period.key]}
                    placeholder={
                      derived === null ? "" : `${derived.toFixed(2)} derived`
                    }
                    onChange={(event) =>
                      setSell({ ...sell, [period.key]: event.target.value })
                    }
                    className="h-8 w-full rounded-well border-0 bg-sunken px-2 text-detail tabular-nums text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-well bg-sunken p-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          className="mt-[2px] size-[14px] flex-none accent-accent-solid"
        />
        <span>
          <span className="block text-detail font-bold text-ink">Sellable</span>
          <span className="block text-detail text-ink-muted">
            Unticked keeps the price on file and takes it out of the cloud order
            builder. Existing orders are untouched.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-50"
        >
          {busy ? "Saving…" : product ? "Save changes" : "Add product"}
        </button>
        {product ? (
          <a
            href="/dashboard/settings/cloud-products"
            className="rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
          >
            Cancel
          </a>
        ) : null}
      </div>

      {product && canDelete ? (
        <div className="rounded-well bg-sunken p-3 text-detail text-ink-muted">
          {product.usedOnOrders > 0 ? (
            <p>
              On {product.usedOnOrders}{" "}
              {product.usedOnOrders === 1 ? "order line" : "order lines"}, so
              deleting it would take the price off work already sold. Untick
              &ldquo;sellable&rdquo; instead — it stops appearing on new orders
              and the old ones keep their figures.
            </p>
          ) : confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="rounded-pill bg-destructive px-3 py-1 text-pill text-destructive-foreground disabled:opacity-50"
              >
                Yes, delete {product.name}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-pill bg-panel px-3 py-1 text-pill text-ink-muted hover:text-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2">Never sold, so it can be removed outright.</p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-pill bg-panel px-3 py-1 text-pill text-destructive hover:bg-row-hover"
              >
                Delete product
              </button>
            </>
          )}
        </div>
      ) : null}
    </form>
  );
}

type MoneyFields = Record<(typeof PERIODS)[number]["key"], string>;

/** Decimal columns come back as numbers; the inputs want strings, and null
 *  must stay empty rather than becoming "0". */
function moneyFields(
  product: CloudProductDraft | null,
  kind: "cost" | "sell",
): MoneyFields {
  const read = (period: (typeof PERIODS)[number]["key"]) => {
    if (!product) return "";
    const value =
      kind === "cost"
        ? product[`cost${period}` as keyof CloudProductDraft]
        : product[`sell${period}` as keyof CloudProductDraft];
    if (value === null || value === undefined) return "";
    return String(value);
  };

  return {
    Hourly: read("Hourly"),
    Daily: read("Daily"),
    Weekly: read("Weekly"),
    Monthly: read("Monthly"),
  };
}
