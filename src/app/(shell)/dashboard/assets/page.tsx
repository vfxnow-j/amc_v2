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
  ASSET_VIEWS,
  ASSET_VIEW_LABEL,
  isAssetView,
  type AssetView,
} from "@/lib/inventory/labels";
import {
  getAssetHeaderStats,
  getAssetList,
  getAssetViewCounts,
} from "@/lib/queries/inventory";

export const metadata = { title: "Assets" };

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Asset · Category · Make & model · Fleet · Available · Day rate */
const COLUMNS: Column[] = [
  { key: "name", label: "Asset", width: "minmax(0,1.4fr)" },
  { key: "category", label: "Category", width: "150px" },
  { key: "maker", label: "Make & model", width: "minmax(0,1fr)" },
  { key: "units", label: "Fleet", width: "60px", align: "right" },
  { key: "available", label: "Free", width: "60px", align: "right" },
  { key: "rate", label: "Day rate", width: "88px", align: "right" },
];

const EMPTY: Record<AssetView, React.ReactNode> = {
  active: <>No assets are in service. Register one to start a fleet.</>,
  retired: (
    <>
      Nothing has been retired. Assets land here when they&rsquo;re sold,
      recycled or written off — the units stay on the record either way.
    </>
  ),
  all: <>There are no assets at all yet. Register the first one.</>,
};

async function HeaderBlurb() {
  const { active, fleet } = await getAssetHeaderStats();
  return (
    <>
      {active} active {active === 1 ? "asset" : "assets"} · {fleet} units in
      fleet
    </>
  );
}

async function Tabs({ view, search }: { view: AssetView; search: string }) {
  const counts = await getAssetViewCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="active"
      label="Asset views"
      options={ASSET_VIEWS.map((option) => ({
        value: option,
        label: ASSET_VIEW_LABEL[option],
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
  view: AssetView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getAssetList({ view, search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "active") params.set("view", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/assets?${query}` : "/dashboard/assets";
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
            No asset in {ASSET_VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;.
            Try a different term, or switch to All.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/assets/${row.id}`,
        cells: {
          name: <span className="font-bold">{row.name}</span>,
          category: <span className="text-ink-muted">{row.categoryName}</span>,
          maker: (
            <span className="text-ink-muted">{row.maker ?? "—"}</span>
          ),
          units: <span className="text-ink-muted">{row.units || "—"}</span>,
          available:
            // Nothing free is worth seeing at a glance on a list whose whole
            // job is answering "can I promise this to someone".
            row.units === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : row.available === 0 ? (
              <span className="font-bold text-accent-text">0</span>
            ) : (
              <span>{row.available}</span>
            ),
          rate:
            row.dailyRate === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              MONEY.format(row.dailyRate)
            ),
        },
      }))}
    />
  );
}

/**
 * Inventory → Assets: the product types, not the physical units.
 *
 * Absorbs two v1 siblings — `assets/retired` becomes the Retired tab, and
 * `assets/register` becomes the action in the header. "Free" counts units whose
 * status is AVAILABLE, the one bookable definition
 * (`lib/inventory/availability.ts`); "Fleet" excludes retired and sold, so it
 * does not agree with the denormalized `totalQuantity` column and shouldn't.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: AssetView = isAssetView(params.view) ? params.view : "active";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Assets"
        blurb={
          <Suspense fallback="Counting the fleet…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search assets, makes, categories" />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={260} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
