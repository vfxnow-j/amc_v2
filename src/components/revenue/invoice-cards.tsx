import Link from "next/link";
import { Card, CardEmpty, Unset } from "@/components/record/record-card";
import { RecordPaymentPanel } from "@/components/revenue/record-payment-panel";
import { dayYear, moneyExact } from "@/lib/format";
import {
  getInvoiceLines,
  getInvoicePayments,
  getSiblingInvoices,
} from "@/lib/queries/invoice-record";
import { INVOICE_STATUS_LABEL } from "@/lib/revenue/labels";

/**
 * The Invoice record's cards.
 *
 * Money carries cents everywhere on this screen, unlike the rest of the app:
 * this is a document somebody reconciles line by line against a bank statement,
 * and a rounded figure that disagrees with the PDF by 40¢ costs more time than
 * the noise of the decimals saves.
 */

/** What was billed, and what it adds up to. */
export async function LinesCard({
  id,
  subtotal,
  taxRate,
  taxAmount,
  total,
}: {
  id: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}) {
  const lines = await getInvoiceLines(id);

  if (lines.length === 0) {
    return (
      <Card title="Lines">
        <CardEmpty>
          This invoice bills nothing. It was raised without lines — void it, or
          rebuild it from the order it belongs to.
        </CardEmpty>
      </Card>
    );
  }

  const billed = lines
    .filter((line) => !line.isComponent)
    .reduce((sum, line) => sum + line.amount, 0);

  return (
    <Card
      title="Lines"
      meta={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
    >
      <div className="grid grid-cols-[1fr_56px_104px_112px] gap-2 px-4 pb-[6px] text-colhead uppercase text-ink-muted">
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit</span>
        <span className="text-right">Amount</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-2">
        {lines.map((line, index) => (
          <li
            key={line.id}
            className={`grid grid-cols-[1fr_56px_104px_112px] items-center gap-2 rounded-row p-2 text-detail ${
              index % 2 === 1 ? "bg-row-alt" : ""
            }`}
          >
            <span
              className={`truncate ${line.isComponent ? "pl-4 text-ink-muted" : ""}`}
            >
              {line.description}
              {/* The asset link is what ties a billed line back to a product
                  type, and descriptions are free text that drift from it — but
                  most were generated *from* the asset name, so it is only worth
                  the pixels when the two have actually diverged. */}
              {line.assetName && !line.description.includes(line.assetName) ? (
                <span className="text-ink-faint"> · {line.assetName}</span>
              ) : null}
            </span>
            <span className="text-right tabular-nums text-ink-muted">
              {line.quantity}
            </span>
            <span className="text-right tabular-nums text-ink-muted">
              {moneyExact(line.unitPrice)}
            </span>
            <span className="text-right tabular-nums">
              {moneyExact(line.amount)}
            </span>
          </li>
        ))}
      </ul>

      <footer className="flex flex-col gap-1 px-4 py-3 text-detail">
        <Total label="Subtotal" value={moneyExact(subtotal)} />
        {taxAmount !== 0 || taxRate !== 0 ? (
          <Total label={`Tax at ${taxRate}%`} value={moneyExact(taxAmount)} />
        ) : null}
        <Total label="Total" value={moneyExact(total)} loud />
        {/* Say so rather than quietly showing two figures that don't add up:
            the stored total is what the client was billed, and a line that has
            been edited since is a real discrepancy, not a rounding artefact. */}
        {Math.abs(billed + taxAmount - total) > 0.01 ? (
          <p className="mt-1 rounded-well bg-sunken p-2 text-ink-muted">
            The lines add up to {moneyExact(billed + taxAmount)}, but the invoice
            was raised at {moneyExact(total)}. The stored total is what the
            client owes; the lines have changed since.
          </p>
        ) : null}
      </footer>
    </Card>
  );
}

function Total({
  label,
  value,
  loud,
}: {
  label: string;
  value: string;
  loud?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={loud ? "font-bold" : "text-ink-muted"}>{label}</span>
      <span
        className={`ml-auto tabular-nums ${loud ? "text-[16px] font-bold" : "text-ink-muted"}`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * What has come in, and the way to record more.
 *
 * The Payments list has no record of its own — a `Payment` row is six fields,
 * all of which fit on that list, and `Payment.invoiceId` is a required
 * one-to-one link, so there is no allocation to build. The allocation *is* this
 * card: it is the only place the balance it settles is on screen.
 */
export async function PaymentsCard({
  id,
  status,
  balance,
}: {
  id: string;
  status: string;
  balance: number;
}) {
  const payments = await getInvoicePayments(id);
  const received = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const settleable = status !== "DRAFT" && status !== "VOID" && status !== "CANCELLED";

  return (
    <Card
      title="Payments"
      meta={
        payments.length > 0
          ? `${moneyExact(received)} across ${payments.length}`
          : undefined
      }
    >
      {payments.length === 0 ? (
        <CardEmpty>
          {settleable
            ? "Nothing received against this invoice yet. Record a payment below as it lands, and it appears on the Payments list too."
            : `Nothing received, and a ${INVOICE_STATUS_LABEL[status as keyof typeof INVOICE_STATUS_LABEL]?.toLowerCase() ?? status.toLowerCase()} invoice cannot take a payment.`}
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="grid grid-cols-[80px_1fr_104px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail"
            >
              <span className="tabular-nums text-ink-muted">
                {dayYear(payment.at)}
              </span>
              <span className="truncate">
                {payment.method ?? <Unset>Method not recorded</Unset>}
                {payment.reference ? (
                  <span className="text-ink-faint"> · {payment.reference}</span>
                ) : null}
                {payment.synced ? (
                  <span className="text-ink-faint"> · QB</span>
                ) : null}
              </span>
              <span className="text-right font-bold tabular-nums">
                {moneyExact(payment.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {settleable && balance > 0.005 ? (
        <RecordPaymentPanel invoiceId={id} balance={balance} />
      ) : null}
    </Card>
  );
}

/**
 * The rest of this client's unsettled invoices.
 *
 * Whoever opens a late invoice is usually about to pick up the phone, and the
 * useful question then is not "is this one late" but "what else is" — so the
 * call covers the account rather than one document.
 */
export async function AlsoOwedCard({
  id,
  clientId,
  clientName,
}: {
  id: string;
  clientId: string;
  clientName: string;
}) {
  const { rows, total } = await getSiblingInvoices(id, clientId);

  return (
    <Card
      title="Also owed"
      meta={total > rows.length ? `${rows.length} of ${total} shown` : undefined}
      action={
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-detail text-accent-text hover:underline"
        >
          Account
        </Link>
      }
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Nothing else is outstanding for {clientName}. This is the only invoice
          they have been asked to settle.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {rows.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/dashboard/invoices/${invoice.id}`}
                className="grid grid-cols-[1fr_78px_100px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold tabular-nums">
                  {invoice.invoiceNumber}
                </span>
                <span
                  className={`tabular-nums ${invoice.overdue ? "font-bold text-accent-text" : "text-ink-muted"}`}
                >
                  {dayYear(invoice.due)}
                </span>
                <span className="text-right tabular-nums">
                  {moneyExact(invoice.balance)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
