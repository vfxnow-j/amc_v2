import Link from "next/link";
import { Card, CardEmpty } from "@/components/record/record-card";
import { dayYear, money } from "@/lib/format";
import { VENDOR_SPEND_MONTHS, getVendorSpend } from "@/lib/queries/procurement";

/**
 * Received spend per vendor over the trailing twelve months.
 *
 * Received POs only, dated by when they were received. It is a ranking of what
 * actually landed, not what was promised — open orders are Committed, above.
 */
export async function OverviewVendors() {
  const spend = await getVendorSpend();

  return (
    <Card
      title="Spend by vendor"
      meta={`received since ${dayYear(spend.since)}`}
    >
      {spend.rows.length === 0 ? (
        <CardEmpty>
          No PO has been received in the last {VENDOR_SPEND_MONTHS} months.
          Receive an open PO and its vendor appears here with what it cost.
        </CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_48px_112px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
            <span>Vendor</span>
            <span className="text-right">POs</span>
            <span className="text-right">Received</span>
          </div>
          <ul className="flex flex-col gap-[2px] px-2">
            {spend.rows.map((row, index) => (
              <li key={row.vendorId}>
                <Link
                  href={`/dashboard/vendors/${row.vendorId}`}
                  className={`grid grid-cols-[1fr_48px_112px] items-center gap-2 rounded-row px-2 py-[6px] text-detail transition-colors duration-[160ms] hover:bg-row-hover ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="truncate">{row.name}</span>
                  <span className="text-right tabular-nums text-ink-muted">{row.count}</span>
                  <span className="text-right tabular-nums">{money(row.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-4 pt-2 pb-4 text-detail text-balance text-ink-muted">
            {money(spend.total)} across {spend.orderCount} received{" "}
            {spend.orderCount === 1 ? "PO" : "POs"} and {spend.rows.length}{" "}
            {spend.rows.length === 1 ? "vendor" : "vendors"}, on order totals
            (freight, fees and tax included), dated by the day each was
            received.{" "}
            {spend.partialCount > 0
              ? `${spend.partialCount} part-received ${spend.partialCount === 1 ? "PO is" : "POs are"} not in it — ${spend.partialCount === 1 ? "its" : "their"} value is under Committed.`
              : "Part-received POs would be under Committed; there are none."}{" "}
            Drafts and cancellations are never spend.
            {spend.undatedCount > 0
              ? ` ${spend.undatedCount} received ${spend.undatedCount === 1 ? "PO has" : "POs have"} no received date and cannot be placed in the window.`
              : null}
          </p>
        </>
      )}
    </Card>
  );
}
