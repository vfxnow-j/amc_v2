import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { dayYear, money, moneyCompact } from "@/lib/format";
import { oneOf } from "@/lib/guards";
import { getInventoryReport } from "@/lib/queries/reports";

export const metadata = { title: "Inventory" };

const PAGE_SIZE = 40;

const VIEWS = ["fleet", "retired", "all"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  fleet: "In fleet",
  retired: "Retired",
  all: "Both",
};

const isView = oneOf(VIEWS);

/** Unit · Asset · Cost · Book value · Depreciated · Earned · Where */
const COLUMNS: Column[] = [
  { key: "unit", label: "Unit", width: "112px" },
  { key: "asset", label: "Asset", width: "minmax(0,1.5fr)" },
  { key: "category", label: "Category", width: "minmax(0,0.7fr)" },
  { key: "cost", label: "Cost", width: "88px", align: "right" },
  { key: "book", label: "Book value", width: "96px", align: "right" },
  { key: "depreciated", label: "Written off", width: "96px", align: "right" },
  { key: "earned", label: "Earned", width: "92px", align: "right" },
  { key: "where", label: "Where", width: "minmax(0,0.8fr)" },
];

/**
 * Reports → Inventory.
 *
 * The financial view of the fleet: what each unit cost, what it is worth on the
 * books today after depreciation, and what it has earned back. Book value is
 * computed per unit from its purchase date and its asset's depreciation method
 * and useful life — the schema carries no running book value, so it is derived
 * on read and will move as the date does.
 *
 * Retired units get their own view rather than a row tint. They are the only
 * ones that carry a disposal reason and a date, and the financial summary
 * excludes them on purpose — hardware that has left the business is not part of
 * what the business is holding.
 *
 * Paginated, unlike the stock count. Two thousand units is a ledger to search,
 * not a sheet to walk, and the summary above is what anybody actually reads.
 */
export default async function InventoryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: View = isView(params.view) ? params.view : "fleet";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Inventory"
        blurb="What the hardware cost, what it is worth now, and what it has earned back. Sold units are not in it — their book value left with them."
        actions={<BackToReports />}
      />

      <Suspense fallback={<div className="h-[86px] animate-pulse rounded-card bg-panel" />}>
        <Summary />
      </Suspense>

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={260} />}>
          <Tabs view={view} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} page={page} />
      </Suspense>
    </>
  );
}

async function Summary() {
  const { summary } = await getInventoryReport();

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Cost of the fleet"
        value={moneyCompact(summary.totalPurchaseValue)}
        meta={`${summary.totalUnits - summary.unitsRetired} units, retired excluded`}
      />
      <Kpi
        label="Book value now"
        value={moneyCompact(summary.totalCurrentBookValue)}
        meta={`${moneyCompact(summary.totalAccumulatedDepreciation)} written off`}
      />
      <Kpi
        label="Earned to date"
        value={moneyCompact(summary.totalRevenue)}
        // AssetUnit.maintenanceCost is a denormalised total that nothing in the
        // restored data ever wrote to, so a "$0.00 spent" reads as a fault
        // rather than as an empty column. Say which it is.
        meta={
          summary.totalMaintenanceCost > 0
            ? `${moneyCompact(summary.totalMaintenanceCost)} spent keeping it running`
            : "no maintenance cost recorded on any unit"
        }
      />
      <Kpi
        label="Out with clients"
        value={moneyCompact(summary.valueOut)}
        meta={`${summary.unitsOut} units · ${moneyCompact(summary.valueIn)} on the shelf`}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-card bg-panel px-[14px] py-3 shadow-sm">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p className="text-kpi mt-1">{value}</p>
      <p className="mt-1 inline-block rounded-pill bg-sunken px-2 py-px text-pill text-ink-muted">
        {meta}
      </p>
    </div>
  );
}

async function Tabs({ view }: { view: View }) {
  const { summary } = await getInventoryReport();
  const fleet = summary.totalUnits - summary.unitsRetired;

  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="fleet"
      label="Inventory views"
      options={[
        { value: "fleet", label: VIEW_LABEL.fleet, count: fleet },
        { value: "retired", label: VIEW_LABEL.retired, count: summary.unitsRetired },
        { value: "all", label: VIEW_LABEL.all, count: summary.totalUnits },
      ]}
    />
  );
}

async function Table({ view, page }: { view: View; page: number }) {
  const { items } = await getInventoryReport();

  const filtered =
    view === "all"
      ? items
      : view === "retired"
        ? items.filter((item) => item.status === "RETIRED")
        : items.filter((item) => item.status !== "RETIRED");

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function hrefFor(next: number) {
    const query = new URLSearchParams();
    if (view !== "fleet") query.set("view", view);
    if (next > 1) query.set("page", String(next));
    const search = query.toString();
    return search
      ? `/dashboard/reports/inventory?${search}`
      : "/dashboard/reports/inventory";
  }

  const noCost = rows.filter((item) => item.purchasePrice === 0).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={filtered.length}
      page={page}
      pageSize={PAGE_SIZE}
      pagination={{ page, pages, hrefFor }}
      empty={
        view === "retired" ? (
          <>
            Nothing has been retired. Units leave the fleet from the unit record,
            and land here with their disposal reason.
          </>
        ) : (
          <>
            No units in the fleet. Register hardware from Inventory → Assets.
          </>
        )
      }
      footerNote={
        noCost > 0 ? (
          <>
            {noCost} on this page carry no purchase price, so they can&rsquo;t be
            depreciated
          </>
        ) : undefined
      }
      rows={rows.map((item) => ({
        id: item.barcode,
        href: `/dashboard/units?q=${item.barcode}`,
        cells: {
          unit: (
            <span className="font-bold tabular-nums">{item.barcode}</span>
          ),
          asset: <span className="truncate">{item.assetName}</span>,
          category: (
            <span className="truncate text-ink-muted">{item.category}</span>
          ),
          cost:
            item.purchasePrice === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(item.purchasePrice)
            ),
          book:
            item.purchasePrice === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(item.currentBookValue)
            ),
          depreciated:
            item.purchasePrice === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <span className="text-ink-muted">
                {money(item.accumulatedDepreciation)}
              </span>
            ),
          earned:
            item.totalRevenue === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(item.totalRevenue)
            ),
          where:
            item.status === "RETIRED" ? (
              <span className="truncate text-ink-muted">
                {item.retiredTo ?? item.retirementReason ?? "Retired"}
                {item.retiredAt ? ` · ${dayYear(new Date(item.retiredAt))}` : ""}
              </span>
            ) : (
              <span className="truncate text-ink-muted">
                {item.location || "Unlocated"}
              </span>
            ),
        },
      }))}
    />
  );
}
