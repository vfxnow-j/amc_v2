import { getKpis } from "@/lib/queries/overview";
import type { Range } from "@/lib/queries/range";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat("en-US");

function Kpi({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="rounded-card bg-panel px-[14px] py-3 shadow-sm">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p className="text-kpi mt-1">{value}</p>
      <p className="mt-1 inline-block rounded-pill bg-sunken px-2 py-px text-pill text-ink-muted">
        {meta}
      </p>
    </div>
  );
}

/** The alert state: the one card that changes colour when it needs hands. */
function OverdueKpi({ units }: { units: number }) {
  if (units === 0) {
    return (
      <Kpi label="Overdue" value="None" meta="Every unit is inside its window" />
    );
  }

  return (
    <div className="rounded-card bg-accent-tint px-[14px] py-3 shadow-sm">
      <p className="text-micro uppercase text-accent-on-tint">Overdue</p>
      <p className="text-kpi mt-1 text-accent-text">
        {NUMBER.format(units)} {units === 1 ? "unit" : "units"}
      </p>
      <p className="mt-1 inline-block rounded-pill bg-panel px-2 py-px text-pill text-accent-on-tint">
        Past its return date
      </p>
    </div>
  );
}

export async function KpiRow({ range }: { range: Range }) {
  const kpis = await getKpis(range);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Utilisation"
        value={`${kpis.utilisation.percent.toFixed(1)}%`}
        // No delta pill: nothing snapshots utilisation over time yet.
        meta={`${NUMBER.format(kpis.units.onRent)} of ${NUMBER.format(kpis.units.total)} rentable`}
      />
      <Kpi
        label="Revenue earned"
        value={MONEY.format(kpis.revenue.earned)}
        meta={
          kpis.revenue.change === null
            ? `${MONEY.format(kpis.revenue.recurring)} of it recurring`
            : `${kpis.revenue.change >= 0 ? "+" : ""}${kpis.revenue.change.toFixed(1)}% on ${kpis.revenue.comparedTo}`
        }
      />
      <Kpi
        label="Units on rent"
        value={NUMBER.format(kpis.units.onRent)}
        meta={`of ${NUMBER.format(kpis.units.total)} rentable`}
      />
      <OverdueKpi units={kpis.overdue.units} />
    </div>
  );
}

/** Skeletons match the real card height so nothing reflows when data lands. */
export function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-[86px] animate-pulse rounded-card bg-panel shadow-sm"
        />
      ))}
    </div>
  );
}
