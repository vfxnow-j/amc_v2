import { Suspense } from "react";
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
  INVOICE_STATUS_LABEL,
  INVOICE_VIEWS,
  INVOICE_VIEW_LABEL,
  isInvoiceView,
  type InvoiceView,
} from "@/lib/revenue/labels";
import {
  getInvoiceHeaderStats,
  getInvoiceList,
  getInvoiceViewCounts,
} from "@/lib/queries/revenue";

export const metadata = { title: "Invoices" };

/** Invoice · Client · Order · Issued · Due · Total · Outstanding · State */
const COLUMNS: Column[] = [
  { key: "number", label: "Invoice", width: "132px" },
  { key: "client", label: "Client", width: "minmax(0,1.3fr)" },
  { key: "order", label: "Order", width: "132px" },
  { key: "due", label: "Due", width: "88px" },
  { key: "total", label: "Total", width: "92px", align: "right" },
  { key: "outstanding", label: "Outstanding", width: "104px", align: "right" },
  { key: "status", label: "State", width: "108px" },
];

const EMPTY: Record<InvoiceView, React.ReactNode> = {
  outstanding: (
    <>
      Nothing is owed. Every invoice raised has been settled or canceled.
    </>
  ),
  overdue: <>Nothing is late. Every unpaid invoice is still inside its terms.</>,
  paid: <>No invoice has been paid yet.</>,
  draft: (
    <>
      No drafts. Invoices start here when a billing run generates them, before
      they&rsquo;re sent.
    </>
  ),
  all: (
    <>
      No invoices exist yet. They&rsquo;re raised from an order once it has been
      delivered or billed.
    </>
  ),
};

async function HeaderBlurb() {
  const { owed, late, lateCount } = await getInvoiceHeaderStats();
  return (
    <>
      {moneyCompact(owed)} outstanding
      {lateCount > 0 ? (
        <>
          {" · "}
          <span className="text-accent-text">
            {moneyCompact(late)} overdue across {lateCount}
          </span>
        </>
      ) : null}
    </>
  );
}

async function Tabs({ view, search }: { view: InvoiceView; search: string }) {
  const counts = await getInvoiceViewCounts(search);
  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="outstanding"
      label="Invoice views"
      options={INVOICE_VIEWS.map((option) => ({
        value: option,
        label: INVOICE_VIEW_LABEL[option],
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
  view: InvoiceView;
  search: string;
  page: number;
}) {
  const { rows, total, pageSize } = await getInvoiceList({ view, search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "outstanding") params.set("view", view);
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/invoices?${query}` : "/dashboard/invoices";
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
            No invoice in {INVOICE_VIEW_LABEL[view]} matches &ldquo;{search}
            &rdquo;. Try an invoice or order number, or switch to All.
          </>
        ) : (
          EMPTY[view]
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/invoices/${row.id}`,
        // Past due and still unsettled — the rows that need chasing.
        flagged: row.isOverdue,
        cells: {
          number: (
            <span className="font-bold tabular-nums">{row.invoiceNumber}</span>
          ),
          client: row.clientName,
          order: (
            <span className="tabular-nums text-ink-muted">
              {row.orderNumber ?? "—"}
            </span>
          ),
          due: (
            <span
              className={`tabular-nums ${row.isOverdue ? "font-bold text-accent-text" : "text-ink-muted"}`}
            >
              {dayYear(row.dueDate)}
            </span>
          ),
          total: money(row.total),
          outstanding:
            row.outstanding > 0 ? (
              money(row.outstanding)
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          status: (
            <span className="text-ink-muted">
              {INVOICE_STATUS_LABEL[row.status]}
              {/* QuickBooks is the system of record for the books; whether a
                  row got there is worth seeing without opening it. */}
              {row.synced ? (
                <span className="text-ink-faint"> · QB</span>
              ) : null}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Revenue → Invoices.
 *
 * "Overdue" is computed from the due date rather than read off
 * `Invoice.status`. The stored OVERDUE value is maintained by a nightly job, so
 * an invoice can be genuinely late while the column still reads SENT — and a
 * chasing list that misses those is worse than no list.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: InvoiceView = isInvoiceView(params.view)
    ? params.view
    : "outstanding";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Revenue"
        title="Invoices"
        blurb={
          <Suspense fallback="Totalling what's owed…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search invoice, order, client" />}
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={380} />}>
          <Tabs view={view} search={search} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table view={view} search={search} page={page} />
      </Suspense>
    </>
  );
}
