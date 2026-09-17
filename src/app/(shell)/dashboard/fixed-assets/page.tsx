import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { FixedAssetFilters } from "@/components/fixed-assets/filters";
import { FilterTabs } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import { ListTable, ListTableSkeleton, type Column } from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import type { OwnershipType } from "@/generated/prisma/client";
import { money } from "@/lib/format";
import {
  FIXED_ASSET_VIEWS,
  fixedAssetCategories,
  getFixedAssets,
  METHOD_LABEL,
  OWNERSHIP_LABEL,
  type FixedAssetFilters as Filters,
  type FixedAssetView,
} from "@/lib/queries/fixed-assets";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Fixed assets" };

const PAGE_SIZE = 50;
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit" });

const COLUMNS: Column[] = [
  { key: "asset", label: "Asset", width: "minmax(0,1.7fr)" },
  { key: "ownership", label: "Ownership", width: "minmax(0,1fr)" },
  { key: "inService", label: "In service", width: "84px" },
  { key: "cost", label: "Cost", width: "92px", align: "right" },
  { key: "valued", label: "Market", width: "88px", align: "right" },
  { key: "orders", label: "Orders", width: "56px", align: "right" },
  { key: "depreciation", label: "Depreciation", width: "minmax(0,0.9fr)" },
  { key: "accumulated", label: "Accumulated", width: "100px", align: "right" },
  { key: "book", label: "Book value", width: "100px", align: "right" },
  { key: "earned", label: "Earned", width: "92px", align: "right" },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[128px]">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p className="text-[20px] font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-micro text-ink-faint">{sub}</p> : null}
    </div>
  );
}

async function Register({ filters, page }: { filters: Filters; page: number }) {
  const { rows, totals } = await getFixedAssets(filters);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exportQuery = new URLSearchParams(
    Object.entries({
      view: filters.view,
      ownership: filters.ownership,
      category: filters.categoryId,
      q: filters.query,
    }).filter(([, value]) => value) as [string, string][],
  ).toString();
  const hrefFor = (next: number) => {
    const params = new URLSearchParams(exportQuery);
    if (next > 1) params.set("page", String(next));
    return `/dashboard/fixed-assets?${params.toString()}`;
  };
  const disposedView = filters.view === "disposed";

  return (
    <>
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Stat label="Units" value={totals.units.toLocaleString("en-US")} sub={`${totals.valued} valued · ${totals.notValued} not`} />
        <Stat label="Cost" value={money(totals.cost)} />
        <Stat label="Accumulated depreciation" value={money(totals.accumulated)} />
        <Stat label="Book value" value={money(totals.book)} sub={totals.notValued ? `${totals.notValued} units can't be valued` : undefined} />
        <Stat label="Market value" value={money(totals.marketValue)} sub="where researched" />
        <Stat label="Earned" value={money(totals.revenue)} sub={`${totals.orders.toLocaleString("en-US")} order placements`} />
        {disposedView ? <Stat label="Sale proceeds" value={money(totals.proceeds)} /> : null}
        <span className="ml-auto flex gap-2">
          <a
            href={`/api/reports/fixed-assets?format=pdf&${exportQuery}`}
            className="flex items-center gap-1 rounded-pill bg-accent-solid px-3 py-[6px] text-pill text-accent-on-solid"
          >
            <FileDown className="size-[13px]" aria-hidden /> PDF
          </a>
          <a
            href={`/api/reports/fixed-assets?format=csv&${exportQuery}`}
            className="flex items-center gap-1 rounded-pill bg-sunken px-3 py-[6px] text-pill text-ink hover:bg-row-hover"
          >
            <FileSpreadsheet className="size-[13px]" aria-hidden /> CSV
          </a>
        </span>
      </section>

      <ListTable
        columns={COLUMNS}
        total={rows.length}
        page={page}
        pageSize={PAGE_SIZE}
        pagination={{ page, pages, hrefFor }}
        empty={<>No units match these filters.</>}
        rows={shown.map((row) => ({
          id: row.unitId,
          href: `/dashboard/units/${row.unitId}`,
          cells: {
            asset: (
              <span className="min-w-0">
                <span className="block truncate font-bold">{row.model}</span>
                <span className="block truncate text-detail text-ink-muted">
                  {row.barcode}
                  {row.serialNumber ? ` · S/N ${row.serialNumber}` : ""} · {row.category}
                  {row.disposal ? ` · ${row.disposal.how}${row.disposal.on ? ` ${DAY.format(row.disposal.on)}` : ""}` : ""}
                </span>
              </span>
            ),
            ownership: (
              <span className="min-w-0">
                <span className="block truncate">{OWNERSHIP_LABEL[row.ownership]}</span>
                <span className="block truncate text-detail text-ink-muted">
                  {row.financing
                    ? [row.financing.name, row.financing.lender].filter(Boolean).join(" · ")
                    : row.vendor ?? "—"}
                </span>
              </span>
            ),
            inService: <span className="text-ink-muted">{DAY.format(row.inServiceDate)}</span>,
            cost: row.cost === null ? <span className="text-ink-faint">—</span> : money(row.cost),
            valued: row.marketValue === null ? <span className="text-ink-faint">—</span> : money(row.marketValue),
            orders: <span className="text-ink-muted">{row.orders}</span>,
            depreciation: row.depreciation ? (
              <span className="min-w-0">
                <span className="block truncate">{METHOD_LABEL[row.depreciation.method] ?? row.depreciation.method}</span>
                <span className="block truncate text-detail text-ink-muted">
                  {row.depreciation.fullyDepreciated
                    ? "fully depreciated"
                    : `${Math.min(row.depreciation.monthsElapsed, row.depreciation.lifeMonths)} of ${row.depreciation.lifeMonths} mo`}
                </span>
              </span>
            ) : (
              <span className="truncate text-detail text-destructive">{row.notValuedReason}</span>
            ),
            accumulated: row.depreciation ? money(row.depreciation.accumulated) : <span className="text-ink-faint">—</span>,
            book: row.depreciation ? <span className="font-bold">{money(row.depreciation.book)}</span> : <span className="text-ink-faint">—</span>,
            earned: money(row.revenue),
          },
        }))}
      />
    </>
  );
}

