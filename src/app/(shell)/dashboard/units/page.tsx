import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import {
  UNIT_STATUS_LABEL,
  UNIT_VIEWS,
  UNIT_VIEW_LABEL,
  isUnitView,
  type UnitView,
} from "@/lib/inventory/labels";
import { getUnitList, getUnitViewCounts } from "@/lib/queries/inventory";

export const metadata = { title: "Units" };

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Unit · Asset · Serial · Status · Location · With · Revenue */
const COLUMNS: Column[] = [
  { key: "barcode", label: "Unit", width: "128px" },
  { key: "asset", label: "Asset", width: "minmax(0,1.3fr)" },
  { key: "serial", label: "Serial", width: "132px" },
  { key: "status", label: "Status", width: "92px" },
  { key: "location", label: "Location", width: "minmax(0,1fr)" },
  { key: "holder", label: "With", width: "minmax(0,1fr)" },
  { key: "revenue", label: "Revenue", width: "88px", align: "right" },
];

const EMPTY: Record<UnitView, React.ReactNode> = {
  "in-fleet": (
    <>
      No units are in the fleet. Register an asset and add serialized units to
      it — units are what actually get booked and scanned.
    </>
  ),
  available: (
    <>
      Nothing is free right now. Every unit in the fleet is out, reserved or in
      service.
    </>
  ),
  out: <>Nothing is with a client. Every unit is on the shelf.</>,
  service: (
    <>
      No unit is in service. Units land here while a work order is open against
      them.
    </>
  ),
  gone: <>Nothing has been retired or sold.</>,
  all: <>There are no units at all yet.</>,
};

async function Tabs({ view, search }: { view: UnitView; search: string }) {
  const counts = await getUnitViewCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="in-fleet"
      label="Unit views"
      options={UNIT_VIEWS.map((option) => ({
        value: option,
        label: UNIT_VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function HeaderBlurb() {
  const counts = await getUnitViewCounts();
  return (
    <>
      {counts["in-fleet"]} in fleet · {counts.available} free · {counts.out} out
    </>
  );
}

async function Table({
  view,
  search,
  page,
}: {
  view: UnitView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getUnitList({ view, search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "in-fleet") params.set("view", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/units?${query}` : "/dashboard/units";
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
            No unit in {UNIT_VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;.
            Try a barcode, a serial, or switch to All.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/units/${row.id}`,
        cells: {
          barcode: (
            <span className="font-bold tabular-nums">{row.barcode}</span>
          ),
          asset: row.assetName,
          serial: (
            <span className="tabular-nums text-ink-muted">
              {row.serialNumber ?? "—"}
            </span>
          ),
          status: (
            <span className="text-ink-muted">
              {UNIT_STATUS_LABEL[row.status]}
            </span>
          ),
          location: (
            <span className="text-ink-muted">{row.locationName ?? "—"}</span>
          ),
          // Custody comes from the open checkout, not from the status column —
          // those two can disagree, and this one is the physical record.
          holder: row.holder ? (
            row.holder
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          revenue: row.revenue
            ? MONEY.format(row.revenue)
            : <span className="text-ink-faint">—</span>,
        },
      }))}
    />
  );
}

/**
 * Inventory → Units: new in v2.
 *
 * v1 could only reach a serialized unit through its asset
 * (`/dashboard/assets/[id]/units`), which makes "where is barcode 10423" and
 * "what is in service right now" unanswerable without knowing the asset first.
 * This is the flat list those questions need.
 */
export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: UnitView = isUnitView(params.view) ? params.view : "in-fleet";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Units"
        blurb={
          <Suspense fallback="Counting units…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search barcode, serial, asset" />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={420} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
