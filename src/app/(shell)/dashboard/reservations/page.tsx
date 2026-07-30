import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { ListSearch } from "@/components/reservations/list-search";
import {
  ReservationTable,
  ReservationTableSkeleton,
} from "@/components/reservations/reservation-table";
import { ViewTabs } from "@/components/reservations/view-tabs";
import {
  getReservationHeaderStats,
  getViewCounts,
} from "@/lib/queries/reservations";
import { isView, type View } from "@/lib/reservations/views";

export const metadata = { title: "Reservations" };

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

async function HeaderBlurb() {
  const { open, booked } = await getReservationHeaderStats();
  return (
    <>
      {open} open {open === 1 ? "order" : "orders"} · {MONEY.format(booked)}{" "}
      booked
    </>
  );
}

async function Tabs({ view, search }: { view: View; search: string }) {
  const counts = await getViewCounts(search);
  return <ViewTabs view={view} counts={counts} />;
}

/**
 * Operate → Reservations: the hub the whole app orbits.
 *
 * View, search and page all live in the URL, so the server does the filtering
 * and a reading is shareable. The tabs stream separately from the table — they
 * answer "where is there work", which shouldn't wait on a page of rows.
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: View = isView(params.view) ? params.view : "open";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Reservations"
        blurb={
          <Suspense fallback="Counting open orders…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <>
            <ListSearch />
            <Link
              href="/dashboard/reservations/new"
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              New order
            </Link>
          </>
        }
      />

      <div className="flex items-center gap-3">
        <Suspense
          fallback={
            <div className="h-[30px] w-[420px] animate-pulse rounded-pill bg-segmented-track" />
          }
        >
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense
        key={`${view}:${search}:${page}`}
        fallback={<ReservationTableSkeleton />}
      >
        <ReservationTable view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
