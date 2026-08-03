import { Suspense } from "react";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, moneyCompact, moneyExact } from "@/lib/format";
import { getPayments } from "@/lib/queries/revenue";

export const metadata = { title: "Payments" };

/** Received · Invoice · Client · Method · Reference · Amount */
const COLUMNS: Column[] = [
  { key: "date", label: "Received", width: "96px" },
  { key: "invoice", label: "Invoice", width: "132px" },
  { key: "client", label: "Client", width: "minmax(0,1.3fr)" },
  { key: "method", label: "Method", width: "104px" },
  { key: "reference", label: "Reference", width: "minmax(0,1fr)" },
  { key: "amount", label: "Amount", width: "104px", align: "right" },
];

async function Table({ search, page }: { search: string; page: number }) {
  const { rows, total, pageSize, receivedAllTime } = await getPayments({
    search,
    page,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/payments?${query}` : "/dashboard/payments";
  }

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      footerNote={
        total > 0 ? <>{moneyCompact(receivedAllTime)} received all time</> : null
      }
      empty={
        search ? (
          <>No payment matches &ldquo;{search}&rdquo;.</>
        ) : (
          <>
            No payments recorded. A payment is allocated against an invoice —
            raise and send one first, then record what came in against it.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/invoices/${row.invoiceId}`,
        cells: {
          date: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.paymentDate)}
            </span>
          ),
          invoice: (
            <span className="font-bold tabular-nums">{row.invoiceNumber}</span>
          ),
          client: row.clientName,
          method: (
            <span className="text-ink-muted">{row.method ?? "—"}</span>
          ),
          reference: (
            <span className="tabular-nums text-ink-muted">
              {row.reference ?? "—"}
            </span>
          ),
          // Cents shown: these get reconciled against a bank statement.
          amount: (
            <>
              {moneyExact(row.amount)}
              {row.synced ? (
                <span className="text-ink-faint"> · QB</span>
              ) : null}
            </>
          ),
        },
      }))}
    />
  );
}

/**
 * Revenue → Payments: new in v2.
 *
 * v1 had the `Payment` model but no screen — money received was only visible
 * one invoice at a time, or in QuickBooks. Rows link back to the invoice they
 * settle rather than to a record of their own; a payment on its own says very
 * little, and the allocation is the interesting part.
 *
 * **A payment gets no record screen** (decided while building the Revenue
 * records, 2026-08-03). Every column a `Payment` has is already on this row, and
 * `Payment.invoiceId` is a required single link — there is no many-to-many
 * allocation to build a screen around. Allocation therefore lives on the invoice
 * record, which is the only place the balance being settled is on screen; that
 * is where a payment is recorded, and where it can be read in context.
 *
 * Amounts carry cents here, unlike the rest of the app: this is the one list
 * somebody reconciles line by line against a bank statement.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Revenue"
        title="Payments"
        blurb="What has come in, and against which invoice"
        actions={<ListSearch placeholder="Search reference, invoice, client" />}
      />

      <Suspense key={`${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table search={search} page={page} />
      </Suspense>
    </>
  );
}
