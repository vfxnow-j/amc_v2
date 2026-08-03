import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardEmpty, CardSkeleton } from "@/components/record/record-card";
import { BackToReports } from "@/components/reports/directory";
import { KpiForm } from "@/components/reports/kpi-form";
import { LEAD_STATUS_LABEL } from "@/lib/clients/labels";
import { money } from "@/lib/format";
import { getForecastReport, getKpiTargets } from "@/lib/actions/reports";
import { getRecurringBillingHealth } from "@/lib/queries/reports";
import { STATUS_LABEL } from "@/lib/reservations/status";
import type { LeadStatus } from "@/generated/prisma/client";

export const metadata = { title: "Forecast" };

/**
 * Reports → Forecast.
 *
 * Three months out, every line weighted by how firm it is: an active order
 * counts at full value, a draft at four-tenths, a lead by the stage it has
 * reached. Those weights are v1's and they are not shown as a footnote here —
 * the card at the bottom reads them back out of the data itself, so it can
 * never drift from what the arithmetic actually used.
 *
 * **Recurring orders are counted once per billing month**, from
 * `nextBillingDate`, and separately from the confirmed column — a rolling
 * contract's `total` is one cycle, not the value of the contract, and adding it
 * to the confirmed figure would count the same money in all three months.
 *
 * Targets are real, and were half-written off. The build plan lists "revenue vs
 * target" as an unbacked figure on the grounds that no target exists in the
 * schema; in fact `Setting` rows keyed `kpi_YYYY-MM` hold target, expenses and
 * payroll, and both the read and the write came across from v1. What is missing
 * is the numbers — nothing in this database has ever had one set. So the card
 * says the target is unset and offers the form, rather than printing "0% of
 * target" against a zero nobody chose.
 */
