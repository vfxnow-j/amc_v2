import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import {
  AlsoOwedCard,
  LinesCard,
  PaymentsCard,
} from "@/components/accounting/invoice-cards";
import { dayYear, daysUntil, moneyExact } from "@/lib/format";
import { getInvoiceHeader } from "@/lib/queries/invoice-record";
import { INVOICE_STATUS_LABEL } from "@/lib/accounting/labels";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getInvoiceHeader(id);
  return { title: header?.invoiceNumber ?? "Invoice" };
}

/**
 * Revenue → Invoices → the record.
 *
 * The screen the order record has been linking to since Stage 2, and the one
 * the Accounts record's invoice list points at. It answers two questions in
 * that order: what does this client owe, and what were they billed for.
 *
 * Whether the invoice is late is computed here from the due date rather than
 * read off `Invoice.status`. The stored OVERDUE value is maintained by a nightly
 * job, so an invoice can be genuinely late while the column still reads SENT —
 * and the Invoices list already judges it this way. Two definitions would mean
 * a row that says "overdue" opening a record that says "sent".
 */
export default async function InvoiceRecordPage({ params }: Params) {
  const { id } = await params;
  const invoice = await getInvoiceHeader(id);
  if (!invoice) notFound();

  const days = daysUntil(invoice.dueDate);
  const settled = invoice.balance <= 0.005;

  return (
    <>
      <PageHeader
        eyebrow="Accounting · Invoice"
        title={invoice.invoiceNumber}
        blurb={
          <>
            <Link
              href={`/dashboard/clients/${invoice.client.id}`}
              className="text-accent-text hover:underline"
            >
              {invoice.client.name}
            </Link>
            {invoice.reservation ? (
              <>
                {" · "}
                <Link
                  href={`/dashboard/orders/${invoice.reservation.id}`}
                  className="text-accent-text hover:underline"
                >
                  {invoice.reservation.reservationNumber}
                </Link>
              </>
            ) : (
              " · raised without an order"
            )}
            {" · issued "}
            {dayYear(invoice.issueDate)}
          </>
        }
        actions={
          <>
            <span className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink">
              {INVOICE_STATUS_LABEL[invoice.status]}
            </span>
            {/* A route handler, not a dialog — so this record ships no PDF
                renderer, and the link works from the keyboard. */}
            <a
              href={`/dashboard/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              PDF
            </a>
          </>
        }
      />

      {/* The money, before any card has to load. */}
      <section className="flex items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Billed" value={moneyExact(invoice.total)} />
        <Figure label="Paid" value={moneyExact(invoice.paid)} />
        <Figure
          label="Outstanding"
          value={moneyExact(invoice.balance)}
          loud
          alarm={invoice.overdue}
        />
        <p className="ml-auto max-w-[42ch] text-detail text-balance text-ink-muted">
          {invoice.status === "DRAFT"
            ? "A draft. Nobody has been asked for this money yet, and it is in none of the outstanding figures elsewhere."
            : invoice.status === "VOID" || invoice.status === "CANCELLED"
              ? `${INVOICE_STATUS_LABEL[invoice.status]} — this invoice is not owed.`
              : settled
                ? `Settled. Due ${dayYear(invoice.dueDate)}.`
                : invoice.overdue
                  ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} past due — was due ${dayYear(invoice.dueDate)}.`
                  : `Due ${dayYear(invoice.dueDate)}, in ${days} ${days === 1 ? "day" : "days"}.`}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<CardSkeleton title="Lines" rows={10} />}>
          <LinesCard
            id={id}
            subtotal={invoice.subtotal}
            taxRate={invoice.taxRate}
            taxAmount={invoice.taxAmount}
            total={invoice.total}
          />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="Payments" rows={4} />}>
            <PaymentsCard
              id={id}
              status={invoice.status}
              balance={invoice.balance}
            />
          </Suspense>

          <Suspense fallback={<CardSkeleton title="Also owed" rows={4} />}>
            <AlsoOwedCard
              id={id}
              clientId={invoice.client.id}
              clientName={invoice.client.name}
            />
          </Suspense>

          <Card title="Details">
            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <Field label="Terms">{invoice.client.paymentTerms} days</Field>
              <Field label="Due">{dayYear(invoice.dueDate)}</Field>
              <Field label="Billing period">
                {invoice.periodNumber && invoice.periodStartDate && invoice.periodEndDate ? (
                  `#${invoice.periodNumber} · ${dayYear(invoice.periodStartDate)} – ${dayYear(invoice.periodEndDate)}`
                ) : (
                  <Unset>Not a cycle invoice</Unset>
                )}
              </Field>
              {/* QuickBooks is the system of record for the books. Nothing here
                  syncs on its own, so the record says what it can prove: whether
                  this invoice has ever been pushed, and when. */}
              <Field label="QuickBooks">
                {invoice.qbSyncedAt ? (
                  `Invoice ${invoice.qbInvoiceId ?? "—"} · ${dayYear(invoice.qbSyncedAt)}`
                ) : (
                  <Unset>Never synced</Unset>
                )}
              </Field>
            </div>
            {invoice.notes || invoice.terms ? (
              <div className="flex flex-col gap-2 px-4 pb-4 text-detail">
                {invoice.notes ? (
                  <p className="whitespace-pre-line text-ink-muted">
                    {invoice.notes}
                  </p>
                ) : null}
                {invoice.terms ? (
                  <p className="whitespace-pre-line rounded-well bg-sunken p-2 text-ink-muted">
                    {invoice.terms}
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

function Figure({
  label,
  value,
  loud,
  alarm,
}: {
  label: string;
  value: string;
  loud?: boolean;
  alarm?: boolean;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-[20px] font-bold tracking-[-0.02em]" : "text-body"} ${
          alarm ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
    </span>
  );
}
