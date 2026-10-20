import Link from "next/link";
import { money } from "@/lib/format";
import { ORDER_TYPES } from "@/lib/orders/types";
import { getRevenueByType } from "@/lib/queries/orders";
import type { Range } from "@/lib/queries/range";
import { TYPE_LABEL } from "@/lib/reservations/status";

/** The filter slug each type card links its list to. */
const FILTER_FOR: Record<string, string> = {
  RENTAL: "rental",
  SALE: "sale",
  RENT_TO_OWN: "rent-to-own",
  FLOW: "flow",
  CLOUD: "cloud",
};

/**
 * Dashboard: where the money comes from, split by the same types the Orders
 * list is split by — one table, one row per type, so it fits its tile.
 *
 * **Earned** is accrual-basis revenue recognized inside the window — the real
 * "revenue stream" figure, and not the same as invoiced, because recurring
 * billing stalls and invoices sit in DRAFT. The other three look forward over
 * the next twelve months, ex-tax, and come from Forecast so the two screens
 * agree: **Active** is orders running now, **Approved** is orders agreed but
 * not yet out, and **Quoted** is counted open quotes at their stage weight
 * (sent 60%, draft or revision 40%, one version per deal).
 *
 * A type showing earned zero with money behind it is stating a real limit of
 * the data, not a bug: earnings are recognized from checkouts, completed sales
 * and elapsed recurring cycles, so an order that has done none of those yet has
 * genuinely recognized nothing.
 *
 * Every row is a link into the Orders list filtered to its own type.
 */
export async function RevenueStrip({ range }: { range: Range }) {
  const { types, earnedTotal, window } = await getRevenueByType(range);
  const byType = new Map(types.map((row) => [row.type, row]));
  const sum = (pick: (row: (typeof types)[number]) => number) =>
    types.reduce((total, row) => total + pick(row), 0);

  const columns = "grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]";
  const cell = "text-right tabular-nums";

  return (
    <section className="flex h-full min-h-0 flex-col rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex items-baseline gap-2 pb-1">
        <h2 className="text-card-title">Revenue by order type</h2>
        <span className="text-detail text-ink-muted">
          earned {window}; the rest is the next 12 months, ex-tax
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`grid ${columns} gap-x-3 px-2 pb-1 text-micro uppercase text-ink-muted`}
        >
          <span>Type</span>
          <span className="text-right">Earned</span>
          <span className="text-right">Active</span>
          <span className="text-right">Approved</span>
          <span className="text-right" title="Open quotes at their stage weight">
            Quoted ×weight
          </span>
        </div>

        {ORDER_TYPES.map((type) => {
          const row = byType.get(type);
          const quoteTitle = row?.quotedCount
            ? `${money(row.quotedUnweighted)} across ${row.quotedCount} ${
                row.quotedCount === 1 ? "quote" : "quotes"
              } before weighting`
            : "no open quotes counted";

          return (
            <Link
              key={type}
              href={`/dashboard/orders?type=${FILTER_FOR[type]}`}
              className={`grid ${columns} gap-x-3 rounded-row px-2 py-[5px] text-detail transition-colors hover:bg-row-hover`}
            >
              <span>{TYPE_LABEL[type]}</span>
              <span className={cell}>{money(row?.earned ?? 0)}</span>
              <span className={cell}>{money(row?.active ?? 0)}</span>
              <span className={cell}>{money(row?.approved ?? 0)}</span>
              <span className={`${cell} text-ink-muted`} title={quoteTitle}>
                {money(row?.quoted ?? 0)}
              </span>
            </Link>
          );
        })}

        <div
          className={`mt-1 grid ${columns} gap-x-3 border-t border-hairline px-2 pt-[5px] text-detail font-medium`}
        >
          <span>All types</span>
          <span className={cell} title={`${money(earnedTotal)} earned ${window}`}>
            {money(earnedTotal)}
          </span>
          <span className={cell}>{money(sum((row) => row.active))}</span>
          <span className={cell}>{money(sum((row) => row.approved))}</span>
          <span className={cell}>{money(sum((row) => row.quoted))}</span>
        </div>
      </div>
    </section>
  );
}

/** Matches the table's real height so the tile doesn't reflow behind it. */
export function RevenueStripSkeleton() {
  return (
    <section className="flex h-full flex-col rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="h-[17px] w-56 animate-pulse rounded-row bg-row-alt" />
      <div className="mt-2 flex flex-col gap-1">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="h-[22px] animate-pulse rounded-row bg-sunken" />
        ))}
      </div>
    </section>
  );
}
