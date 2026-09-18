import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/reservations/record-cards";
import { getCoverage } from "@/lib/queries/service";
import { getEnrollmentBoard } from "@/lib/queries/coverage-enrollments";
import { PlanBoard } from "@/components/service/plan-board";
import { ENROLLMENT_STATUS_LABEL, ENROLLMENT_STATUSES } from "@/lib/coverage/labels";

export const metadata = { title: "Coverage & RMA" };

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
});

function daysUntil(date: Date, now: Date) {
  return Math.round((date.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Service center → Coverage & RMA.
 *
 * Two things that both mean "someone else is on the hook for this unit":
 * warranty about to lapse, and hardware physically away at a vendor. The window
 * is 90 days because that is long enough to renew or claim before it closes.
 *
 * Below them, every unit with a plan of its own (CoverageEnrollment) and where
 * that plan stands. Model-level coverage ("every Mac Studio comes with…") says
 * what a unit should have; this says what each one does — AppleCare+ bought on
 * a Melrose PO is "bought, unconfirmed" until somebody sees it on Apple's
 * record. A plan joins "Coverage closing" only once its end date is known.
 */
export default async function CoveragePage() {
  const [{ expiring: contracts, rma, now }, plans] = await Promise.all([
    getCoverage(),
    getEnrollmentBoard(),
  ]);
  const expiring = [
    ...contracts.map((row) => ({
      id: row.id,
      barcode: row.unit.barcode,
      name: row.name,
      by: row.provider ?? row.type.toLowerCase(),
      endDate: row.endDate,
      href: `/dashboard/units/${row.unit.id}`,
    })),
    ...plans.closing.map((row) => ({
      id: row.id,
      barcode: row.unit.barcode,
      name: row.name,
      by: row.provider ?? "plan",
      endDate: row.endDate,
      href: `/dashboard/units/${row.unit.id}`,
    })),
  ].sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  const planTally = ENROLLMENT_STATUSES.filter((status) => plans.counts[status] > 0)
    .map((status) => `${plans.counts[status]} ${ENROLLMENT_STATUS_LABEL[status].toLowerCase()}`)
    .join(" · ");

  return (
    <>
      <PageHeader
        eyebrow="Service center"
        title="Coverage & RMA"
        blurb={`${expiring.length} coverage ${expiring.length === 1 ? "window" : "windows"} closing within 90 days · ${rma.length} ${rma.length === 1 ? "unit" : "units"} away at a vendor · ${plans.total} ${plans.total === 1 ? "unit" : "units"} on a plan of their own`}
      />

      <div className="grid flex-1 gap-3 lg:grid-cols-2">
        <Card
          title="Coverage closing"
          meta={expiring.length > 0 ? "next 90 days, and anything already lapsed" : undefined}
        >
          {expiring.length === 0 ? (
            <p className="px-4 pb-4 text-body text-ink-muted">
              No warranty or support window closes in the next 90 days. Coverage
              is recorded against a unit from its record.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
              {expiring.map((row, index) => {
                const days = daysUntil(row.endDate, now);
                const lapsed = days < 0;
                return (
                  <li
                    key={row.id}
                    className={`grid grid-cols-[92px_1fr_104px] items-center gap-2 rounded-row p-2 text-detail ${
                      lapsed ? "bg-accent-tint" : index % 2 === 1 ? "bg-row-alt" : ""
                    }`}
                  >
                    <Link href={row.href} className="truncate font-bold hover:underline">
                      {row.barcode}
                    </Link>
                    <span className="truncate">
                      {row.name}
                      <span className="text-ink-faint"> · {row.by}</span>
                    </span>
                    <span
                      className={
                        lapsed ? "font-bold text-accent-text" : "text-ink-muted"
                      }
                    >
                      {lapsed
                        ? `Lapsed ${DAY.format(row.endDate)}`
                        : `${days}d · ${DAY.format(row.endDate)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Out at RMA" meta={rma.length > 0 ? `${rma.length} open` : undefined}>
          {rma.length === 0 ? (
            <p className="px-4 pb-4 text-body text-ink-muted">
              Nothing is away at a vendor. Moving a work order to RMA lists it
              here until it closes.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2 pb-3">
              {rma.map((row, index) => (
                <li key={row.id}>
                  <Link
                    href={`/dashboard/service/work-orders/${row.id}`}
                    className={`grid grid-cols-[108px_92px_1fr_64px] items-center gap-2 rounded-row p-2 text-detail ${
                      index % 2 === 1 ? "bg-row-alt" : ""
                    } hover:bg-row-hover`}
                  >
                    <span className="truncate font-bold">{row.number}</span>
                    <span className="truncate">{row.assetUnit.barcode}</span>
                    <span className="truncate">{row.fault}</span>
                    <span className="text-right text-ink-muted">
                      {Math.max(0, -daysUntil(row.openedAt, now))}d
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Plans by unit"
          meta={plans.total > 0 ? planTally : undefined}
          className="lg:col-span-2"
        >
          {plans.total === 0 ? (
            <p className="px-4 pb-4 text-body text-ink-muted">
              No unit has a plan of its own yet. A plan bought on a purchase
              order — AppleCare+ on a Melrose Mac order — is recorded against
              each unit it covers, and added by hand from a unit&rsquo;s record.
            </p>
          ) : (
            <PlanBoard models={plans.models} />
          )}
        </Card>
      </div>
    </>
  );
}
