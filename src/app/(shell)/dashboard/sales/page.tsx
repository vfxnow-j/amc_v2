import { Suspense } from "react";
import { FilterTabs, FilterTabsSkeleton } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear, money } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/reservations/status";
import {
  CONTRACT_VIEWS,
  CONTRACT_VIEW_LABEL,
  LEASE_STATUS_LABEL,
  isContractView,
  type ContractView,
} from "@/lib/revenue/labels";
import {
  getContractCounts,
  getContractOrders,
  getLeases,
} from "@/lib/queries/revenue";

export const metadata = { title: "Contracts" };

/** Sales and rent-to-own share a shape: they're both orders. */
const ORDER_COLUMNS: Column[] = [
  { key: "number", label: "Order", width: "136px" },
  { key: "client", label: "Client", width: "minmax(0,1.4fr)" },
  { key: "started", label: "Started", width: "92px" },
  { key: "lines", label: "Lines", width: "60px", align: "right" },
  { key: "value", label: "Value", width: "96px", align: "right" },
  { key: "outstanding", label: "Outstanding", width: "104px", align: "right" },
  { key: "status", label: "State", width: "116px" },
];

/** Leases don't. Lender, payment and paydown have no analogue on an order. */
const LEASE_COLUMNS: Column[] = [
  { key: "number", label: "Lease", width: "128px" },
  { key: "name", label: "Name", width: "minmax(0,1.2fr)" },
  { key: "lender", label: "Lender", width: "minmax(0,1fr)" },
  { key: "units", label: "Units", width: "62px", align: "right" },
  { key: "monthly", label: "Monthly", width: "92px", align: "right" },
  { key: "remaining", label: "Left to pay", width: "104px", align: "right" },
  { key: "ends", label: "Ends", width: "88px" },
  { key: "status", label: "State", width: "96px" },
];

async function Tabs({ view }: { view: ContractView }) {
  const counts = await getContractCounts();
  return (
    <FilterTabs
      param="type"
      value={view}
      fallback="sales"
      label="Contract types"
      options={CONTRACT_VIEWS.map((option) => ({
        value: option,
        label: CONTRACT_VIEW_LABEL[option],
        count: counts[option],
      }))}
    />
  );
}

async function Orders({
  view,
  page,
}: {
  view: Exclude<ContractView, "leases">;
  page: number;
}) {
  const type = view === "sales" ? "SALE" : "RENT_TO_OWN";
  const { rows, total, pageSize } = await getContractOrders({ type, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: number) {
    const params = new URLSearchParams();
    if (view !== "sales") params.set("type", view);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/dashboard/sales?${query}` : "/dashboard/sales";
  }

  return (
    <ListTable
      columns={ORDER_COLUMNS}
      total={total}
      page={page}
      pageSize={pageSize}
      pagination={{ page, pages, hrefFor }}
      empty={
        view === "sales" ? (
          <>
            Nothing has been sold. A sale is an order whose kit doesn&rsquo;t
            come back — build one from the Reservations hub and set its type.
          </>
        ) : (
          <>
            No rent-to-own agreements. These are orders financed toward
            ownership, billed monthly.
          </>
        )
      }
      rows={rows.map((row) => ({
        id: row.id,
        href: `/dashboard/reservations/${row.id}`,
        cells: {
          number: (
            <span className="font-bold tabular-nums">
              {row.reservationNumber}
            </span>
          ),
          client: row.clientName,
          started: (
            <span className="tabular-nums text-ink-muted">
              {dayYear(row.startDate)}
            </span>
          ),
          lines: <span className="text-ink-muted">{row.lines || "—"}</span>,
          value: money(row.value),
          outstanding:
            row.outstanding > 0 ? (
              money(row.outstanding)
            ) : (
              <span className="text-ink-faint">—</span>
            ),
          status: (
            <span className="text-ink-muted">{STATUS_LABEL[row.status]}</span>
          ),
        },
      }))}
    />
  );
}

async function Leases() {
  const leases = await getLeases();

  return (
    <ListTable
      columns={LEASE_COLUMNS}
      total={leases.length}
      footerNote={
        // Says where the number comes from, because it is not a ledger balance.
        leases.length > 0 ? <>left to pay is scheduled, not reconciled</> : null
      }
      empty={
        <>
          No leases. A lease is hardware bought with borrowed money — it earns
          on rentals while it pays itself down, which is why it sits here rather
          than as a filter on sales.
        </>
      }
      rows={leases.map((lease) => ({
        id: lease.id,
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
 * Revenue → Contracts: the merge of v1's sales, rent-to-own and leases.
 *
 * Leases get their own **view**, not a filter chip (owner, 2026-07-28).
 * Sales and rent-to-own are both Reservations and share a table; a lease is a
 * financing instrument against units, with a lender, a monthly payment and a
 * paydown — none of which an order has. Filtering one table three ways would
 * have meant showing a lease with four empty columns.
 *
 * "Left to pay" is derived from elapsed term × monthly payment, because `Lease`
 * holds no running balance. It is labelled scheduled rather than reconciled:
 * the true figure lives on the lender's statements, which v2 does not have.
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view: ContractView = isContractView(params.type) ? params.type : "sales";
  const page = Math.max(1, Number(params.page) || 1);

  return (
    <>
      <PageHeader
        eyebrow="Revenue"
        title="Contracts"
        blurb="Sales, rent-to-own and the leases behind the fleet"
      />

      <div className="flex items-center gap-3">
        <Suspense fallback={<FilterTabsSkeleton width={300} />}>
          <Tabs view={view} />
        </Suspense>
      </div>

      <Suspense key={`${view}:${page}`} fallback={<ListTableSkeleton />}>
        {view === "leases" ? <Leases /> : <Orders view={view} page={page} />}
      </Suspense>
    </>
  );
}
