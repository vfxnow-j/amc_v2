import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, money, moneyCompact } from "@/lib/format";
import {
  PO_STATUS_LABEL,
  PO_VIEWS,
  PO_VIEW_LABEL,
  isPOView,
  type POView,
} from "@/lib/accounting/labels";
import {
  getPOHeaderStats,
  getPOViewCounts,
  getPurchaseOrders,
} from "@/lib/queries/accounting";

export const metadata = { title: "Purchase orders" };

/** PO · Vendor · Ship to · Ordered · Expected · Received · Total · State */
const COLUMNS: Column[] = [
  { key: "number", label: "PO", width: "120px" },
  { key: "vendor", label: "Vendor", width: "minmax(0,1.2fr)" },
  { key: "shipTo", label: "Ship to", width: "minmax(0,1fr)" },
  { key: "expected", label: "Expected", width: "92px" },
  { key: "received", label: "Received", width: "88px", align: "right" },
  { key: "total", label: "Total", width: "96px", align: "right" },
  { key: "status", label: "State", width: "112px" },
];

const EMPTY: Record<POView, React.ReactNode> = {
  open: (
    <>
      Nothing is on order. A submitted PO sits here until its lines are
      received — that&rsquo;s what turns bought hardware into units.
    </>
  ),
  received: <>Nothing has been received yet.</>,
  draft: <>No drafts. Raise a PO against a vendor to start one.</>,
  all: <>No purchase orders exist yet.</>,
};

async function HeaderBlurb() {
  const { openCount, openValue } = await getPOHeaderStats();
  return openCount === 0 ? (
    <>Nothing on order</>
  ) : (
    <>
      {openCount} on order · {moneyCompact(openValue)} committed
    </>
  );
}

async function Tabs({ view, search }: { view: POView; search: string }) {
  const counts = await getPOViewCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="open"
      label="Purchase order views"
      options={PO_VIEWS.map((option) => ({
        value: option,
        label: PO_VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function Table({
  view,
  search,
  page,
}: {
  view: POView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getPurchaseOrders({
    view,
    search,
    page,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "open") params.set("view", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query
      ? `/dashboard/purchase-orders?${query}`
      : "/dashboard/purchase-orders";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        search ? (
          <>
            No purchase order in {PO_VIEW_LABEL[view]} matches &ldquo;{search}
            &rdquo;.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/purchase-orders/${row.id}`,
        cells: {
          number: <span className="font-bold tabular-nums">{row.poNumber}</span>,
          vendor: row.vendorName,
          shipTo: <span className="text-ink-muted">{row.shipTo ?? "—"}</span>,
          expected: (
            <span className="tabular-nums text-ink-muted">
              {row.expectedDate ? dayYear(row.expectedDate) : "—"}
            </span>
          ),
          // Partial receipts are the reason this list exists — show the split,
          // not a bare "received" flag.
          received: (
            <span className="text-ink-muted">
              {row.ordered === 0
                ? "—"
                : `${row.received}/${row.ordered}`}
            </span>
          ),
          total: money(row.total),
          status: (
            <span className="text-ink-muted">{PO_STATUS_LABEL[row.status]}</span>
          ),
        },
      }))}
    />
  );
}

/**
 * Revenue → Purchase orders.
 *
 * The received column shows units received against units ordered rather than a
 * flag, because PARTIAL is the state that actually needs attention: a PO half
 * received has hardware sitting somewhere that isn't yet bookable stock.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: POView = isPOView(params.view) ? params.view : "open";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Purchase orders"
        blurb={
          <Suspense fallback="Totalling what's on order…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search PO number, vendor" />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={320} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
