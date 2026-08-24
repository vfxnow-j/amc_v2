import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { dayYear, money } from "@/lib/format";
import { getUnpricedItemsReport } from "@/lib/actions/reports";
import { TYPE_LABEL } from "@/lib/reservations/status";

export const metadata = { title: "Unpriced" };

const COLUMNS: Column[] = [
  { key: "order", label: "Order", width: "148px" },
  { key: "client", label: "Client", width: "minmax(0,1.2fr)" },
  { key: "type", label: "Type", width: "104px" },
  { key: "items", label: "Unpriced", width: "88px", align: "right" },
  { key: "total", label: "Order value", width: "104px", align: "right" },
  { key: "out", label: "Oldest out", width: "92px" },
];

/**
 * Reports → Unpriced.
 *
 * Units that went out with no rate anywhere — none on the `Checkout`, none on
 * the reservation line behind it — so they earn $0 and attribute nothing to the
 * unit or to the loan that bought it.
 *
 * Two tables, because the two halves need opposite things. An order carrying a
 * value with unpriced lines on it is a **fault**: somebody has been billed for
 * work that isn't attributed to the hardware that did it, and the revenue on
 * those units is understated for good. An order worth $0 with unpriced lines is
 * **consistent** — internal moves, demo kit, custody transfers — and needs
 * nothing done to it. Sorting them into one table by count, as v1 did, buries
 * the first kind under the second.
 */
export default function UnpricedPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Unpriced"
        blurb="Units that went out with no rate on them, grouped by the order they went out on."
        actions={<BackToReports />}
      />
      <Suspense fallback={<ListTableSkeleton />}>
        <Tables />
      </Suspense>
    </>
  );
}

async function Tables() {
  const { groups, summary } = await getUnpricedItemsReport();
  const faults = groups.filter((group) => group.orderTotal > 0);
  const expected = groups.filter((group) => group.orderTotal <= 0);

  const toRow = (group: (typeof groups)[number]) => {
    const oldest = group.items.reduce(
      (earliest, item) =>
        item.checkoutDate < earliest ? item.checkoutDate : earliest,
      group.items[0].checkoutDate,
    );

    return {
      id: group.reservationId ?? group.items[0].checkoutId,
      href: group.reservationId
        ? `/dashboard/orders/${group.reservationId}`
        : undefined,
      cells: {
        order: (
          <span className="font-bold tabular-nums">
            {group.reservationNumber}
          </span>
        ),
        client: <span className="truncate">{group.clientName}</span>,
        type: (
          <span className="text-ink-muted">
            {TYPE_LABEL[group.reservationType as keyof typeof TYPE_LABEL] ??
              group.reservationType}
            {group.isRecurring ? " · recurring" : ""}
          </span>
        ),
        items: group.items.length,
        total:
          group.orderTotal > 0 ? (
            money(group.orderTotal)
          ) : (
            <span className="text-ink-faint">—</span>
          ),
        out: (
          <span className="tabular-nums text-ink-muted">
            {dayYear(new Date(oldest))}
          </span>
        ),
      },
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <ListTable
        title="Priced orders with unpriced lines"
        grow={false}
        columns={COLUMNS}
        total={faults.length}
        rows={faults.map(toRow)}
        footerNote={
          <>
            {summary.itemsInValuedOrders} units across them earn nothing, on
            orders somebody has been charged for
          </>
        }
        empty={
          <>
            Every order carrying a value has a rate on every line. Nothing is
            being billed for without the hardware being credited.
          </>
        }
      />

      <ListTable
        title="Zero-value orders"
        grow={false}
        columns={COLUMNS}
        total={expected.length}
        rows={expected.map(toRow)}
        footerNote={
          <>
            {summary.totalItems - summary.itemsInValuedOrders} units — internal
            moves, demos and custody transfers, which are meant to be free
          </>
        }
        empty={<>No zero-value orders carry unpriced units.</>}
      />
    </div>
  );
}
