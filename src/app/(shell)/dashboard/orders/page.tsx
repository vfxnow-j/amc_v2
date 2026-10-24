import { Suspense } from "react";
import Link from "next/link";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  OrderTable,
  OrderTableSkeleton,
} from "@/components/orders/order-table";
import { PageHeader } from "@/components/shell/page-header";
import { requireAuth } from "@/lib/auth-utils";
import {
  FLAG_FILTERS,
  FLAG_FILTER_LABEL,
  isFlagFilter,
  type FlagFilter,
} from "@/lib/flags/filter";
import { moneyCompact } from "@/lib/format";
import {
  TYPE_FILTERS,
  TYPE_FILTER_LABEL,
  isTypeFilter,
  type TypeFilter,
} from "@/lib/orders/types";
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
  flag,
  userId,
}: {
  view: View;
  type: TypeFilter;
  search: string;
  flag: FlagFilter;
  userId: string | null;
}) {
  // Counted through the same filter the table uses, so switching type doesn't
  // leave the tabs promising rows the table won't show.
  const counts = await getViewCounts(search, type, flag, userId);
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
 * Just the orders: revenue by type and how it arrives live in Forecast and on
 * the Dashboard tiles, not here. The header count and the table each sit in
 * their own Suspense boundary so neither holds up the other.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    type?: string;
    flag?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const view: View = isView(params.view) ? params.view : "open";
  const type: TypeFilter = isTypeFilter(params.type) ? params.type : "all";
  const flag: FlagFilter = isFlagFilter(params.flag) ? params.flag : "all";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const session = await requireAuth();
  const userId = session.authorized ? (session.userId ?? null) : null;

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
            <Link
              href="/dashboard/orders/new"
              className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid"
            >
              New order
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Suspense fallback={<FilterTabsSkeleton width={360} />}>
          <ViewTabs view={view} type={type} search={search} flag={flag} userId={userId} />
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

        <FilterTabs
          param="flag"
          value={flag}
          fallback="all"
          label="Flags"
          options={FLAG_FILTERS.map((option) => ({
            value: option,
            label: FLAG_FILTER_LABEL[option],
          }))}
        />

        <span className="ml-auto">
          <ListSearch placeholder="Search orders" />
        </span>
      </div>

      <Suspense
        key={`${view}:${type}:${flag}:${search}:${page}`}
        fallback={<OrderTableSkeleton />}
      >
        <OrderTable view={view} type={type} flag={flag} userId={userId} search={search} page={page} />
      </Suspense>
    </>
  );
}
