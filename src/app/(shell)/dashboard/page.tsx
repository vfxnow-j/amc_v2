import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { KpiRow, KpiRowSkeleton } from "@/components/overview/kpi-row";
import {
  DueBackCard,
  DueBackCardSkeleton,
} from "@/components/overview/due-back-card";
import { RangeControl } from "@/components/overview/range-control";
import {
  DecisionsCard,
  ServiceCenterCard,
  SideCardSkeleton,
} from "@/components/overview/side-cards";
import { getHeaderStats } from "@/lib/queries/overview";
import { isRange, type Range } from "@/lib/queries/range";

export const metadata = { title: "Overview" };

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

async function HeaderBlurb() {
  const { openOrders, booked } = await getHeaderStats();
  return (
    <>
      {openOrders} open {openOrders === 1 ? "order" : "orders"} ·{" "}
      {MONEY.format(booked)} booked
    </>
  );
}

/**
 * Insight → Overview: the owner's morning read on top, the warehouse lead's
 * "what needs hands today" underneath.
 *
 * Each card has its own Suspense boundary, so the KPI aggregates never hold up
 * the work queues — the slowest query delays only its own card.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: requested } = await searchParams;
  const range: Range = isRange(requested) ? requested : "month";

  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Overview"
        blurb={
          <Suspense fallback="Counting open orders…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <>
            <RangeControl range={range} />
            <Link
              href="/dashboard/reservations/new"
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid"
            >
              New reservation
            </Link>
          </>
        }
      />

      <Suspense fallback={<KpiRowSkeleton />}>
        <KpiRow range={range} />
      </Suspense>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Suspense fallback={<DueBackCardSkeleton />}>
          <DueBackCard />
        </Suspense>

        <div className="flex flex-col gap-3">
          <ServiceCenterCard />
          <Suspense fallback={<SideCardSkeleton />}>
            <DecisionsCard />
          </Suspense>
        </div>
      </div>
    </>
  );
}
