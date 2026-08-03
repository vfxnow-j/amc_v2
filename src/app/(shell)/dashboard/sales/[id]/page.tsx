import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardEmpty,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  ContractBillingCard,
  ContractLinesCard,
  ContractUnitsCard,
  LeaseUnitsCard,
} from "@/components/revenue/contract-cards";
import { dayYear, money, moneyExact } from "@/lib/format";
import {
  getContractKind,
  getContractOrder,
  getLease,
} from "@/lib/queries/contract-record";
import { LEASE_STATUS_LABEL } from "@/lib/revenue/labels";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/reservations/status";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const kind = await getContractKind(id);
  if (kind === "lease") {
    const lease = await getLease(id);
    return { title: lease?.leaseNumber ?? "Lease" };
  }
  const order = await getContractOrder(id);
  return { title: order?.reservationNumber ?? "Contract" };
}

/**
 * Revenue → Contracts → the record.
 *
 * One route over two entity types, because Contracts is a merge of three v1
 * screens over two models: a sale and a rent-to-own are `Reservation`s, a lease
 * is a `Lease`. The list links rows from all three tabs at this URL, so the
 * route works out which kind of id it was handed rather than making the link
 * declare it.
 *
 * The two halves share nothing but the card chrome, which is the same reason
 * the list gives leases their own view rather than a filter chip. A sale asks
 * what it cost and whether it has been paid for; a lease asks how far through
 * paying for itself it is.
 *
 * A sale's *operational* side — the lines to pull, the units to ship, check-out
 * — stays on the order record, which already does all of that and does it for
 * rentals too. This screen is the commercial view of the same order, and links
 * across rather than duplicating it.
 */
export default async function ContractRecordPage({ params }: Params) {
  const { id } = await params;
  const kind = await getContractKind(id);
  if (!kind) notFound();

  return kind === "lease" ? <LeaseRecord id={id} /> : <OrderRecord id={id} />;
}

