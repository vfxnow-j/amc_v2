import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, money } from "@/lib/format";
import { LEASE_STATUS_LABEL } from "@/lib/accounting/labels";
import { getLeases } from "@/lib/queries/accounting";

export const metadata = { title: "Leases" };

/** Lease · Name · Lender · Units · Monthly · Left to pay · Ends · State */
const COLUMNS: Column[] = [
  { key: "number", label: "Lease", width: "128px" },
  { key: "name", label: "Name", width: "minmax(0,1.2fr)" },
  { key: "lender", label: "Lender", width: "minmax(0,1fr)" },
  { key: "units", label: "Units", width: "62px", align: "right" },
  { key: "monthly", label: "Monthly", width: "92px", align: "right" },
  { key: "remaining", label: "Left to pay", width: "104px", align: "right" },
  { key: "ends", label: "Ends", width: "88px" },
  { key: "status", label: "State", width: "96px" },
];

async function Leases() {
  const leases = await getLeases();

  return (
    <ListTable
      columns={COLUMNS}
      total={leases.length}
      footerNote={
        // Says where the number comes from, because it is not a ledger balance.
        leases.length > 0 ? <>left to pay is scheduled, not reconciled</> : null
      }
      empty={
        <>
          No leases. A lease is hardware bought with borrowed money — it earns on
          rentals while it pays itself down, which is why it is its own screen
          rather than a type of order.
        </>
      }
      rows={leases.map((lease) => ({
        id: lease.id,
        href: `/dashboard/leases/${lease.id}`,
        cells: {
          number: (
            <span className="font-bold tabular-nums">{lease.leaseNumber}</span>
          ),
          name: lease.leaseName,
          lender: <span className="text-ink-muted">{lease.lender}</span>,
          units: lease.units || <span className="text-ink-faint">—</span>,
          monthly: money(lease.monthly),
          remaining:
            lease.scheduledRemaining > 0 ? (
              money(lease.scheduledRemaining)
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          ends: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(lease.endDate)}
            </span>
          ),
          status: (
            <span className="text-ink-muted">
              {LEASE_STATUS_LABEL[lease.status]}
            </span>
          ),
        },
      }))}
    />
  );
}

/**
 * Revenue → Leases.
 *
 * What is left of the old Contracts screen once sales and rent-to-own go where
 * they belong. Both of those are `Reservation` rows — orders — and they now sit
 * in Operate → Orders behind a type filter, with the same client, the same
 * lines and the same record as every other order.
 *
 * A lease is not an order and never was. It is money owed to a *lender* for
 * hardware the business bought: no client, no lines, no window, and a paydown
 * instead of a settlement. Folding it into Orders would have meant a row with
 * four empty columns and a record that answered the wrong question, so it keeps
 * its own screen (owner's call, 2026-07-28).
 *
 * "Left to pay" is derived from elapsed term × monthly payment, because `Lease`
 * holds no running balance. It is labeled scheduled rather than reconciled:
 * the true figure lives on the lender's statements, which v2 does not have.
 */
export default async function LeasesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Leases"
        blurb="The financing behind the fleet — what the business borrowed to buy hardware, and how far through paying it is"
      />

      <Suspense fallback={<ListTableSkeleton />}>
        <Leases />
      </Suspense>
    </>
  );
}