export default function ForecastPage() {
  return (
    <>
      <PageHeader
        eyebrow="Insight · Reports"
        title="Forecast"
        blurb="The next three months, weighted by how firm each order and lead is."
        actions={<BackToReports />}
      />
      <Suspense fallback={<CardSkeleton title="Next three months" rows={10} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const report = await getForecastReport();
  const [targets, recurring] = await Promise.all([
    getKpiTargets(report.months.map((month) => month.month)),
    getRecurringBillingHealth(),
  ]);

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <Card
          title="Next three months"
          meta={`${money(report.totalPipeline)} weighted in total`}
        >
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
            {report.months.map((month) => {
              const target = targets[month.month] ?? null;
              const share =
                target && target.revenueTarget > 0
                  ? Math.round((month.totalForecast / target.revenueTarget) * 100)
                  : null;

              return (
                <div key={month.month} className="rounded-well bg-sunken p-3">
                  <p className="text-micro uppercase text-ink-muted">
                    {month.label}
                  </p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums tracking-[-0.02em]">
                    {money(month.totalForecast)}
                  </p>
                  <p className="text-micro text-ink-faint">
                    {share === null
                      ? "no target set"
                      : `${share}% of ${money(target!.revenueTarget)}`}
                  </p>

                  <ul className="mt-2 flex flex-col gap-px text-detail">
                    <Line label="Confirmed" value={month.confirmed} />
                    <Line label="Recurring" value={month.recurring} />
                    <Line label="Quotes & drafts" value={month.drafts} />
                    <Line label="Leads" value={month.leadPipeline} />
                  </ul>

                  <ul className="mt-2 flex flex-col gap-px border-t border-hairline pt-2 text-detail">
                    <Line label="Invoiced" value={month.invoiced} muted />
                    <Line label="Collected" value={month.paid} muted />
                  </ul>

                  <div className="mt-2">
                    <KpiForm
                      month={month.month}
                      label={month.label}
                      targets={target}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {recurring.stranded > 0 ? (
            // Not smoothed over and not guessed at. A forecast that quietly
            // omits contracted income is worse than one that says so.
            <p className="mx-4 mb-3 rounded-well bg-accent-tint p-2 text-detail text-balance text-accent-on-tint">
              <span className="font-bold">
                Recurring is understated by {recurring.stranded} of{" "}
                {recurring.live} live recurring{" "}
                {recurring.live === 1 ? "order" : "orders"}.
              </span>{" "}
              Their next billing date has already passed, so they fall into no
              future month — the nightly job that advances it doesn&rsquo;t run
              in v2. Between them they bill {money(recurring.perCycle)} a cycle,
              and none of it is in the figures above. No schedule has been
              invented for them.
            </p>
          ) : null}

          <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
            Recurring is counted once per billing month from each order&rsquo;s
            next billing date, and kept out of Confirmed — a rolling
            contract&rsquo;s total is one cycle, not the value of the contract,
            so adding it to Confirmed would count the same money three times.
            Lead pipeline is spread evenly across the three months: nothing
            records when a lead is expected to land.
          </p>
        </Card>

        <WeightsCard report={report} />
      </div>

      <Card
        title="Lead pipeline"
        meta={`${money(report.totalLeadPipeline)} weighted`}
      >
        {report.leadsByStage.length === 0 ? (
          <CardEmpty>
            No open lead carries an estimated value, so none of them can be
            forecast. Put a figure on one from its record and it appears here.
          </CardEmpty>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_56px_92px_92px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
              <span>Stage</span>
              <span className="text-right">Leads</span>
              <span className="text-right">Asked</span>
              <span className="text-right">Weighted</span>
            </div>
            <ul className="flex flex-col gap-px px-2 pb-3">
              {report.leadsByStage.map((stage, index) => (
                <li
                  key={stage.stage}
                  className={`grid grid-cols-[1fr_56px_92px_92px] items-center gap-2 rounded-row px-2 py-[6px] text-detail ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="truncate">
                    {LEAD_STATUS_LABEL[stage.stage as LeadStatus] ?? stage.stage}
                  </span>
                  <span className="text-right tabular-nums">{stage.count}</span>
                  <span className="text-right tabular-nums text-ink-muted">
                    {money(stage.rawValue)}
                  </span>
                  <span className="text-right tabular-nums">
                    {money(stage.weightedValue)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-3 text-detail text-ink-muted">
              Only leads with an estimated value on them are here — one is
              counted at the stage it has reached, not at what it might become.
            </p>
          </>
        )}

        {report.leadItems.length > 0 ? (
          <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto border-t border-hairline px-2 py-3">
            {report.leadItems.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="grid grid-cols-[1fr_80px_88px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
                >
                  <span className="truncate">
                    <span className="font-bold">{lead.name}</span>
                    {lead.companyName ? (
                      <span className="text-ink-muted"> · {lead.companyName}</span>
                    ) : null}
                  </span>
                  <span className="truncate text-ink-muted">
                    {LEAD_STATUS_LABEL[lead.stage as LeadStatus] ?? lead.stage}
                  </span>
                  <span className="text-right tabular-nums">
                    {money(lead.weightedValue)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-2">
      <span className="text-ink-muted">{label}</span>
      <span className={`tabular-nums ${muted ? "text-ink-muted" : ""}`}>
        {money(value)}
      </span>
    </li>
  );
}

/**
 * The weights, read back out of the forecast itself.
 *
 * Every line item carries the weight it was multiplied by, so this lists what
 * the arithmetic actually used rather than restating a constant from another
 * module — which is the version that goes quietly wrong when somebody tunes it.
 */
function WeightsCard({
  report,
}: {
  report: Awaited<ReturnType<typeof getForecastReport>>;
}) {
  const seen = new Map<string, number>();
  for (const month of report.months) {
    for (const item of [
      ...month.confirmedItems,
      ...month.draftItems,
      ...month.recurringItems,
    ]) {
      seen.set(
        STATUS_LABEL[item.status as keyof typeof STATUS_LABEL] ?? item.status,
        item.weight,
      );
    }
  }
  for (const lead of report.leadItems) {
    seen.set(`Lead · ${LEAD_STATUS_LABEL[lead.stage as LeadStatus] ?? lead.stage}`, lead.weight);
  }

  const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <Card title="How it is weighted" meta="from the figures above">
      {rows.length === 0 ? (
        <CardEmpty>
          Nothing is in the forecast window, so nothing has been weighted.
        </CardEmpty>
      ) : (
        <ul className="flex flex-wrap gap-[6px] px-4 pb-4">
          {rows.map(([label, weight]) => (
            <li
              key={label}
              className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted"
            >
              {label}{" "}
              <span className="text-ink">{Math.round(weight * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
