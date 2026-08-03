import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, money } from "@/lib/format";
import {
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_VIEWS,
  LEAD_VIEW_LABEL,
  isLeadView,
  type LeadView,
} from "@/lib/clients/labels";
import {
  getLeadHeaderStats,
  getLeadList,
  getLeadViewCounts,
} from "@/lib/queries/clients";

export const metadata = { title: "Leads" };

/** Lead · Company · Source · Owner · Value · Status · In */
const COLUMNS: Column[] = [
  { key: "name", label: "Lead", width: "minmax(0,1.2fr)" },
  { key: "company", label: "Company", width: "minmax(0,1.2fr)" },
  { key: "source", label: "Source", width: "100px" },
  { key: "owner", label: "Owner", width: "minmax(0,0.9fr)" },
  { key: "value", label: "Value", width: "92px", align: "right" },
  { key: "status", label: "Status", width: "104px" },
  { key: "created", label: "In", width: "88px" },
];

const EMPTY: Record<LeadView, React.ReactNode> = {
  new: (
    <>
      No new leads waiting. Enquiries arrive here from the website, JustCall and
      HubSpot, and from anything logged by hand.
    </>
  ),
  working: <>Nothing in play. Every lead is either untouched or resolved.</>,
  converted: (
    <>
      Nothing converted yet. A lead converts when it becomes a client, or binds
      to an account that already exists.
    </>
  ),
  lost: <>Nothing lost or disqualified.</>,
  all: <>No leads at all yet.</>,
};

async function HeaderBlurb() {
  const { unassigned, open, pipeline, unsized } = await getLeadHeaderStats();
  return (
    <>
      {open} in play
      {pipeline > 0 ? (
        <>
          {" · "}
          {money(pipeline)} estimated across {open - unsized} of them
        </>
      ) : null}
      {unassigned > 0 ? (
        <>
          {" · "}
          <span className="text-accent-text">{unassigned} unassigned</span>
        </>
      ) : null}
    </>
  );
}

async function Tabs({ view, search }: { view: LeadView; search: string }) {
  const counts = await getLeadViewCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="new"
      label="Lead views"
      options={LEAD_VIEWS.map((option) => ({
        value: option,
        label: LEAD_VIEW_LABEL[option],
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
  view: LeadView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getLeadList({ view, search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "new") params.set("view", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/leads?${query}` : "/dashboard/leads";
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
            No lead in {LEAD_VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/leads/${row.id}`,
        // Nobody owns it and it's still live — that's the one that goes cold.
        flagged: row.owner === null && (row.status === "NEW" || row.status === "CONTACTED"),
        cells: {
          name: <span className="font-bold">{row.name}</span>,
          company: (
            <span className="text-ink-muted">{row.companyName ?? "—"}</span>
          ),
          source: (
            <span className="text-ink-muted">
              {LEAD_SOURCE_LABEL[row.source]}
            </span>
          ),
          owner: row.owner ?? (
            <span className="text-accent-text">Unassigned</span>
          ),
          value:
            row.value === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(row.value)
            ),
          status: (
            <span className="text-ink-muted">
              {LEAD_STATUS_LABEL[row.status]}
            </span>
          ),
          created: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.createdAt)}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Clients → Leads.
 *
 * v1 had both a list and a kanban; this is the list, and the kanban is not
 * being built. It renders the same query as a board of links to the record, so
 * it adds a layout rather than a capability. Its two genuine signals are kept
 * here instead: pipeline value per stage is folded into the header, and
 * staleness lives on the record as "days in this stage".
 *
 * Unowned live leads are tinted and their owner cell says so, because an
 * unassigned enquiry is the one failure mode this screen exists to catch.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: LeadView = isLeadView(params.view) ? params.view : "new";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Leads"
        blurb={
          <Suspense fallback="Counting leads…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search leads, companies, email" />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={340} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
