import React from "react";
import { getServerLogoDataUri } from "@/lib/actions/documents";
import { getInvoiceForPdf, getInvoiceLines } from "@/lib/queries/invoice-record";

/**
 * The invoice PDF, rendered on the server.
 *
 * v1 built every PDF in the browser: a client dialog imported the renderer, the
 * fonts and the whole document tree, then handed the blob to the print dialog.
 * That put ~400KB of PDF machinery in the bundle of any screen that offered a
 * document, and the record screens offer one each. Rendering here instead means
 * the record ships no PDF code at all and the link is an ordinary `<a>` — which
 * also makes it work from the keyboard, and right-clickable to save.
 *
 * `PurchaseOrderPDF` already had a server-side twin in `actions/documents`
 * (`renderPurchaseOrderPdf`); this is the same shape for invoices, kept in the
 * Revenue cluster rather than added to the ported file.
 *
 * Not a "use server" module — it returns a Buffer to a route handler, which is
 * not something a client is allowed to call.
 */

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export async function renderInvoicePdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  // Lines come from the same query the record screen renders, so a printed
  // invoice can never group its lines differently from the screen it was
  // printed from.
  const [invoice, lines] = await Promise.all([
    getInvoiceForPdf(id),
    getInvoiceLines(id),
  ]);
  if (!invoice) return null;

  const { InvoicePDF } = await import("@/components/documents/invoice-pdf");

  const items = lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
    isComponent: line.isComponent,
  }));

  const total = Number(invoice.total);
  const amountPaid = Number(invoice.amountPaid);

  const data = {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: DATE.format(invoice.issueDate),
    dueDate: DATE.format(invoice.dueDate),
    paymentTerms: `Net ${invoice.client.paymentTerms}`,
    clientName: invoice.client.name,
    clientCompany: invoice.client.companyName ?? undefined,
    clientEmail: invoice.client.email ?? undefined,
    clientPhone: invoice.client.phone ?? undefined,
    // Billing address if one is held, otherwise the shipping one — an invoice
    // with no address at all is worse than an invoice with the wrong one.
    clientAddress: invoice.client.billingAddress ?? invoice.client.address ?? undefined,
    reservationNumber: invoice.reservation?.reservationNumber ?? undefined,
    items,
    subtotal: Number(invoice.subtotal),
    taxRate: Number(invoice.taxRate),
    taxAmount: Number(invoice.taxAmount),
    total,
    amountPaid,
    balanceDue: total - amountPaid,
    payments: invoice.payments.map((payment) => ({
      date: DATE.format(payment.paymentDate),
      method: payment.paymentMethod ?? "—",
      amount: Number(payment.amount),
    })),
    notes: invoice.notes ?? undefined,
    terms: invoice.terms ?? undefined,
  };

  const { pdf } = await import("@react-pdf/renderer");
  const element = React.createElement(InvoicePDF, {
    data,
    logoDataUri: await getServerLogoDataUri(),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await pdf(element as any).toBuffer();

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(chunk);

  return {
    buffer: Buffer.concat(chunks),
    filename: `${invoice.invoiceNumber}.pdf`,
  };
}
