import { Suspense } from "react";
import Link from "next/link";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  CellLink,
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import {
  UNIT_STATUS_LABEL,
  UNIT_VIEWS,
  UNIT_VIEW_LABEL,
  isUnitView,
  type UnitView,
} from "@/lib/inventory/labels";
import {
  getUnitFilterNames,
  getUnitList,
  getUnitViewCounts,
  type UnitFilters,
} from "@/lib/queries/inventory";

export const metadata = { title: "Units" };

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

/** The URL this screen is at, with one thing about it changed. */
function unitsHref(
  state: { view: UnitView; search: string; page: number } & UnitFilters,
) {
  const params = new URLSearchParams();
  if (state.view !== "in-fleet") params.set("view", state.view);
  if (state.search) params.set("q", state.search);
  if (state.locationId) params.set("location", state.locationId);
  if (state.assetId) params.set("asset", state.assetId);
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query ? `/dashboard/units?${query}` : "/dashboard/units";
}

async function Tabs({
  view,
  search,
  filters,
}: {
  view: UnitView;
  search: string;
  filters: UnitFilters;
}) {
  // Counted through the filter, not around it: a tab reading "397 Available"
  // over a table showing four units at one location would be the list
  // disagreeing with itself.
  const counts = await getUnitViewCounts(search, filters);
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

async function HeaderBlurb({ filtered }: { filtered: boolean }) {
  const counts = await getUnitViewCounts();
  return (
    <>
      {counts["in-fleet"]} in fleet · {counts.available} free · {counts.out} out
      {/* Said out loud when a filter is on, because these three and the tab
          counts below would otherwise look like two answers to one question. */}
      {filtered ? " · across the whole fleet, before the filter below" : ""}
    </>
  );
}

/**
 * What the list has been narrowed to, and the way back out.
 *
 * Both filters arrive as ids from a record — the location record's shelf, the
 * asset record's units — so the strip resolves the id to a name and links back
 * to the record it came from. An id that matches nothing says so out loud: a link
 * that has gone stale and a shelf that has been emptied look identical in the
 * table, and they are not the same problem.
 */
async function ActiveFilters({
  view,
  search,
  filters,
}: {
  view: UnitView;
  search: string;
  filters: UnitFilters;
}) {
  const { location, asset } = await getUnitFilterNames(filters);

  const chips: React.ReactNode[] = [];

  if (filters.locationId) {
    chips.push(
      <Chip
        key="location"
        clearHref={unitsHref({
          view,
          search,
          page: 1,
          assetId: filters.assetId,
        })}
      >
        {location ? (
          <>
            At{" "}
            <Link
              href={`/dashboard/locations/${location.id}`}
              className="font-bold hover:underline"
            >
              {location.name}
            </Link>
          </>
        ) : (
          <span className="text-ink-muted">
            No location matches that link — nothing can be shown
          </span>
        )}
      </Chip>,
    );
  }

  if (filters.assetId) {
    chips.push(
      <Chip
        key="asset"
        clearHref={unitsHref({
          view,
          search,
          page: 1,
          locationId: filters.locationId,
        })}
      >
        {asset ? (
          <>
            Of{" "}
            <Link
              href={`/dashboard/assets/${asset.id}`}
              className="font-bold hover:underline"
            >
              {asset.name}
            </Link>
          </>
        ) : (
          <span className="text-ink-muted">
            No asset matches that link — nothing can be shown
          </span>
        )}
      </Chip>,
    );
  }

  return <>{chips}</>;
}

function Chip({
  children,
  clearHref,
}: {
  children: React.ReactNode;
  clearHref: string;
}) {
  return (
    <span className="flex items-center gap-2 rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
      {children}
      <Link
        href={clearHref}
        className="text-ink-faint transition-colors hover:text-ink"
        aria-label="Clear this filter"
      >
        ✕
      </Link>
    </span>
  );
}

async function Table({
  view,
  search,
  page,
  filters,
}: {
  view: UnitView;
  search: string;
  page: number;
  filters: UnitFilters;
}) {
  const { rows, total, pageSize } = await getUnitList({
    view,
    search,
    page,
    ...filters,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const filtered = Boolean(filters.locationId || filters.assetId);

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{
        page,
        pages,
        hrefFor: (next) => unitsHref({ view, search, page: next, ...filters }),
      }}
      empty={
        search ? (
          <>
            No unit in {UNIT_VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;.
            Try a barcode, a serial, or switch to All.
          </>
        ) : filtered ? (
          <>
            Nothing in {UNIT_VIEW_LABEL[view]} is left after the filter above.
            Clear it, or switch to All — retired and sold units are outside every
            other view.
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
          // The row goes to the unit; these three go to the records they name.
          // Everything in this table was already a record — the list just
          // wasn't saying so, and a reader who wanted the asset had to open a
          // unit to get to it.
          asset: (
            <CellLink href={`/dashboard/assets/${row.asset.id}`}>
              {row.asset.name}
            </CellLink>
          ),
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
          location: row.location ? (
            <span className="text-ink-muted">
              <CellLink href={`/dashboard/locations/${row.location.id}`}>
                {row.location.name}
              </CellLink>
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          // Custody comes from the open checkout, not from the status column —
          // those two can disagree, and this one is the physical record.
          holder: row.holder ? (
            <CellLink href={`/dashboard/clients/${row.holder.id}`}>
              {row.holder.name}
            </CellLink>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
          revenue: row.revenue ? (
            money(row.revenue)
          ) : (
            <span className="text-ink-faint">—</span>
          ),
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
 *
 * `location` and `asset` narrow it by id rather than by text. The asset record
 * used to reach its own units through `?q=<asset name>`, which meant "any unit
 * whose asset name contains this string" — near enough for a Venice, wrong for
 * anything whose name is a prefix of a sibling's.
 */
export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    page?: string;
    location?: string;
    asset?: string;
  }>;
}) {
  const params = await searchParams;
  const view: UnitView = isUnitView(params.view) ? params.view : "in-fleet";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const filters: UnitFilters = {
    locationId: params.location?.trim() || undefined,
    assetId: params.asset?.trim() || undefined,
  };
  const filterKey = `${filters.locationId ?? ""}:${filters.assetId ?? ""}`;

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Units"
        blurb={
          <Suspense fallback="Counting units…">
            {/* The whole fleet, never the filtered set: this is the headline
                the screen is about, and the strip below says what has been
                narrowed. */}
            <HeaderBlurb filtered={Boolean(params.location || params.asset)} />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search barcode, serial, asset" />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={420} />}>
          <Tabs view={view} search={search} filters={filters} />
        </Suspense>
        {filters.locationId || filters.assetId ? (
          <Suspense fallback={null}>
            <ActiveFilters view={view} search={search} filters={filters} />
          </Suspense>
        ) : null}
      </div>

      <Suspense
        key={`${view}:${search}:${page}:${filterKey}`}
        fallback={<ListTableSkeleton />}
      >
        <Table view={view} search={search} page={page} filters={filters} />
      </Suspense>
    </>
  );
}
