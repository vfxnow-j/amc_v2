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
  CLOUD: "cloud",
};

/**
 * Operate → Orders: where the money came from, split by the same types the
 * list is split by.
 *
 * Two figures per card, kept apart on purpose. **Earned** is accrual-basis
 * revenue recognised inside the window — the real "revenue stream" figure, and
 * not the same as invoiced, because recurring billing stalls and invoices sit
 * in DRAFT. **Open** is the value of orders of that type running right now:
 * future money, and the reason a type can earn nothing this month and still
 * matter.
 *
 * Every card is a link into the list filtered to its own type, so the strip is
 * navigation as well as a reading — a number you can't get behind is a poster,
 * not a dashboard.
 *
 * A card showing earned zero with orders open is stating a real limit of the
 * data, not a bug: earnings are recognised from checkouts, completed sales and
 * elapsed recurring cycles, so a rent-to-own or cloud order that has done none
 * of those yet has genuinely recognised nothing.
 */
export async function RevenueStrip({ range }: { range: Range }) {
  const { types, earnedTotal, window } = await getRevenueByType(range);
  const byType = new Map(types.map((row) => [row.type, row]));

  return (
    <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="flex items-baseline gap-2 pb-2">
        <h2 className="text-card-title">Revenue by order type</h2>
        <span className="text-detail text-ink-muted">
          earned {window} · {money(earnedTotal)} across all types
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER_TYPES.map((type) => {
          const row = byType.get(type);
          const earned = row?.earned ?? 0;
          const share =
            earnedTotal > 0 ? Math.round((earned / earnedTotal) * 100) : null;

          return (
            <Link
              key={type}
              href={`/dashboard/orders?type=${FILTER_FOR[type]}`}
              className="flex flex-col rounded-bubble bg-sunken p-3 transition-colors hover:bg-row-hover"
            >
              <span className="flex items-baseline gap-2">
                <span className="text-micro uppercase text-ink-muted">
                  {TYPE_LABEL[type]}
                </span>
                {share === null ? null : (
                  <span className="ml-auto text-detail text-ink-faint">
                    {share}%
                  </span>
                )}
              </span>
              <span className="mt-1 text-kpi">{money(earned)}</span>
              <span className="mt-1 text-detail text-ink-muted">
                {row && row.openCount > 0 ? (
                  <>
                    {money(row.booked)} open across {row.openCount}{" "}
                    {row.openCount === 1 ? "order" : "orders"}
                  </>
                ) : (
                  "nothing open"
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Matches the strip's real height so the page doesn't reflow behind it. */
export function RevenueStripSkeleton() {
  return (
    <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
      <div className="h-[17px] w-56 animate-pulse rounded-row bg-row-alt" />
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-[92px] animate-pulse rounded-bubble bg-sunken"
          />
        ))}
      </div>
    </section>
  );
}
