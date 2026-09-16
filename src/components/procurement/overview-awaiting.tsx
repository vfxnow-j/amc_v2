import { CellLink, ListTable, type Column } from "@/components/list/list-table";
import { PO_STATUS_LABEL } from "@/lib/accounting/labels";
import { dayYear, money } from "@/lib/format";
import { getAwaitingReceipt } from "@/lib/queries/procurement";

/** PO · Vendor · Ordered · Expected · Late · Received · Total · State */
const COLUMNS: Column[] = [
  { key: "number", label: "PO", width: "120px" },
  { key: "vendor", label: "Vendor", width: "minmax(0,1.2fr)" },
  { key: "ordered", label: "Ordered", width: "88px" },
  { key: "expected", label: "Expected", width: "88px" },
  { key: "late", label: "Late", width: "64px", align: "right" },
  { key: "received", label: "Received", width: "80px", align: "right" },
  { key: "total", label: "Total", width: "96px", align: "right" },
  { key: "status", label: "State", width: "104px" },
];

/**
 * Every PO waiting on a vendor, soonest expected first. A row is flagged when
 * its expected date has passed — that is somebody's call to the vendor.
 */
export async function OverviewAwaiting() {
  const { rows, lateCount } = await getAwaitingReceipt();

  return (
    <ListTable
      title="Awaiting receipt"
      grow={false}
      columns={COLUMNS}
      total={rows.length}
      footerNote={
        lateCount > 0
          ? `${lateCount} past ${lateCount === 1 ? "its" : "their"} expected date, flagged`
          : "none past its expected date"
      }
      empty={
        <>
          Nothing is waiting on a vendor. A PO appears here once it is
          submitted, and leaves when its last line is received.
        </>
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/purchase-orders/${row.id}`,
        flagged: row.daysLate > 0,
        cells: {
          number: <span className="font-bold">{row.poNumber}</span>,
          vendor: (
            <CellLink href={`/dashboard/vendors/${row.vendor.id}`}>
              {row.vendor.name}
            </CellLink>
          ),
          ordered: <span className="tabular-nums text-ink-muted">{dayYear(row.orderDate)}</span>,
          expected: row.expectedDate ? (
            <span className="tabular-nums">{dayYear(row.expectedDate)}</span>
          ) : (
            <span className="text-ink-faint">not set</span>
          ),
          late:
            row.daysLate > 0 ? (
              <span className="font-bold">{row.daysLate}d</span>
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          received: (
            <span className="text-ink-muted">
              {row.received}/{row.ordered}
            </span>
          ),
          total: money(row.total),
          status: <span className="text-ink-muted">{PO_STATUS_LABEL[row.status]}</span>,
        },
      }))}
    />
  );
}
