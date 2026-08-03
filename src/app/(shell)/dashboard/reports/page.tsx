import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { REPORTS } from "@/components/reports/directory";
import { money, moneyCompact } from "@/lib/format";
import { getAssetUtilizationReport } from "@/lib/actions/reports";
import { getReportsHeader } from "@/lib/queries/reports";

export const metadata = { title: "Reports" };

/**
 * Insight → Reports.
 *
 * A directory and two panels, not a second Overview. v1's index was a full
 * dashboard — utilisation, revenue trend, overdue counts, top clients — and
 * every one of those figures now has a home on the Overview, which is one
 * click away in the same cluster. Two screens computing the same number two
 * ways is how they come to disagree.
 *
 * What it keeps is what Overview doesn't say: which report answers which
 * question, where the fleet's time actually went, and the gap between what the
 * business earned and what it has invoiced for.
 */
export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Reports"
        blurb={
          <Suspense fallback="Counting…">
            <HeaderBlurb />
          </Suspense>
        }
      />

      <Card title="The six reports" meta="what each one answers">
        <ul className="grid gap-[2px] px-2 pb-3 sm:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((report) => (
            <li key={report.href}>
              <Link
                href={report.href}
                className="block h-full rounded-row px-2 py-2 transition-colors duration-[160ms] hover:bg-row-hover"
              >
                <span className="block text-body font-bold">{report.title}</span>
                <span className="block text-detail text-ink-muted">
                  {report.answers}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton title="Where the time went" rows={8} />}>
          <UtilisationCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton title="Earned against billed" rows={5} />}>
          <RevenueCard />
        </Suspense>
      </div>
    </>
  );
}

async function HeaderBlurb() {
  const header = await getReportsHeader();
  return (
    <>
      {header.assets} assets · {header.fleet} units in fleet, {header.out} out ·{" "}
      {moneyCompact(header.earned.total)} earned this year
    </>
  );
}

/**
 * Checkout activity by category over the last three months.
 *
 * Counts and days out, not a percentage of anything. A utilisation *rate*
 * needs a denominator — hours available in the window — and nothing in the
 * schema records when a unit was withdrawn from service, so any rate would be
 * a guess dressed as a measurement. v1 drew a progress bar against an
 * arbitrary doubled fraction of total checkouts, which is a picture of nothing.
 */
async function UtilisationCard() {
  const report = await getAssetUtilizationReport();
  const rows = [...report.utilizationByCategory].sort(
    (a, b) => b.checkoutCount - a.checkoutCount,
  );

  return (
    <Card
      title="Where the time went"
      meta={`${report.totalCheckouts} movements, last 3 months`}
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Nothing has moved in three months. Check a unit out from an order and
          the categories appear here.
        </CardEmpty>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_84px_84px_84px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
            <span>Category</span>
            <span className="text-right">Movements</span>
            <span className="text-right">Days out</span>
            <span className="text-right">Avg days</span>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
            {rows.map((row, index) => (
              <li
                key={row.category}
                className={`grid grid-cols-[1fr_84px_84px_84px] items-center gap-2 rounded-row px-2 py-[6px] text-detail ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
              >
                <span className="truncate">{row.category}</span>
                <span className="text-right tabular-nums">
                  {row.checkoutCount}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {row.totalDays}
                </span>
                <span className="text-right tabular-nums text-ink-muted">
                  {row.avgDaysPerCheckout}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * The gap between earned and billed, said out loud.
 *
 * Every revenue figure in the ported reports module sums invoices at status
 * PAID. Nothing in this database is marked paid, so all of them read $0 — and
 * a report that says the business made nothing is worse than one that says
 * where the money is. Earned is the Overview's accrual basis; billed is what
 * has actually been asked for. The difference is the work.
 */
async function RevenueCard() {
  const header = await getReportsHeader();
  const { earned, invoiced } = header;

  const types: [string, number][] = [
    ["Rentals", earned.byType.RENTAL],
    ["Sales", earned.byType.SALE],
    ["Rent to own", earned.byType.RENT_TO_OWN],
    ["Cloud", earned.byType.CLOUD],
  ];

  return (
    <Card title="Earned against billed" meta="this calendar year">
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Figure label="Earned" value={money(earned.total)} loud />
        <Figure
          label="Invoiced"
          value={money(invoiced.total)}
          note={`${invoiced.count} raised · ${money(invoiced.paid)} collected`}
        />
      </div>

      <ul className="flex flex-col gap-px px-2 pb-3">
        {types.map(([label, value]) => (
          <li
            key={label}
            className="grid grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
          >
            <span className="text-ink-muted">{label}</span>
            <span className="tabular-nums">{money(value)}</span>
          </li>
        ))}
        <li className="grid grid-cols-[1fr_auto] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail">
          <span className="text-ink-muted">of which recurring</span>
          <span className="tabular-nums">{money(earned.recurring)}</span>
        </li>
      </ul>

      <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
        Earned is accrued: a recurring order earns one cycle per elapsed
        period, a rental earns at check-out, a sale at completion — whether or
        not an invoice was ever cut. It is the same basis the Overview uses.
        Invoiced counts everything raised except drafts and voids, and{" "}
        {money(invoiced.owed)} of it is still owed.
      </p>
    </Card>
  );
}

function Figure({
  label,
  value,
  note,
  loud,
}: {
  label: string;
  value: string;
  note?: string;
  loud?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"}`}
      >
        {value}
      </span>
      {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
    </div>
  );
}
