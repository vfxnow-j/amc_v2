import { Suspense } from "react";
import Link from "next/link";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  OrderTable,
  OrderTableSkeleton,
} from "@/components/orders/order-table";
import {
  RevenueStrip,
  RevenueStripSkeleton,
} from "@/components/orders/revenue-strip";
import { RangeControl } from "@/components/overview/range-control";
import { PageHeader } from "@/components/shell/page-header";
import { moneyCompact } from "@/lib/format";
import {
  TYPE_FILTERS,
  TYPE_FILTER_LABEL,
  isTypeFilter,
  type TypeFilter,
} from "@/lib/orders/types";
import { isRange, type Range } from "@/lib/queries/range";
import {
  getReservationHeaderStats,
  getViewCounts,
} from "@/lib/queries/reservations";
import { VIEWS, VIEW_LABEL, isView, type View } from "@/lib/reservations/views";

export const metadata = { title: "Orders" };

async function HeaderBlurb() {
  const { open, booked } = await getReservationHeaderStats();
  return (
    <>
      {open} open {open === 1 ? "order" : "orders"} · {moneyCompact(booked)}{" "}
      booked
    </>
  );
}

async function ViewTabs({
  view,
  type,
  search,
}: {
  view: View;
  type: TypeFilter;
  search: string;
}) {
  // Counted through the same filter the table uses, so switching type doesn't
  // leave the tabs promising rows the table won't show.
  const counts = await getViewCounts(search, type);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="open"
      label="Order stages"
      options={VIEWS.map((option) => ({
        value: option,
        label: VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

/**
 * Operate → Orders: the hub the whole app orbits, and now the only one.
 *
 * This screen replaces three. Reservations, Sales and Rent-to-own were never
 * three things — `Reservation.reservationType` has carried all four kinds since
 * v1, and splitting them across screens meant a client's rental and their sale
 * were in different places, the same order had two records, and nobody could
 * see what the business earned without adding up three tabs by hand.
 *
 * Two filter axes, and they compose: **stage** (open, out now, quotes, archive)
 * and **type** (rental, sale, rent-to-own, cloud). Both live in the URL, so the
 * server does the filtering and any reading is shareable. Leases are not here —
 * a lease is money owed to a lender for hardware the business bought, with no
 * client and no lines, and it keeps its own screen.
 *
 * Four independent Suspense boundaries. The revenue strip runs an accrual
 * calculation over every recurring order and must never hold up the table.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    type?: string;
    q?: string;
    page?: string;
    range?: string;
  }>;
}) {
  const params = await searchParams;
  const view: View = isView(params.view) ? params.view : "open";
  const type: TypeFilter = isTypeFilter(params.type) ? params.type : "all";
  const range: Range = isRange(params.range) ? params.range : "month";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Orders"
        blurb={
          <Suspense fallback="Counting open orders…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <>
            <RangeControl range={range} />
            <Link
              href="/dashboard/orders/new"
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid"
            >
              New order
            </Link>
          </>
        }
      />

      <Suspense fallback={<RevenueStripSkeleton />}>
        <RevenueStrip range={range} />
      </Suspense>

      <div className="flex flex-wrap items-center gap-2">
        <Suspense fallback={<FilterTabsSkeleton width={360} />}>
          <ViewTabs view={view} type={type} search={search} />
        </Suspense>

        <FilterTabs
          param="type"
          value={type}
          fallback="all"
          label="Order types"
          options={TYPE_FILTERS.map((option) => ({
            value: option,
            label: TYPE_FILTER_LABEL[option],
          }))}
        />

        <span className="ml-auto">
          <ListSearch placeholder="Search orders" />
        </span>
      </div>

      <Suspense
        key={`${view}:${type}:${search}:${page}`}
        fallback={<OrderTableSkeleton />}
      >
        <OrderTable view={view} type={type} search={search} page={page} />
      </Suspense>
    </>
  );
}
