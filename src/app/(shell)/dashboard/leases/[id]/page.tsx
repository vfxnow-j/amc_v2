import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardEmpty,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import { LeaseUnitsCard } from "@/components/revenue/contract-cards";
import { dayYear, money } from "@/lib/format";
import { getLease } from "@/lib/queries/contract-record";
import { LEASE_STATUS_LABEL } from "@/lib/revenue/labels";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const lease = await getLease(id);
  return { title: lease?.leaseNumber ?? "Lease" };
}

/**
 * Revenue → Leases → the record.
 *
 * Lifted out of the old Contracts record, which served two entity types from
 * one URL and had to work out which it had been handed. It no longer does:
 * sales and rent-to-owns are orders and live on the order record, so a lease id
 * is the only thing that reaches this route.
 *
 * A lease asks how far through paying for itself it is; an order asks what it
 * cost and whether it has been settled. Those were always two questions, and
 * the "which kind is this?" lookup that used to sit in front of them was the
 * cost of pretending otherwise.
 */
export default async function LeaseRecordPage({ params }: Params) {
  const { id } = await params;
  return <LeaseRecord id={id} />;
}

async function LeaseRecord({ id }: { id: string }) {
  const lease = await getLease(id);
  if (!lease) notFound();

  const coverage = lease.total > 0 ? lease.earned / lease.total : null;

  return (
    <>
      <PageHeader
        eyebrow="Accounting · Lease"
        title={lease.leaseNumber}
        blurb={
          <>
            {lease.lender === "Unknown" ? "Lender not recorded" : lease.lender} ·{" "}
            {lease.unitCount} {lease.unitCount === 1 ? "unit" : "units"} financed
            · {dayYear(lease.startDate)} – {dayYear(lease.endDate)}
          </>
        }
        actions={
          <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
            {LEASE_STATUS_LABEL[lease.status]}
          </span>
        }
      />

      <section className="flex items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Borrowed" value={lease.unpriced ? "—" : money(lease.total)} loud />
        <Figure
          label="Paid on schedule"
          value={lease.unpriced ? "—" : money(lease.scheduledPaid)}
        />
        <Figure
          label="Left to pay"
          value={lease.unpriced ? "—" : money(lease.scheduledRemaining)}
        />
        <Figure label="Earned back" value={money(lease.earned)} />
        <p className="ml-auto max-w-[44ch] text-detail text-balance text-ink-muted">
          {lease.unpriced
            ? "No amount or payment is recorded against this lease — it was imported from the not-owned list as a name and its hardware, and nothing more."
            : lease.status === "PAID_OFF"
              ? `Paid off${lease.paidOffDate ? ` ${dayYear(lease.paidOffDate)}` : ""}. The hardware has earned ${money(lease.earned)} since.`
              : `${lease.elapsedMonths} of ${lease.termMonths} months elapsed. Paid is what the schedule says should have gone out, not what has — reconciling that needs the lender's statements.`}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Hardware financed" rows={12} />}>
          <LeaseUnitsCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Earning against it">
            {lease.unpriced ? (
              <CardEmpty>
                The hardware on this lease has earned {money(lease.earned)}, but
                with no amount borrowed recorded there is nothing to measure it
                against.
              </CardEmpty>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 px-4 pb-3">
                  <Field label="Earned">{money(lease.earned)}</Field>
                  <Field label="Of borrowed">
                    {coverage === null ? (
                      <Unset />
                    ) : (
                      `${(coverage * 100).toFixed(1)}%`
                    )}
                  </Field>
                  <Field label="Hardware cost">
                    {lease.hardwareCost > 0 ? (
                      money(lease.hardwareCost)
                    ) : (
                      <Unset>Not recorded</Unset>
                    )}
                  </Field>
                  <Field label="Monthly payment">
                    {money(lease.monthly)}
                  </Field>
                </div>
                <p className="px-4 pb-4 text-detail text-ink-muted">
                  Earned is rental income booked against these units since they
                  arrived — a real figure, unlike the paydown beside it. It is
                  income against the whole lease, not against the interest.
                </p>
              </>
            )}
          </Card>

          <Card title="Terms">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Lender">
                {lease.lender === "Unknown" ? (
                  <Unset>Not recorded</Unset>
                ) : (
                  lease.lender
                )}
              </Field>
              <Field label="Term">{lease.termMonths} months</Field>
              <Field label="Interest">
                {lease.interestRate > 0 ? (
                  `${(lease.interestRate * 100).toFixed(2)}%`
                ) : (
                  <Unset>Not recorded</Unset>
                )}
              </Field>
              <Field label="Payoff">
                {/* A zero payoff on a lease that also has no amount and no
                    payment is an import default, not a settled loan. */}
                {lease.payoff === null || (lease.payoff === 0 && lease.unpriced) ? (
                  <Unset>Not quoted</Unset>
                ) : (
                  money(lease.payoff)
                )}
              </Field>
              <Field label="Name">{lease.leaseName}</Field>
              <Field label="Ends">{dayYear(lease.endDate)}</Field>
            </div>
            {/* A data problem reported rather than repaired: every unit on a
                lease stores the lease's *whole* amount in `loanAmount`, not its
                share, so no per-unit financing figure exists. Summing the column
                would have read $751M on a $1.35M lease. One sentence, not a
                card — it is true of every lease here, and a card that always
                says "not available" is noise. */}
            {!lease.perUnitFinancing && lease.unitCount > 0 ? (
              <p className="px-4 pb-3 text-detail text-ink-muted">
                Each unit on this lease records the whole amount borrowed rather
                than its share, so there is no per-unit financing figure to show.
              </p>
            ) : null}
            {lease.notes ? (
              <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
                {lease.notes}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  loud,
}: {
  label: string;
  value: string;
  loud?: boolean;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"}`}
      >
        {value}
      </span>
    </span>
  );
}
