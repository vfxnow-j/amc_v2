import { Suspense } from "react";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import { getClientHeaderStats, getClientList } from "@/lib/queries/clients";

export const metadata = { title: "Accounts" };

/** Client · Company · Email · Contacts · Orders · Owed · Terms */
const COLUMNS: Column[] = [
  { key: "name", label: "Client", width: "minmax(0,1.2fr)" },
  { key: "company", label: "Company", width: "minmax(0,1.2fr)" },
  { key: "email", label: "Email", width: "minmax(0,1.2fr)" },
  { key: "contacts", label: "Contacts", width: "80px", align: "right" },
  { key: "orders", label: "Orders", width: "82px", align: "right" },
  { key: "owed", label: "Owed", width: "96px", align: "right" },
  { key: "terms", label: "Terms", width: "72px" },
];

async function HeaderBlurb() {
  const { clients, withOpen } = await getClientHeaderStats();
  return (
    <>
      {clients} {clients === 1 ? "account" : "accounts"} · {withOpen} with an
      open order
    </>
  );
}

async function Table({ search, page }: { search: string; page: number }) {
  const { rows, total, pageSize } = await getClientList({ search, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/clients?${query}` : "/dashboard/clients";
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
          <>No account matches &ldquo;{search}&rdquo;.</>
        ) : (
          <>
            No accounts yet. A client is created when a lead converts, or
            directly when you build their first order.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/clients/${row.id}`,
        cells: {
          name: (
            <span className="font-bold">
              {row.name}
              {/* An unsigned agreement is a real blocker on delivery, so it
                  belongs on the list rather than one level in. */}
              {row.agreementSigned ? null : (
                <span className="font-normal text-ink-faint"> · unsigned</span>
              )}
            </span>
          ),
          company: (
            <span className="text-ink-muted">{row.companyName ?? "—"}</span>
          ),
          email: <span className="text-ink-muted">{row.email ?? "—"}</span>,
          contacts: row.contacts || <span className="text-ink-faint">—</span>,
          orders: (
            <span className="text-ink-muted">
              {row.openOrders > 0
                ? `${row.openOrders}/${row.orders}`
                : row.orders || "—"}
            </span>
          ),
          owed:
            row.owed > 0 ? (
              money(row.owed)
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          terms: <span className="text-ink-muted">Net {row.paymentTerms}</span>,
        },
      }))}
    />
  );
}

/**
 * Clients → Accounts.
 *
 * The Orders column reads "open/total" when anything is running, because "has
 * three orders" and "has three orders right now" are different facts and only
 * the second one means somebody should pick up the phone carefully.
 *
 * Owed and open-order counts come from two grouped queries over the page's
 * client ids, not from nested selects per row — loading every invoice of every
 * client to show one number is what made the v1 list slow.
 */
export default async function ClientsPage({
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
        eyebrow="Clients"
        title="Accounts"
        blurb={
          <Suspense fallback="Counting accounts…">
            <HeaderBlurb />
          </Suspense>
        }
        actions={<ListSearch placeholder="Search clients, companies, email" />}
      />

      <Suspense key={`${search}:${page}`} fallback={<ListTableSkeleton />}>
        <Table search={search} page={page} />
      </Suspense>
    </>
  );
}
