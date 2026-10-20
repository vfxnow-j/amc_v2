import Link from "next/link";
import { totalLine, typeLine } from "@/lib/dashboard/type-totals";
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
 * list is split by: one table, one row per type, plus a Total row.
 *
 * **Revenue** is accrual-basis revenue recognized inside the window (the real
 * "revenue stream" figure; not the same as invoiced). **Quoted** is counted
 * open quotes at their stage weight (sent 60%, draft or revision 40%, one
 * version per deal), ex-tax, from Forecast so the two screens agree; a week or
 * a day is the month's figure pro-rated by days. **Potential** is revenue plus
 * quoted. The Total row sums every type in whole cents (lib/dashboard/type-totals).
 *
 * A type showing earned zero with money behind it is a real limit of the data:
 * earnings are recognized from checkouts, completed sales and elapsed
 * recurring cycles.
 *
 * Every type row links into the Orders list filtered to that type.
 */
export async function RevenueStrip({ range }: { range: Range }) {
  const { types, window } = await getRevenueByType(range);
  const byType = new Map(types.map((row) => [row.type, row]));
  const total = totalLine(types);

  const columns = "grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]";
  const cell = "text-right tabular-nums";

  return (
    <section className="flex h-full min-h-0 flex-col rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 pb-1">
        <h2 className="text-card-title">Revenue by order type</h2>
        <span className="text-detail text-ink-muted">{window}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`grid ${columns} gap-x-3 px-2 pb-1 text-micro uppercase text-ink-muted`}
        >
          <span>Type</span>
          <span className="text-right">Revenue</span>
          <span className="text-right" title="Open quotes at their stage weight">
            Quoted
          </span>
          <span className="text-right" title="Revenue plus weighted quoted">
            Potential
          </span>
        </div>

        {ORDER_TYPES.map((type) => {
          const row = byType.get(type);
          const line = typeLine(row);
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
              <span className="truncate">{TYPE_LABEL[type]}</span>
              <span className={cell}>{money(line.earned)}</span>
              <span className={`${cell} text-ink-muted`} title={quoteTitle}>
                {money(line.quoted)}
              </span>
              <span className={cell}>{money(line.potential)}</span>
            </Link>
          );
        })}

        <div
          className={`mt-1 grid ${columns} gap-x-3 rounded-row border-t border-hairline bg-sunken px-2 py-[5px] text-detail font-semibold`}
        >
          <span>Total</span>
          <span className={cell}>{money(total.earned)}</span>
          <span className={cell}>{money(total.quoted)}</span>
          <span className={cell}>{money(total.potential)}</span>
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
