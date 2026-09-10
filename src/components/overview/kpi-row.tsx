import { Kpi, Tile } from "@/components/dashboard/tile";
import { getKpis } from "@/lib/queries/overview";
import type { Range } from "@/lib/queries/range";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat("en-US");

/**
 * `Kpi` used to live here, module-private. It now lives in
 * `components/dashboard/tile.tsx` and is exported, because a KPI is the
 * smallest tile the picker can place and the alert state was already written
 * twice in this file.
 */

/** The alert state: the one card that changes color when it needs hands. */
function OverdueKpi({ units }: { units: number }) {
  if (units === 0) {
    return (
      <Kpi label="Overdue" value="None" meta="Every unit is inside its window" />
    );
  }

  return (
    <Kpi
      tone="alert"
      label="Overdue"
      value={`${NUMBER.format(units)} ${units === 1 ? "unit" : "units"}`}
      meta="Past its return date"
    />
  );
}

export async function KpiRow({ range }: { range: Range }) {
  const kpis = await getKpis(range);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Utilization"
        value={`${kpis.utilization.percent.toFixed(1)}%`}
        // No delta pill: nothing snapshots utilization over time yet.
        meta={`${NUMBER.format(kpis.units.onRent)} of ${NUMBER.format(kpis.units.total)} rentable`}
      />
      <Kpi
        label={kpis.revenue.excludesRecurring ? "Rentals & sales" : "Revenue earned"}
        value={MONEY.format(kpis.revenue.earned)}
        meta={
          kpis.revenue.change === null
            ? `${MONEY.format(kpis.revenue.recurring)} recurring on top`
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
        <Tile key={index} pad="kpi" className="h-[86px] animate-pulse" />
      ))}
    </div>
  );
}
