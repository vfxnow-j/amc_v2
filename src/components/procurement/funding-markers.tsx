import { moneyExact } from "@/lib/format";
import type { FundingMetrics } from "@/lib/utils/funding";

/**
 * The four payback markers v1 shows accounting: all-in cost, payback,
 * rental against the loan payment, and break-even.
 *
 * Every one is arithmetic over figures the requester typed — a rate they hope
 * to bill, a hold they expect, a resale they guess at — so the strip says it is
 * an estimate in its own heading, not in a footnote. Nothing here is measured:
 * no order has billed against this hardware when the request is written, and a
 * "14 mo" standing alone reads as a result.
 *
 * Renders in the record (a server component) and the form's live preview (a
 * client one), so it takes the computed metrics and nothing that reaches Prisma.
 */
export function FundingMarkers({ metrics }: { metrics: FundingMetrics }) {
  const payback =
    metrics.paybackMonths !== null ? `${metrics.paybackMonths} mo` : "—";
  const breakEven =
    metrics.breakEvenMonths !== null
      ? `${metrics.breakEvenMonths} mo`
      : metrics.neverBreaksEven
        ? "Never"
        : "—";

  return (
    <div className="rounded-well bg-sunken p-3">
      <p className="text-micro uppercase text-ink-muted">
        The requester&rsquo;s estimates · computed from the figures on this request, not measured returns
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        <Marker
          label="All-in cost"
          value={moneyExact(metrics.allInCost)}
          note={`includes ${moneyExact(metrics.financingCost)} financing`}
        />
        <Marker
          label="Payback"
          value={payback}
          note={
            metrics.statedPaybackMonths !== null
              ? `rentals only · request states ${metrics.statedPaybackMonths} mo`
              : metrics.paybackMonths === null
                ? "needs a monthly rental charge"
                : "rentals only"
          }
        />
        <Marker
          label="Rental ÷ payment"
          value={
            metrics.debtServiceCoverage !== null
              ? `${metrics.debtServiceCoverage.toFixed(2)}×`
              : "—"
          }
          note={
            metrics.debtServiceCoverage === null
              ? "needs a rental charge and a loan payment"
              : metrics.debtServiceCoverage < 1
                ? "the rental does not cover the payment"
                : "monthly charge over loan payment"
          }
          alarm={metrics.debtServiceCoverage !== null && metrics.debtServiceCoverage < 1}
        />
        <Marker
          label="Break-even"
          value={breakEven}
          note={
            metrics.neverBreaksEven
              ? "rentals and resale fall short of cost"
              : metrics.projectedNet !== null
                ? `incl. resale · ${moneyExact(metrics.projectedNet)} net over the hold`
                : "needs a revenue plan"
          }
          alarm={metrics.neverBreaksEven}
        />
      </div>
    </div>
  );
}

function Marker({
  label,
  value,
  note,
  alarm,
}: {
  label: string;
  value: string;
  note: string;
  alarm?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-micro uppercase text-ink-muted">{label}</p>
      <p
        className={`text-[18px] font-bold tabular-nums tracking-[-0.02em] ${alarm ? "text-accent-text" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="text-micro text-ink-faint">{note}</p>
    </div>
  );
}
