import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/reservations/record-cards";
import { getCoverage } from "@/lib/queries/service";

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
 * Service centre → Coverage & RMA.
 *
 * Two things that both mean "someone else is on the hook for this unit":
 * warranty about to lapse, and hardware physically away at a vendor. The window
 * is 90 days because that is long enough to renew or claim before it closes.
 */
export default async function CoveragePage() {
  const { expiring, rma, now } = await getCoverage();

  return (
    <>
      <PageHeader
        eyebrow="Service centre"
        title="Coverage & RMA"
        blurb={`${expiring.length} coverage ${expiring.length === 1 ? "window" : "windows"} closing within 90 days · ${rma.length} ${rma.length === 1 ? "unit" : "units"} away at a vendor`}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
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
                    <span className="truncate font-bold">{row.unit.barcode}</span>
                    <span className="truncate">
                      {row.name}
                      <span className="text-ink-faint">
                        {" "}
                        · {row.provider ?? row.type.toLowerCase()}
                      </span>
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
      </div>
    </>
  );
}
