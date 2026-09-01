import { Card, Field, Unset } from "@/components/record/record-card";
import { dayYear, moneyExact } from "@/lib/format";
import {
  EditBillingTerms,
  InvoiceButton,
} from "@/components/orders/order-actions";
import { getOrderLifecycle } from "@/lib/queries/order-lifecycle";
import type { BillingTerms } from "@/lib/actions/order-stage";
import type { BillingCycleType, ReservationType } from "@/generated/prisma/client";

const CYCLE_LABEL: Record<BillingCycleType, string> = {
  ONE_TIME: "Once, for the whole term",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BI_WEEKLY: "Every fortnight",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What the order bills on, and what has been billed.
 *
 * The columns behind this were all there and none of them were on screen, which
 * meant the one question that decides whether an order earns anything — is it a
 * one-off or does it recur, and when does the next invoice go out — could only
 * be answered by reading the database. `runBillingCycle` reads
 * `nextBillingDate`, so an order with a cycle and no next date is an order that
 * will never be picked up; that case is named here rather than left to be
 * discovered a month later.
 *
 * The two buttons are the two different acts. Editing the terms changes what
 * every future invoice looks like; creating one raises a single invoice now,
 * out of cycle, which is what the first charge on activation and any late
 * billing actually are.
 */
export async function BillingTermsCard({
  id,
  type,
}: {
  id: string;
  type: ReservationType;
}) {
  const order = await getOrderLifecycle(id);
  if (!order) return null;

  const { billing, invoiced } = order;
  const terms: BillingTerms = {
    billingCycleType: billing.cycleType,
    billingCycleDay: billing.cycleDay,
    billingCycleDays: billing.cycleDays,
    isRecurring: billing.isRecurring,
    notBilled: billing.notBilled,
    taxRate: billing.taxRate,
    discountType: billing.discountType,
    discountValue: billing.discountValue,
    paymentTerms: billing.paymentTerms,
  };

  const recurring = billing.cycleType !== "ONE_TIME" && billing.isRecurring;
  const onCycle = recurring && !billing.notBilled;

  const when =
    billing.cycleType === "MONTHLY"
      ? `day ${billing.cycleDay} of the month`
      : billing.cycleType === "WEEKLY"
        ? `every ${WEEKDAYS[billing.cycleDay] ?? "week"}`
        : billing.cycleType === "CUSTOM"
          ? `every ${billing.cycleDays ?? "?"} days`
          : null;

  return (
    <Card
      title="Billing terms"
      meta={billing.notBilled ? "not billed" : recurring ? "recurring" : "one time"}
      action={
        <span className="flex items-center gap-2">
          <EditBillingTerms
            id={id}
            terms={terms}
            total={billing.total}
            clientPaymentTerms={order.client.paymentTerms}
            type={type}
          />
          <InvoiceButton
            id={id}
            notBilled={billing.notBilled}
            dueDays={billing.paymentTerms ?? order.client.paymentTerms}
          />
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Cycle">
          {CYCLE_LABEL[billing.cycleType]}
          {when ? <span className="block text-micro text-ink-faint">{when}</span> : null}
        </Field>
        <Field label="Next invoice">
          {billing.notBilled ? (
            <Unset>Never</Unset>
          ) : billing.cycleType === "ONE_TIME" ? (
            <Unset>Not on a cycle</Unset>
          ) : billing.nextBillingDate ? (
            dayYear(billing.nextBillingDate)
          ) : (
            <Unset>Not scheduled</Unset>
          )}
        </Field>
        <Field label="Discount">
          {billing.discountType && billing.discountValue > 0 ? (
            <>
              {billing.discountType === "PERCENTAGE"
                ? `${billing.discountValue}%`
                : moneyExact(billing.discountValue)}
              <span className="block text-micro text-ink-faint">
                {moneyExact(billing.discountAmount)} off
              </span>
            </>
          ) : (
            <Unset>None</Unset>
          )}
        </Field>
        <Field label="Tax">
          {billing.taxRate > 0 ? `${billing.taxRate}%` : <Unset>None</Unset>}
        </Field>
        <Field label="Terms">
          {billing.paymentTerms != null ? (
            `${billing.paymentTerms} days`
          ) : (
            <>
              {order.client.paymentTerms} days
              <span className="block text-micro text-ink-faint">
                the client&rsquo;s default
              </span>
            </>
          )}
        </Field>
        <Field label="Invoiced">
          {invoiced.count === 0 ? (
            <Unset>Nothing yet</Unset>
          ) : (
            <>
              {moneyExact(invoiced.billed)}
              <span className="block text-micro text-ink-faint">
                {moneyExact(invoiced.paid)} paid over {invoiced.count}
                {invoiced.count === 1 ? " invoice" : " invoices"}
              </span>
            </>
          )}
        </Field>
      </div>

      <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
        {billing.notBilled
          ? "Marked not billed, so the billing run skips it entirely. It still tracks units, location and revenue — it just never raises an invoice."
          : onCycle && !billing.nextBillingDate
            ? "This order recurs but has no next billing date, so the billing run will not pick it up. Save its terms again to schedule one."
            : onCycle
              ? `${billing.periodsCompleted} ${billing.periodsCompleted === 1 ? "period has" : "periods have"} been invoiced${
                  billing.lastBilledDate ? `, the last on ${dayYear(billing.lastBilledDate)}` : ""
                }${
                  billing.recurrenceEndDate
                    ? `. Recurs until ${dayYear(billing.recurrenceEndDate)}.`
                    : ". No end date is set, so it recurs until the order is completed."
                }`
              : recurring
                ? "Set to recur, but the billing run only picks up active orders — activate it to start the cycle."
                : `A single charge of ${moneyExact(billing.total)} covering the whole term. Raise it with Create invoice.`}
      </p>
    </Card>
  );
}
