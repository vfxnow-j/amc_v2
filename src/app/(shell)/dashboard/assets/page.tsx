import { Suspense } from "react";
import Link from "next/link";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import {
  getFleetCounts,
  getFleetList,
  getSuggestions,
  type FleetRow,
  type FleetView,
} from "@/lib/queries/families";
import { getAssetHeaderStats } from "@/lib/queries/inventory";

export const metadata = { title: "Assets" };

const VIEWS: FleetView[] = ["active", "retired", "all"];
const VIEW_LABEL: Record<FleetView, string> = {
  active: "Active",
  retired: "Retired",
  all: "All",
};

function isView(value: unknown): value is FleetView {
  return value === "active" || value === "retired" || value === "all";
}

/** Asset · Models · Category · Fleet · Free · Out · Rates */
const COLUMNS: Column[] = [
  { key: "name", label: "Asset", width: "minmax(0,1.5fr)" },
  { key: "models", label: "Models", width: "72px", align: "right" },
  { key: "category", label: "Category", width: "148px" },
  { key: "fleet", label: "Fleet", width: "60px", align: "right" },
  { key: "available", label: "Free", width: "60px", align: "right" },
  { key: "out", label: "Out", width: "56px", align: "right" },
  { key: "rate", label: "Rate", width: "128px", align: "right" },
];

function rateCell(row: FleetRow) {
  const pick = row.daily
    ? { range: row.daily, unit: "/d" }
    : row.monthly
      ? { range: row.monthly, unit: "/mo" }
      : null;
  if (!pick) return <span className="text-ink-faint">—</span>;
  const { range, unit } = pick;
  return (
    <span className="text-ink-muted">
      {range.min === range.max
        ? `${money(range.min)}${unit}`
        : `${money(range.min)}–${money(range.max)}${unit}`}
    </span>
  );
}

async function HeaderBlurb() {
  const { active, fleet } = await getAssetHeaderStats();
  return (
    <>
      {active} active {active === 1 ? "asset" : "assets"} · {fleet} units in
      fleet
    </>
  );
}

async function Tabs({ view, search }: { view: FleetView; search: string }) {
  const counts = await getFleetCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="active"
      label="Asset views"
      options={VIEWS.map((option) => ({
        value: option,
        label: VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

/**
 * Offered only while there is something to offer, and phrased as an
 * opportunity rather than a backlog.
 *
 * The first version counted ungrouped models and reported it as an outstanding
 * number, which was the wrong idea twice over: most of the fleet has no
 * variants and never will, so "218 not grouped" described a normal resting
 * state as debt.
 */
async function GroupingPrompt() {
  const suggestions = await getSuggestions();
  if (suggestions.length === 0) return null;
  return (
    <Link
      href="/dashboard/assets/grouping"
      className="rounded-pill bg-accent-tint px-3 py-1 text-pill text-accent-on-tint transition-colors hover:bg-accent-tint-strong"
    >
      {suggestions.length}{" "}
      {suggestions.length === 1 ? "grouping" : "groupings"} suggested →
    </Link>
  );
}

async function Table({
  view,
  search,
  page,
}: {
  view: FleetView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getFleetList({ view, search, page });
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
            Nothing in {VIEW_LABEL[view]} matches &ldquo;{search}&rdquo; — by
            name, manufacturer, or the name of a model inside an asset.
          </>
        ) : view === "retired" ? (
          <>
            Nothing has been retired. Assets land here when they&rsquo;re sold,
            recycled or written off — the units stay on the record either way.
          </>
        ) : (
          <>There are no assets yet. Register the first one.</>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: row.href,
        cells: {
          name: (
            <span className="truncate">
              <span className="font-bold">{row.name}</span>
              {row.manufacturer ? (
                <span className="text-ink-faint"> · {row.manufacturer}</span>
              ) : null}
            </span>
          ),
          // A dash, not 1. Most of the fleet has no variants, and saying "1
          // model" of a thing that has never had a second one is noise.
          models:
            row.models === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
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
          fleet: <span className="text-ink-muted">{row.stock.fleet || "—"}</span>,
          available:
            row.stock.fleet === 0 ? (
              <span className="text-ink-faint">—</span>
            ) : row.stock.available === 0 ? (
              <span className="font-bold text-accent-text">0</span>
            ) : (
              <span className="font-bold">{row.stock.available}</span>
            ),
          out: <span className="text-ink-muted">{row.stock.out || "—"}</span>,
          rate: rateCell(row),
        },
      }))}
    />
  );
}

/**
 * Inventory → Assets: one list of what the business owns.
 *
 * An asset with variants — Mac Studio, RTX 5090 — is one row with its stock
 * summed across every model of it. An asset without variants is one row that
 * *is* the thing, and it links straight to its own record. Both are assets;
 * the difference is only whether a model tier exists underneath, and most of
 * the fleet has none and never will.
 *
 * That is the correction. An earlier pass split this into Assets and Models
 * tabs and called all 224 rows models, which made a switch a "model" of
 * nothing. The word model now appears only where an asset genuinely has more
 * than one.
 *
 * "Free" counts units whose status is AVAILABLE, the one bookable definition
 * (`lib/inventory/availability.ts`); "Fleet" excludes retired and sold, so it
 * does not agree with the denormalized `totalQuantity` column and shouldn't. A
 * family is Retired only when every model in it is — one live model means the
 * thing is still in service.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: FleetView = isView(params.view) ? params.view : "active";
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
            <ListSearch placeholder="Search assets, models, manufacturers" />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
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