/**
 * Accounting → Fixed assets: the register.
 *
 * One row per unit with everything accounting reconciles against — what it is,
 * how it was bought and financed, what it cost, what the market says it's
 * worth, how many orders it has been on and what it has earned, its schedule,
 * accumulated depreciation and book value. Totals follow the filters, and the
 * PDF and CSV export exactly the filtered register. Each row opens the unit.
 */
export default async function FixedAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ownership?: string; category?: string; q?: string; page?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/dashboard");

  const params = await searchParams;
  const view = (FIXED_ASSET_VIEWS as readonly string[]).includes(params.view ?? "")
    ? (params.view as FixedAssetView)
    : "in-service";
  const ownership = params.ownership && params.ownership in OWNERSHIP_LABEL ? (params.ownership as OwnershipType) : undefined;
  const filters: Filters = { view, ownership, categoryId: params.category || undefined, query: params.q || undefined };
  const page = Math.max(1, Number(params.page) || 1);
  const categories = await fixedAssetCategories();

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Fixed assets"
        blurb={
          <>
            The asset register — cost, ownership, depreciation and book value for every unit. Book values use each
            model&rsquo;s schedule from its in-service date;{" "}
            <Link href="/dashboard/reports" className="text-accent-text hover:underline">
              scheduled reports
            </Link>{" "}
            carry the period depreciation.
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          param="view"
          value={view}
          fallback="in-service"
          label="Register"
          options={[
            { value: "in-service", label: "In service" },
            { value: "disposed", label: "Disposed" },
            { value: "all", label: "All" },
          ]}
        />
        <FixedAssetFilters
          ownership={ownership ? { value: ownership, label: OWNERSHIP_LABEL[ownership] } : null}
          ownershipOptions={Object.entries(OWNERSHIP_LABEL).map(([value, label]) => ({ value, label }))}
          categories={categories.map((category) => ({ ...category, selected: category.id === filters.categoryId }))}
        />
        <div className="ml-auto w-full max-w-xs">
          <ListSearch placeholder="Search model, barcode, serial, loan" />
        </div>
      </div>

      <Suspense key={JSON.stringify({ filters, page })} fallback={<ListTableSkeleton />}>
        <Register filters={filters} page={page} />
      </Suspense>
    </>
  );
}
