import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { BackToReports } from "@/components/reports/directory";
import { getStockCount } from "@/lib/queries/reports";

export const metadata = { title: "Stock count" };

/** Item · Category · Free · Out · Reserved · Service · Total */
const COLUMNS: Column[] = [
  { key: "item", label: "Item", width: "minmax(0,1.6fr)" },
  { key: "category", label: "Category", width: "minmax(0,0.8fr)" },
  { key: "free", label: "Free", width: "72px", align: "right" },
  { key: "out", label: "Out", width: "72px", align: "right" },
  { key: "reserved", label: "Reserved", width: "80px", align: "right" },
  { key: "service", label: "Service", width: "76px", align: "right" },
  { key: "total", label: "Total", width: "72px", align: "right" },
];

/**
 * Reports → Stock count.
 *
 * The sheet somebody walks the warehouse with, so it is one flat list with no
 * pagination — a count you have to page through is a count you get wrong.
 * Rows open the asset, because the next thing after finding a discrepancy is
 * looking at which units it claims to have.
 *
 * Retired and sold units are out of every column, including the total. They
 * are not in the room and never will be again, and the four state columns add
 * up to the total by construction — v1's version counted sold hardware in the
 * total only, so one asset read "1 free, 1 out, total 8".
 */
export default function StockCountPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Stock count"
        blurb="What is on the shelf right now, by item. Retired and sold units excluded — they aren't in the room."
        actions={<BackToReports />}
      />
      <Suspense fallback={<ListTableSkeleton />}>
        <Table />
      </Suspense>
    </>
  );
}

async function Table() {
  const { items, summary } = await getStockCount();

  return (
    <ListTable
      columns={COLUMNS}
      total={items.length}
      empty={
        <>
          No asset in the catalogue has a unit in the fleet. Register hardware
          from Inventory → Assets and it appears here.
        </>
      }
      footerNote={
        <>
          {summary.free} free of {summary.total} units · {summary.out} out ·{" "}
          {summary.reserved} reserved · {summary.service} in service
        </>
      }
      rows={items.map((item) => ({
        id: item.id,
        href: `/dashboard/assets/${item.id}`,
        // Nothing free and something out is the line that stops a booking.
        flagged: item.free === 0 && item.out > 0,
        cells: {
          item: <span className="font-bold">{item.name}</span>,
          category: <span className="text-ink-muted">{item.category}</span>,
          free:
            item.free === 0 ? (
              <span className="font-bold text-accent-text">0</span>
            ) : (
              item.free
            ),
          out: <span className="text-ink-muted">{item.out}</span>,
          reserved: <span className="text-ink-muted">{item.reserved}</span>,
          service: <span className="text-ink-muted">{item.service}</span>,
          total: item.total,
        },
      }))}
    />
  );
}