async function OrderRecord({ id }: { id: string }) {
  const order = await getContractOrder(id);
  if (!order) notFound();

  const isRto = order.reservationType === "RENT_TO_OWN";

  return (
    <>
      <PageHeader
        eyebrow={`Revenue · ${TYPE_LABEL[order.reservationType]}`}
        title={order.reservationNumber}
        blurb={
          <>
            <Link
              href={`/dashboard/clients/${order.client.id}`}
              className="text-accent-text hover:underline"
            >
              {order.client.name}
            </Link>
            {order.projectName ? ` · ${order.projectName}` : ""} ·{" "}
            {dayYear(order.startDate)}
            {order.convertedFromNumber
              ? ` · converted from ${order.convertedFromNumber}`
              : ""}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {STATUS_LABEL[order.status]}
            </span>
            {/* The operational half of the same order. */}
            <Link
              href={`/dashboard/reservations/${order.id}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Open the order
            </Link>
          </>
        }
      />

      <section className="flex items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Contract" value={moneyExact(order.total)} loud />
        <Figure
          label="Cost"
          value={order.totalCost === null ? "—" : moneyExact(order.totalCost)}
        />
        <Figure
          label="Margin"
          value={
            order.totalMargin === null ? "—" : moneyExact(order.totalMargin)
          }
        />
        {isRto ? (
          <Figure
            label="Monthly"
            value={order.rtoMonthly === null ? "—" : moneyExact(order.rtoMonthly)}
          />
        ) : null}
        <p className="ml-auto max-w-[44ch] text-detail text-balance text-ink-muted">
          {/* The stored header figures are what v1 wrote when the order was
              priced; the line-level ones are recomputed live. They can disagree,
              so the record says which it is showing rather than quietly picking
              one. */}
          {order.totalCost === null
            ? "No cost was recorded on this contract when it was priced, so its margin is only what the lines below can prove."
            : "Cost and margin as stored when the contract was priced — the lines below recompute them from what is on the contract now."}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Lines" rows={10} />}>
          <ContractLinesCard id={id} />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          {isRto ? <RtoTerms order={order} /> : null}

          <Suspense fallback={<CardSkeleton title="Billing" rows={4} />}>
            <ContractBillingCard id={id} value={order.total} />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Units transferred" rows={3} />}>
            <ContractUnitsCard id={id} />
          </Suspense>

          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Terms">
                {order.paymentTerms ?? `${order.client.paymentTerms} days`}
              </Field>
              <Field label="Price checked">
                {order.priceVerified ? (
                  order.priceVerifiedAt ? (
                    dayYear(order.priceVerifiedAt)
                  ) : (
                    "Yes"
                  )
                ) : (
                  <Unset>Not verified</Unset>
                )}
              </Field>
              <Field label="Discount">
                {order.discountAmount > 0 ? (
                  moneyExact(order.discountAmount)
                ) : (
                  <Unset>None</Unset>
                )}
              </Field>
              <Field label="Tax">
                {order.taxAmount > 0 ? moneyExact(order.taxAmount) : <Unset>None</Unset>}
              </Field>
            </div>
            {order.notes || order.internalNotes ? (
              <div className="flex flex-col gap-2 px-4 pb-4 text-detail">
                {order.notes ? (
                  <p className="whitespace-pre-line text-ink-muted">
                    {order.notes}
                  </p>
                ) : null}
                {order.internalNotes ? (
                  <p className="whitespace-pre-line rounded-well bg-sunken p-2 text-ink-muted">
                    <span className="text-micro uppercase">Internal</span>
                    <br />
                    {order.internalNotes}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The financing terms of a rent-to-own.
 *
 * `rtoInstallmentsPaid` is a counter nothing increments yet — no billing run
 * touches it — so it is shown as what it is rather than turned into a
 * percentage that would read as progress nobody has made.
 */
function RtoTerms({
  order,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getContractOrder>>>;
}) {
  if (order.rtoTermMonths === null && order.rtoMonthly === null) {
    return (
      <Card title="Rent-to-own terms">
        <CardEmpty>
          No term, payment or buyout has been set on this agreement, so there is
          no schedule to pay down. Set them on the order before it is approved.
        </CardEmpty>
      </Card>
    );
  }

  const scheduled =
    order.rtoMonthly !== null ? order.installmentsPaid * order.rtoMonthly : 0;

  return (
    <Card
      title="Rent-to-own terms"
      meta={
        order.defaultCount > 0
          ? `${order.defaultCount} missed`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Term">
          {order.rtoTermMonths ? (
            `${order.rtoTermMonths} months`
          ) : (
            <Unset>Not set</Unset>
          )}
        </Field>
        <Field label="Monthly">
          {order.rtoMonthly === null ? (
            <Unset>Not set</Unset>
          ) : (
            moneyExact(order.rtoMonthly)
          )}
        </Field>
        <Field label="Buyout">
          {order.rtoBuyout === null ? (
            <Unset>Not set</Unset>
          ) : (
            moneyExact(order.rtoBuyout)
          )}
        </Field>
        <Field label="Started">
          {order.rtoStartDate ? (
            dayYear(order.rtoStartDate)
          ) : (
            <Unset>Not started</Unset>
          )}
        </Field>
      </div>
      <p className="px-4 pb-4 text-detail text-ink-muted">
        {order.installmentsPaid === 0
          ? "No installment has been recorded against this agreement. The counter is set by hand — nothing increments it as invoices are paid."
          : `${order.installmentsPaid} of ${order.rtoTermMonths ?? "?"} installments recorded${
              scheduled > 0 ? `, ${moneyExact(scheduled)} at the agreed rate` : ""
            }.`}
      </p>
    </Card>
  );
}

async function LeaseRecord({ id }: { id: string }) {
  const lease = await getLease(id);
  if (!lease) notFound();

  const coverage = lease.total > 0 ? lease.earned / lease.total : null;

  return (
    <>
      <PageHeader
        eyebrow="Revenue · Lease"
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
