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
import { getFamilyList, getUngroupedCount } from "@/lib/queries/families";
import { money } from "@/lib/format";
import Link from "next/link";

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

/** Asset · Models · Category · Fleet · Free · Out · Rates */
const FAMILY_COLUMNS: Column[] = [
  { key: "name", label: "Asset", width: "minmax(0,1.5fr)" },
  { key: "models", label: "Models", width: "70px", align: "right" },
  { key: "category", label: "Category", width: "150px" },
  { key: "fleet", label: "Fleet", width: "60px", align: "right" },
  { key: "available", label: "Free", width: "60px", align: "right" },
  { key: "out", label: "Out", width: "56px", align: "right" },
  { key: "rate", label: "Rates", width: "132px", align: "right" },
];

/**
 * The whole point of the family tier: one row per thing you shop for, with the
 * stock already added up. "How many Mac Studios are free" is a number here
 * rather than four rows and some arithmetic.
 */
async function FamilyTable({
  search,
  page,
}: {
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getFamilyList({ search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/assets?${query}` : "/dashboard/assets";
  }

  return (
    <ListTable
      columns={FAMILY_COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        search ? (
          <>
            No asset matches &ldquo;{search}&rdquo;. Every model is still on the
            Models tab, grouped or not.
          </>
        ) : (
          <>
            Nothing is grouped yet. Models stand on their own until you put them
            together —{" "}
            <Link
              href="/dashboard/assets/grouping"
              className="text-accent-text hover:underline"
            >
              review the suggested groupings
            </Link>{" "}
            to start.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/assets/family/${row.id}`,
        cells: {
          name: <span className="truncate font-bold">{row.name}</span>,
          models: (
            <span className="text-ink-muted">
              {row.models}
              {row.retiredModels > 0 ? (
                <span className="text-ink-faint"> ({row.retiredModels}r)</span>
              ) : null}
            </span>
          ),
          category: (
            <span className="truncate text-ink-muted">
              {row.categoryNames.join(", ") || "—"}
            </span>
          ),
          fleet: (
            <span className="text-ink-muted">{row.stock.fleet || "—"}</span>
          ),
          available:
            row.stock.fleet === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : row.stock.available === 0 ? (
              <span className="font-bold text-accent-text">0</span>
            ) : (
              <span className="font-bold">{row.stock.available}</span>
            ),
          out: <span className="text-ink-muted">{row.stock.out || "—"}</span>,
          rate: (
            <span className="text-ink-muted">
              {row.daily
                ? row.daily.min === row.daily.max
                  ? `${money(row.daily.min)}/d`
                  : `${money(row.daily.min)}–${money(row.daily.max)}/d`
                : row.monthly
                  ? row.monthly.min === row.monthly.max
                    ? `${money(row.monthly.min)}/mo`
                    : `${money(row.monthly.min)}–${money(row.monthly.max)}/mo`
                  : "—"}
            </span>
          ),
        },
      }))}
    />
  );
}

/** The prompt to group, shown only while there is something to group. */
async function GroupingPrompt() {
  const ungrouped = await getUngroupedCount();
  if (ungrouped === 0) return null;
  return (
    <Link
      href="/dashboard/assets/grouping"
      className="rounded-pill bg-accent-tint px-3 py-1 text-pill text-accent-on-tint transition-colors hover:bg-accent-tint-strong"
    >
      {ungrouped} models not grouped →
    </Link>
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
 * Inventory → Assets: two levels of the fleet on one screen.
 *
 * **Assets** are what you shop for — Mac Studio, RTX 5090 — with stock summed
 * across every model of them. **Models** is the priced product type, which is
 * what this screen used to be and still is on its own tab, so nothing that
 * linked here has lost its list. Units are a screen of their own.
 *
 * Search spans both: on Assets it matches a family name *or* any model name
 * inside one, so looking for "5090" finds the asset even though no family is
 * called that.
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
  searchParams: Promise<{
    tab?: string;
    view?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "models" ? "models" : "assets";
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
        actions={
          <>
            <Suspense fallback={null}>
              <GroupingPrompt />
            </Suspense>
            <ListSearch placeholder="Search assets, models, categories" />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs
          param="tab"
          value={tab}
          fallback="assets"
          label="Fleet levels"
          options={[
            { value: "assets", label: "Assets" },
            { value: "models", label: "Models" },
          ]}
        />
        {/* Active / Retired / All belongs to models; a family is retired only
            in the sense that all of its models are, which is a different
            question and not one this strip can answer. */}
        {tab === "models" ? (
          <Suspense fallback={<FilterTabsSkeleton width={260} />}>
            <Tabs view={view} search={search} />
          </Suspense>
        ) : null}
      </div>

      {tab === "models" ? (
        <Suspense
          key={`models:${view}:${search}:${page}`}
          fallback={<ListTableSkeleton />}
        >
          <Table view={view} search={search} page={page} />
        </Suspense>
      ) : (
        <Suspense key={`assets:${search}:${page}`} fallback={<ListTableSkeleton />}>
          <FamilyTable search={search} page={page} />
        </Suspense>
      )}
    </>
  );
}
