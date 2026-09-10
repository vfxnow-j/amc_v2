import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ActionBar } from "@/components/dashboard/action-bar";
import { renderTile } from "@/components/dashboard/tiles/registry";
import { RangeControl } from "@/components/overview/range-control";
import { moneyCompact } from "@/lib/format";
import { getHeaderStats } from "@/lib/queries/overview";
import { isRange, type Range } from "@/lib/queries/range";

export const metadata = { title: "Dashboard" };

async function HeaderBlurb() {
  const { openOrders, booked } = await getHeaderStats();
  return (
    <>
      {openOrders} open {openOrders === 1 ? "order" : "orders"} ·{" "}
      {moneyCompact(booked)} booked
    </>
  );
}

/**
 * The Dashboard: the whole business on one screen, pinned at the top of the
 * rail so it is one click from anywhere.
 *
 * It was Insight → Overview, and it answered two of the questions an owner
 * actually has — how are we trading, and what needs hands today. The other
 * three were spread across the rail: which hardware earns, which hardware is
 * dead weight, and what is broken. Those are not reporting questions you go
 * looking for once a month; they are the ones you want answered while you are
 * looking at everything else.
 *
 * Reading order is deliberate, top to bottom: how we are trading (KPIs), where
 * that money comes from (revenue by order type), what the fleet is doing
 * (earning most / never booked), and what needs a person (due back, in service,
 * decisions).
 *
 * Every card has its own Suspense boundary. The revenue strip runs an accrual
 * calculation across every recurring order and the fleet cards group the whole
 * order book — none of them may hold up the KPIs, and none of them holds up
 * each other.
 *
 * The cards are no longer named here. Each one is a tile id resolved through
 * `components/dashboard/tiles/registry`, which owns the boundary as well as
 * the component; the layout below is still hand-written, and stays that way
 * until stored layouts land. That indirection is the whole point of the
 * split — this page will shortly read a list of ids off a `DashboardLayout`
 * row instead of spelling seven of them out, and nothing else has to change
 * for it to.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: requested } = await searchParams;
  const range: Range = isRange(requested) ? requested : "month";
  const context = { range };

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="The business today"
        blurb={
          <Suspense fallback="Counting open orders…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<RangeControl range={range} />}
      />

      <ActionBar />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {renderTile("kpis", context)}
        {renderTile("revenue-by-type", context)}

        <div className="grid gap-3 xl:grid-cols-2">
          {renderTile("top-items", context)}
          {renderTile("idle-items", context)}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          {renderTile("due-back", context)}

          <div className="flex flex-col gap-3">
            {renderTile("maintenance", context)}
            {renderTile("decisions", context)}
          </div>
        </div>
      </div>
    </>
  );
}
