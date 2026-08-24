import Link from "next/link";
import { dayYear } from "@/lib/format";
import { getMaintenanceSummary } from "@/lib/queries/dashboard";

const DAY = 86_400_000;

/**
 * What is broken, being fixed, or about to fall out of cover.
 *
 * This replaces the Service center card that used to sit here, which still said
 * work orders "land here once the Service Center schema exists". That schema
 * landed in stage 5 and the screens have been live since — the card was telling
 * the owner a feature was missing while it was one click away in the rail.
 *
 * Oldest first, not newest. A work order opened this morning is not the one
 * that needs a decision; the reason maintenance is on a dashboard at all is the
 * unit that has been waiting six weeks for a part.
 */
export async function MaintenanceCard({ now = new Date() }: { now?: Date }) {
  const summary = await getMaintenanceSummary(now);

  return (
    <section className="flex min-h-0 flex-col rounded-card bg-panel p-[14px] shadow-sm">
      <header className="mb-2 flex items-baseline gap-2">
        <h2 className="text-card-title">In service</h2>
        <span className="text-detail text-ink-muted">
          {summary.unitsInService} {summary.unitsInService === 1 ? "unit" : "units"}{" "}
          out of bookable stock
        </span>
        <Link
          href="/dashboard/service/work-orders"
          className="ml-auto text-detail text-accent-text hover:underline"
        >
          Work orders →
        </Link>
      </header>

      <div className="mb-2 flex flex-wrap gap-2">
        <Stat label="Open" value={summary.openWorkOrders} />
        <Stat label="At RMA" value={summary.atRma} />
        <Stat
          label="Cover ending"
          value={summary.coverageExpiring}
          hint="within 90 days"
        />
      </div>

      {summary.oldest.length === 0 ? (
        <p className="text-detail text-ink-muted">
          No work orders are open. A unit flagged at check-in opens one, and it
          leaves bookable stock until it closes.
        </p>
      ) : (
        <ul className="flex flex-col gap-[2px]">
          {summary.oldest.map((row, index) => {
            const days = Math.floor((+now - +row.openedAt) / DAY);
            return (
              <li key={row.id}>
                <Link
                  href={`/dashboard/service/work-orders/${row.id}`}
                  className={`grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2 rounded-row px-2 py-[6px] transition-colors hover:bg-row-hover ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {row.assetName}
                    <span className="text-ink-faint"> · {row.fault}</span>
                  </span>
                  <span
                    className={`text-right text-detail tabular-nums ${
                      days >= 30 ? "font-bold text-accent-text" : "text-ink-muted"
                    }`}
                  >
                    {days === 0 ? "today" : `${days}d open`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {summary.coverageExpiring > 0 ? (
        <p className="mt-2 text-detail text-ink-muted">
          <Link
            href="/dashboard/service/coverage"
            className="text-accent-text hover:underline"
          >
            {summary.coverageExpiring} coverage{" "}
            {summary.coverageExpiring === 1 ? "window" : "windows"}
          </Link>{" "}
          close by {dayYear(new Date(+now + 90 * DAY))}.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <span className="flex min-w-[92px] flex-col rounded-well bg-sunken px-3 py-2">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em]">
        {value}
      </span>
      {hint ? <span className="text-detail text-ink-faint">{hint}</span> : null}
    </span>
  );
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section className="flex flex-col gap-2 rounded-card bg-panel p-[14px] shadow-sm">
      <div className="h-[17px] w-40 animate-pulse rounded-row bg-row-alt" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-[26px] animate-pulse rounded-row bg-row-alt" />
      ))}
    </section>
  );
}
