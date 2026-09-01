import Link from "next/link";
import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { dayYear, moneyExact } from "@/lib/format";
import {
  EditBillingTerms,
  InvoiceButton,
} from "@/components/orders/order-actions";
import { getOrderLifecycle } from "@/lib/queries/order-lifecycle";
import type { BillingTerms } from "@/lib/actions/order-stage";
import type {
  BillingCycleType,
  InvoiceStatus,
  ReservationType,
} from "@/generated/prisma/client";

const CYCLE_LABEL: Record<BillingCycleType, string> = {
  ONE_TIME: "Once, for the whole term",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BI_WEEKLY: "Every fortnight",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "draft",
  SENT: "sent",
  PAID: "paid",
  PARTIAL: "part paid",
  OVERDUE: "overdue",
  CANCELLED: "canceled",
  VOID: "void",
};

/**
 * Billing, in one card: what the order bills on, and what it has billed.
 *
 * It was two — three, briefly. The order record carried an invoice list, the
 * sale and rent-to-own types swapped in a second one that read against the
 * contract value instead, and the billing terms arrived as a third card above
 * both. So an order could say "monthly" in one card and show a single invoice
 * in the next with nothing joining them, and a person looking for "what does
 * this cost and has it been asked for" read three cards to find out.
 *
 * They are one question. The terms decide what the invoices will be; the
 * invoices are what the terms have produced so far; and the sentence at the
 * bottom is about the gap between them, which is the thing actually worth
 * knowing. The type no longer swaps the card — it only changes that closing
 * sentence, because a rent-to-own is *meant* to sit years short of its contract
 * value and a rental is not.
 *
 * The two buttons are the two different acts. Editing the terms changes every
 * future invoice; creating one raises a single invoice now, out of cycle, which
 * is what the first charge on activation and any late billing actually are.
 */
export async function OrderBillingCard({
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
  const outstanding = invoiced.billed - invoiced.paid;

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
      title="Billing"
      meta={
        invoiced.count === 0
          ? billing.notBilled
            ? "not billed"
            : recurring
              ? "recurring · nothing raised"
              : "one time · nothing raised"
          : `${moneyExact(invoiced.paid)} of ${moneyExact(invoiced.billed)} paid`
      }
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
      {/* The terms. What every invoice below was, or will be, made from. */}
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
        <Field label="Order value">{moneyExact(billing.total)}</Field>
      </div>

      {/* What the terms have produced. */}
      {invoiced.rows.length === 0 ? (
        <CardEmpty>
          {billing.notBilled
            ? "Marked not billed, so the billing run skips it entirely. It still tracks units, location and revenue — it just never raises an invoice."
            : onCycle && !billing.nextBillingDate
              ? "This order recurs but has no next billing date, so the billing run will not pick it up. Save its terms again to schedule one."
              : onCycle
                ? "Nothing raised yet. The billing run will raise the first invoice on the next billing date."
                : recurring
                  ? "Set to recur, but the billing run only picks up active orders — activate it to start the cycle."
                  : `Nothing raised yet, so none of the ${moneyExact(billing.total)} has been asked for. Use Create invoice.`}
        </CardEmpty>
      ) : (
        <>
          <ul className="flex flex-col gap-px px-2 pb-2">
            {invoiced.rows.map((invoice) => {
              const dead =
                invoice.status === "VOID" || invoice.status === "CANCELLED";
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/dashboard/invoices/${invoice.id}`}
                    className={`grid grid-cols-[1fr_78px_92px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover ${
                      dead ? "text-ink-faint" : ""
                    }`}
                  >
                    <span className="truncate">
                      <span className={dead ? "" : "font-bold"}>
                        {invoice.invoiceNumber}
                      </span>
                      <span className="ml-2 text-ink-faint">
                        {dayYear(invoice.issued)}
                      </span>
                    </span>
                    <span
                      className={`truncate ${
                        invoice.status === "OVERDUE"
                          ? "font-bold text-destructive"
                          : "text-ink-muted"
                      }`}
                    >
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </span>
                    <span className="text-right tabular-nums">
                      {moneyExact(invoice.total)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* The gap between the two halves, which is the point of joining them.
              A rent-to-own is meant to sit years short of its contract value; a
              one-time rental that has invoiced nothing is money nobody asked
              for. Same arithmetic, opposite meanings, so the type decides how
              it is said. */}
          <p className="px-4 pb-4 text-detail text-balance text-ink-muted">
            {outstanding > 0.01
              ? `${moneyExact(outstanding)} outstanding across ${invoiced.count} ${
                  invoiced.count === 1 ? "invoice" : "invoices"
                }.`
              : `Everything raised has been paid.`}
            {billing.notBilled
              ? " The order is marked not billed, so nothing further will be raised."
              : onCycle
                ? ` ${billing.periodsCompleted} ${
                    billing.periodsCompleted === 1 ? "period" : "periods"
                  } billed${
                    billing.lastBilledDate
                      ? `, the last on ${dayYear(billing.lastBilledDate)}`
                      : ""
                  }${
                    billing.recurrenceEndDate
                      ? `; recurs until ${dayYear(billing.recurrenceEndDate)}.`
                      : "; no end date is set, so it recurs until the order is completed."
                  }`
                : type === "RENT_TO_OWN"
                  ? ` ${moneyExact(
                      Math.max(0, billing.total - invoiced.billed),
                    )} of the agreement is still to be invoiced, which is what a financed term looks like part way through.`
                  : billing.total - invoiced.billed > 0.01
                    ? ` ${moneyExact(
                        billing.total - invoiced.billed,
                      )} of the ${moneyExact(billing.total)} order has not been invoiced yet.`
                    : " The order has been invoiced in full."}
          </p>
        </>
      )}
    </Card>
  );
}
