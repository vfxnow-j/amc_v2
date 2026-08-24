import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/reservations/status";
import { getPackages } from "@/lib/queries/operate";

export const metadata = { title: "Packages" };

/** Package · Order · Client · Items · Delivery · Return · Order state */
const COLUMNS: Column[] = [
  { key: "name", label: "Package", width: "minmax(0,1.1fr)" },
  { key: "order", label: "Order", width: "132px" },
  { key: "client", label: "Client", width: "minmax(0,1.2fr)" },
  { key: "items", label: "Lines", width: "64px", align: "right" },
  { key: "delivery", label: "Delivery", width: "92px", align: "right" },
  { key: "returnCost", label: "Return", width: "88px", align: "right" },
  { key: "status", label: "Order state", width: "120px" },
];

async function Table({ page }: { page: number }) {
  const { rows, total, pageSize } = await getPackages({ page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const hrefFor = (next: number) =>
    next > 1 ? `/dashboard/packages?page=${next}` : "/dashboard/packages";

  return (
    <ListTable
      columns={COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        <>
          No packages. A package groups an order&rsquo;s lines into one shipment
          with its own delivery and return cost — orders that ship as a single
          consignment never need one.
        </>
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/orders/${row.orderId}`,
        cells: {
          name: (
            <span className="font-bold">
              {row.name}
              {row.isActive ? null : (
                <span className="font-normal text-ink-faint"> · inactive</span>
              )}
            </span>
          ),
          order: (
            <span className="tabular-nums text-ink-muted">{row.orderNumber}</span>
          ),
          client: row.clientName,
          items: row.items || <span className="text-ink-faint">—</span>,
          delivery:
            row.deliveryCost === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(row.deliveryCost)
            ),
          returnCost:
            row.returnCost === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              money(row.returnCost)
            ),
          status: (
            <span className="text-ink-muted">
              {STATUS_LABEL[row.orderStatus]}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Operate → Packages, promoted out of the reservation record.
 *
 * These are **per-order shipping groups, not a bundle catalogue.** The rail
 * label invites the other reading, so it's worth being plain: `Package` hangs
 * off one `Reservation` and groups that order's lines into a consignment with
 * its own delivery and return cost. There is no reusable kit template in the
 * schema and this screen doesn't imply one — every row opens its order.
 */
export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Packages"
        blurb="How orders are grouped for shipping"
      />

      <Suspense key={page} fallback={<ListTableSkeleton />}>
        <Table page={page} />
      </Suspense>
    </>
  );
}
