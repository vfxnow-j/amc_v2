import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, money } from "@/lib/format";
import {
  getMaintenanceCounts,
  getMaintenanceRecords,
} from "@/lib/queries/operate";

export const metadata = { title: "Maintenance log" };

const VIEWS = ["open", "completed", "all"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  open: "Open",
  completed: "Completed",
  all: "All",
};

const TYPE_LABEL: Record<string, string> = {
  PREVENTIVE: "Preventive",
  CORRECTIVE: "Corrective",
  DAMAGE_REPAIR: "Damage",
  INSPECTION: "Inspection",
  CALIBRATION: "Calibration",
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Done",
  CANCELLED: "Canceled",
};

const COLUMNS: Column[] = [
  { key: "unit", label: "Unit", width: "120px" },
  { key: "asset", label: "Asset", width: "minmax(0,1.1fr)" },
  { key: "description", label: "Work", width: "minmax(0,1.6fr)" },
  { key: "type", label: "Type", width: "100px" },
  { key: "by", label: "By", width: "minmax(0,0.8fr)" },
  { key: "cost", label: "Cost", width: "88px", align: "right" },
  { key: "when", label: "When", width: "92px" },
  { key: "status", label: "State", width: "104px" },
];

const EMPTY: Record<View, React.ReactNode> = {
  open: (
    <>
      No maintenance outstanding. Records land here when a work order is raised
      against a unit, or when a return is marked damaged.
    </>
  ),
  completed: <>Nothing completed yet.</>,
  all: (
    <>
      The maintenance log is empty. A closed work order writes one, so a
      unit&rsquo;s repair history survives the work order itself.
    </>
  ),
};

async function Tabs({ view }: { view: View }) {
  const counts = await getMaintenanceCounts();
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="open"
      label="Maintenance views"
      options={VIEWS.map((option) => ({
        value: option,
        label: VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function Table({ view, page }: { view: View; page: number }) {
  const { rows, total, pageSize } = await getMaintenanceRecords({ view, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "open") params.set("view", view);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/maintenance?${query}` : "/dashboard/maintenance";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={EMPTY[view]}
      rows={rows.map((row) => ({
        id: row.id,
        cells: {
          unit: <span className="font-bold tabular-nums">{row.barcode}</span>,
          asset: row.assetName,
          description: (
            <span className="text-ink-muted">{row.description}</span>
          ),
          type: (
            <span className="text-ink-muted">
              {TYPE_LABEL[row.type] ?? row.type}
            </span>
          ),
          by: <span className="text-ink-muted">{row.performedBy ?? "—"}</span>,
          cost:
            row.cost === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(row.cost)
            ),
          when: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.when)}
            </span>
          ),
          status: (
            <span className="text-ink-muted">
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Service center → Maintenance log: the last placeholder in this cluster.
 *
 * `MaintenanceRecord` predates the v2 Service center and outlives each work
 * order — closing one with CLOSED_SCRAP or a repair writes a record here, so a
 * unit keeps its history even after the work order is gone. That makes this the
 * long view: work orders are what's happening, this is what happened.
 *
 * The date column shows completion when there is one, then the scheduled date,
 * then when the record was raised — always the most specific date known, rather
 * than a blank cell for work that hasn't finished.
 */
export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: View = VIEWS.includes(params.view as View)
    ? (params.view as View)
    : "open";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Service center"
        title="Maintenance log"
        blurb="What has been repaired, and what is still on the bench"
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={240} />}>
          <Tabs view={view} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} page={page} />
      </Suspense>
    </>
  );
}
