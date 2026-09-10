import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ActionBar } from "@/components/dashboard/action-bar";
import {
  IdleItemsCard,
  TopItemsCard,
} from "@/components/dashboard/item-cards";
import {
  CardSkeleton,
  MaintenanceCard,
} from "@/components/dashboard/maintenance-card";
import { KpiRow, KpiRowSkeleton } from "@/components/overview/kpi-row";
import {
  DueBackCard,
  DueBackCardSkeleton,
} from "@/components/overview/due-back-card";
import { RangeControl } from "@/components/overview/range-control";
import { DecisionsCard, SideCardSkeleton } from "@/components/overview/side-cards";
import {
  RevenueStrip,
  RevenueStripSkeleton,
} from "@/components/orders/revenue-strip";
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
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: requested } = await searchParams;
  const range: Range = isRange(requested) ? requested : "month";

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
        <Suspense fallback={<KpiRowSkeleton />}>
          <KpiRow range={range} />
        </Suspense>

        <Suspense fallback={<RevenueStripSkeleton />}>
          <RevenueStrip range={range} />
        </Suspense>

        <div className="grid gap-3 xl:grid-cols-2">
          <Suspense fallback={<CardSkeleton rows={6} />}>
            <TopItemsCard />
          </Suspense>
          <Suspense fallback={<CardSkeleton rows={6} />}>
            <IdleItemsCard />
          </Suspense>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <Suspense fallback={<DueBackCardSkeleton />}>
            <DueBackCard />
          </Suspense>

          <div className="flex flex-col gap-3">
            <Suspense fallback={<CardSkeleton rows={4} />}>
              <MaintenanceCard />
            </Suspense>
            <Suspense fallback={<SideCardSkeleton />}>
              <DecisionsCard />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
