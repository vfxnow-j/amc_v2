import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { ContractBillingCard } from "@/components/revenue/contract-cards";
import { dayYear, moneyExact } from "@/lib/format";
import { getContractOrder } from "@/lib/queries/contract-record";

type ContractOrder = NonNullable<Awaited<ReturnType<typeof getContractOrder>>>;

/**
 * The commercial half of an order, for the types that have one.
 *
 * A rental asks operational questions — what is pulled, what is out, when does
 * it come back. A sale and a rent-to-own ask commercial ones on top: what did
 * it cost us, what is the margin, and on an RTO, how far through paying it off
 * is the client. v2 answered those on a second record at a second URL; the same
 * order had two pages and neither said the other existed.
 *
 * These are the cards that used to live there, rendered inline on the one order
 * record when the type calls for them. Rentals and cloud orders never see them,
 * because for those there is nothing to say.
 */

/** Cost and margin, as stored when the order was priced. */
export async function MarginStrip({ id }: { id: string }) {
  const order = await getContractOrder(id);
  if (!order) return null;

  return (
    <section className="flex flex-wrap items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
      <Figure label="Contract" value={moneyExact(order.total)} loud />
      <Figure
        label="Cost"
        value={order.totalCost === null ? "—" : moneyExact(order.totalCost)}
      />
      <Figure
        label="Margin"
        value={order.totalMargin === null ? "—" : moneyExact(order.totalMargin)}
      />
      {order.reservationType === "RENT_TO_OWN" ? (
        <Figure
          label="Monthly"
          value={order.rtoMonthly === null ? "—" : moneyExact(order.rtoMonthly)}
        />
      ) : null}
      <p className="ml-auto max-w-[44ch] text-detail text-balance text-ink-muted">
        {/* The stored header figures are what was written when the order was
            priced; the line-level ones are recomputed live. They can disagree,
            so the record says which it is showing rather than quietly picking
            one. */}
        {order.totalCost === null
          ? "No cost was recorded on this order when it was priced, so its margin is only what the lines can prove."
          : "Cost and margin as stored when the order was priced — the lines recompute them from what is on it now."}
      </p>
    </section>
  );
}

export function MarginStripSkeleton() {
  return (
    <section className="h-[62px] animate-pulse rounded-card bg-panel shadow-sm" />
  );
}

/** Invoices raised against the order, and what is still owed. */
export async function OrderBillingCard({ id }: { id: string }) {
  const order = await getContractOrder(id);
  if (!order) return null;
  return <ContractBillingCard id={id} value={order.total} />;
}

/**
 * The financing terms of a rent-to-own.
 *
 * `rtoInstallmentsPaid` is a counter nothing increments — no billing run
 * touches it — so it is shown as what it is rather than turned into a
 * percentage that would read as progress nobody has made.
 */
export async function RtoTermsCard({ id }: { id: string }) {
  const order = await getContractOrder(id);
  if (!order) return null;

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
      meta={order.defaultCount > 0 ? `${order.defaultCount} missed` : undefined}
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

/** Commercial terms that only a sale or an RTO carries. */
export async function CommercialDetailsCard({ id }: { id: string }) {
  const order = await getContractOrder(id);
  if (!order) return null;

  return (
    <Card title="Commercial terms">
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
          {order.taxAmount > 0 ? (
            moneyExact(order.taxAmount)
          ) : (
            <Unset>None</Unset>
          )}
        </Field>
        {order.convertedFromNumber ? (
          <Field label="Converted from">{order.convertedFromNumber}</Field>
        ) : null}
      </div>
    </Card>
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
        className={`tabular-nums ${loud ? "text-kpi" : "text-[20px] font-bold tracking-[-0.02em]"}`}
      >
        {value}
      </span>
    </span>
  );
}

export type { ContractOrder };
