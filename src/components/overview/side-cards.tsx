import Link from "next/link";
import { getDecisions } from "@/lib/queries/overview";

/**
 * Service center: no data yet by design — WorkOrder and QcTestRun arrive with
 * the schema in step 5. The empty state names the next action rather than
 * showing a hollow table.
 */
export function ServiceCenterCard() {
  return (
    <section className="flex-none rounded-card bg-panel p-[14px] shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="text-card-title">Service center</h2>
        <span className="rounded-pill bg-accent-tint-strong px-[6px] py-px text-[9px] font-bold tracking-[0.1em] text-accent-on-tint">
          NEW
        </span>
      </header>
      <p className="text-detail text-ink-muted">
        Work orders and QC test runs land here once the Service Center schema
        exists. Until then, flag a failed unit from the desk at check-in.
      </p>
    </section>
  );
}

export async function DecisionsCard() {
  const decisions = await getDecisions();

  return (
    <section className="flex-none rounded-card bg-panel p-[14px] shadow-sm">
      <h2 className="text-card-title mb-2">Needs a decision</h2>

      {decisions.length === 0 ? (
        <p className="text-detail text-ink-muted">
          Nothing needs a call right now — no expiring quotes and no ageing
          invoices. Insights refresh as orders move.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {decisions.map((decision) => {
            const body = (
              <>
                <p className="text-body font-bold">{decision.title}</p>
                <p className="text-detail text-ink-muted">
                  {decision.description}
                </p>
              </>
            );

            return (
              <li key={decision.id}>
                {decision.link ? (
                  <Link
                    href={decision.link}
                    className="block rounded-well bg-row-alt p-[10px] transition-colors duration-[160ms] hover:bg-row-hover"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-well bg-row-alt p-[10px]">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SideCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <section className="flex-none rounded-card bg-panel p-[14px] shadow-sm">
      <div className="mb-3 h-4 w-32 animate-pulse rounded-row bg-sunken" />
      <div className="flex flex-col gap-[6px]">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-[52px] animate-pulse rounded-well bg-row-alt"
          />
        ))}
      </div>
    </section>
  );
}
