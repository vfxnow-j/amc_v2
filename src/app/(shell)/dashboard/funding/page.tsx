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
import { dayYear, money, moneyCompact } from "@/lib/format";
import {
  FUNDING_PURCHASE_TYPE_LABEL,
  FUNDING_STATUS_LABEL,
  FUNDING_VIEWS,
  FUNDING_VIEW_LABEL,
  isFundingView,
  type FundingView,
} from "@/lib/procurement/funding-labels";
import {
  getFundingHeaderStats,
  getFundingRequestList,
  getFundingViewCounts,
} from "@/lib/queries/funding";
import { getSessionUser } from "@/lib/roles";
import { canRaise } from "@/lib/procurement/access";

export const metadata = { title: "Funding requests" };

/** Request · Customer · Requested by · Needed by · Evidence · Amount · State */
const COLUMNS: Column[] = [
  { key: "number", label: "Request", width: "132px" },
  { key: "customer", label: "Customer / purpose", width: "minmax(0,1.3fr)" },
  { key: "requestedBy", label: "Requested by", width: "minmax(0,0.8fr)" },
  { key: "needed", label: "Needed by", width: "92px" },
  { key: "evidence", label: "Backed by", width: "120px" },
  { key: "amount", label: "Requested", width: "104px", align: "right" },
  { key: "status", label: "State", width: "96px" },
];

const EMPTY: Record<FundingView, React.ReactNode> = {
  open: (
    <>
      No request is open. A funding request is the case for spending the money —
      raise one before committing to a loan or a line of credit.
    </>
  ),
  DRAFT: <>No drafts. A new request starts here until it is submitted.</>,
  SUBMITTED: <>Nothing is waiting on accounting.</>,
  APPROVED: <>Nothing approved is waiting to be funded.</>,
  FUNDED: <>Nothing funded is waiting on its hardware.</>,
  FULFILLED: <>No request has been closed out yet.</>,
  DECLINED: <>No request has been declined.</>,
  CANCELLED: <>No request has been canceled.</>,
  all: (
    <>
      No funding requests exist in this instance yet. v1&rsquo;s requests arrive
      with the next refresh; new ones can be raised here.
    </>
  ),
};

async function HeaderBlurb() {
  const { openCount, openRequested, submittedCount } = await getFundingHeaderStats();
  if (openCount === 0) return <>No open requests</>;
  return (
    <>
      {openCount} open · {moneyCompact(openRequested)} requested
      {submittedCount > 0 ? ` · ${submittedCount} with accounting` : ""}
    </>
  );
}

async function Tabs({ view, search }: { view: FundingView; search: string }) {
  const counts = await getFundingViewCounts(search);
  return (
    <FilterTabs
      param="status"
      value={view}
      fallback="open"
      label="Funding request states"
      options={FUNDING_VIEWS.map((option) => ({
        value: option,
        label: FUNDING_VIEW_LABEL[option],
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
  view: FundingView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getFundingRequestList({ view, search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "open") params.set("status", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/funding?${query}` : "/dashboard/funding";
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
            No request in {FUNDING_VIEW_LABEL[view]} matches &ldquo;{search}&rdquo;.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/funding/${row.id}`,
        // Accounting has it and nobody has answered: the one state that is
        // somebody else's move to make.
        flagged: row.status === "SUBMITTED",
        cells: {
          number: <span className="font-bold tabular-nums">{row.requestNumber}</span>,
          customer: (
            <span className="truncate">
              {row.customer ?? <span className="text-ink-muted">General inventory</span>}
              {row.purchaseType ? (
                <span className="text-ink-faint"> · {FUNDING_PURCHASE_TYPE_LABEL[row.purchaseType]}</span>
              ) : null}
            </span>
          ),
          requestedBy: <span className="text-ink-muted">{row.requestedBy}</span>,
          needed: (
            <span className="tabular-nums text-ink-muted">
              {row.neededByDate ? dayYear(row.neededByDate) : "—"}
            </span>
          ),
          // Counts of attached evidence, not money: a PO can back more than one
          // request, so its total is not this request's to sum.
          evidence: (
            <span className="text-ink-muted">
              {row.purchaseOrders === 0 && row.orders === 0
                ? "—"
                : [
                    row.purchaseOrders ? `${row.purchaseOrders} PO` : null,
                    row.orders ? `${row.orders} ${row.orders === 1 ? "order" : "orders"}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          ),
          amount: money(row.amountRequested),
          status: <span className="text-ink-muted">{FUNDING_STATUS_LABEL[row.status]}</span>,
        },
      }))}
    />
  );
}

/**
 * Procurement → Funding requests.
 *
 * The case for spending the money, before the PO goes to the vendor. The filter
 * is `?status=`, named by lifecycle state, so the Procurement Overview's
 * pipeline rows link straight into the matching tab.
 *
 * The header sums `amountRequested` and says "requested", never "committed":
 * until a request is funded it is an ask, and a declined one was never money.
 */
export default async function FundingRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: FundingView = isFundingView(params.status) ? params.status : "open";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const user = await getSessionUser();

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Funding requests"
        blurb={
          <Suspense fallback="Totalling open requests…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={
          <>
            <ListSearch placeholder="Search request, customer, lender" />
            {user && canRaise(user.role) ? (
              <Link
                href="/dashboard/funding/new"
                className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill whitespace-nowrap text-accent-on-solid transition-colors hover:bg-accent-800"
              >
                New request
              </Link>
            ) : null}
          </>
        }
      />

      <div className="flex items-center gap-3 overflow-x-auto">
        <Suspense fallback={<FilterTabsSkeleton width={640} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
