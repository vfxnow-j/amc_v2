import { prisma } from "@/lib/prisma";
import { UNSETTLED } from "@/lib/queries/accounting";
import { isInvoiceOverdue } from "@/lib/accounting/labels";

/** Queries behind the Invoice record. One per card, so each Suspends alone. */

export async function getInvoiceHeader(id: string, now = new Date()) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      issueDate: true,
      dueDate: true,
      subtotal: true,
      taxRate: true,
      taxAmount: true,
      total: true,
      amountPaid: true,
      notes: true,
      terms: true,
      periodNumber: true,
      periodStartDate: true,
      periodEndDate: true,
      qbInvoiceId: true,
      qbSyncedAt: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          email: true,
          paymentTerms: true,
          billingAddress: true,
          address: true,
        },
      },
      reservation: {
        select: { id: true, reservationNumber: true, projectName: true },
      },
      _count: { select: { items: true, payments: true } },
    },
  });

  if (!invoice) return null;

  const total = Number(invoice.total);
  const paid = Number(invoice.amountPaid);

  return {
    ...invoice,
    subtotal: Number(invoice.subtotal),
    taxRate: Number(invoice.taxRate),
    taxAmount: Number(invoice.taxAmount),
    total,
    paid,
    // What is actually still owed. Draft, canceled and void invoices carry a
    // total nobody is waiting for, so the balance is only money when the status
    // says the client has been asked for it.
    balance: total - paid,
    overdue: isInvoiceOverdue(invoice.status, invoice.dueDate, now),
    lineCount: invoice._count.items,
    paymentCount: invoice._count.payments,
  };
}

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** Rendered indented beneath its parent — a component of a configured item. */
  isComponent: boolean;
  assetName: string | null;
};

/**
 * The billed lines, parents first with their components beneath.
 *
 * `InvoiceItem` mirrors `ReservationItem`'s nesting through `parentId`, so a
 * configured machine invoices as one priced line with its parts under it. The
 * flattening happens here rather than in the card: the card's job is to draw
 * rows, and the tree is a property of the data.
 *
 * Components are shown at their own price rather than folded into the parent,
 * because that is how they are stored — inventing a rolled-up figure would put
 * a number on screen that no row in the database holds.
 */
export async function getInvoiceLines(id: string): Promise<InvoiceLine[]> {
  const items = await prisma.invoiceItem.findMany({
    where: { invoiceId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      amount: true,
      parentId: true,
      asset: { select: { name: true } },
    },
  });

  const shape = (item: (typeof items)[number], isComponent: boolean) => ({
    id: item.id,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    amount: Number(item.amount),
    isComponent,
    assetName: item.asset?.name ?? null,
  });

  const children = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.parentId) continue;
    const bucket = children.get(item.parentId) ?? [];
    bucket.push(item);
    children.set(item.parentId, bucket);
  }

  const lines: InvoiceLine[] = [];
  for (const item of items) {
    if (item.parentId) continue;
    lines.push(shape(item, false));
    for (const child of children.get(item.id) ?? []) {
      lines.push(shape(child, true));
    }
  }

  // An orphan — a component whose parent was deleted — would otherwise vanish
  // from a screen that has to add up to the invoice total. Show it flat.
  const shown = new Set(lines.map((line) => line.id));
  for (const item of items) {
    if (!shown.has(item.id)) lines.push(shape(item, false));
  }

  return lines;
}

export async function getInvoicePayments(id: string) {
  const payments = await prisma.payment.findMany({
    where: { invoiceId: id },
    orderBy: { paymentDate: "desc" },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      reference: true,
      notes: true,
      qbPaymentId: true,
    },
  });

  return payments.map((payment) => ({
    id: payment.id,
    amount: Number(payment.amount),
    at: payment.paymentDate,
    // Free text in v1 rather than an enum, so it is shown as stored.
    method: payment.paymentMethod,
    reference: payment.reference,
    notes: payment.notes,
    synced: payment.qbPaymentId !== null,
  }));
}

/**
 * Everything else this client owes, so the record can be chased from.
 *
 * Whoever opens an overdue invoice is usually about to pick up the phone, and
 * the useful question then is not "is this one late" but "what else is". Capped,
 * with the total returned so the card can qualify the count.
 */
export async function getSiblingInvoices(
  id: string,
  clientId: string,
  now = new Date(),
  take = 8,
) {
  // The list's definition of "owed", verbatim, so this card and the Invoices
  // list can never disagree about the same client.
  const where = { AND: [UNSETTLED, { clientId, id: { not: id } }] };

  const [records, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { dueDate: "asc" },
      take,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        dueDate: true,
        total: true,
        amountPaid: true,
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    total,
    rows: records.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      due: invoice.dueDate,
      balance: Number(invoice.total) - Number(invoice.amountPaid),
      overdue: isInvoiceOverdue(invoice.status, invoice.dueDate, now),
    })),
  };
}

/** The invoice PDF's header and totals; its lines come from `getInvoiceLines`. */
export async function getInvoiceForPdf(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    select: {
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      subtotal: true,
      taxRate: true,
      taxAmount: true,
      total: true,
      amountPaid: true,
      notes: true,
      terms: true,
      client: {
        select: {
          name: true,
          companyName: true,
          email: true,
          phone: true,
          billingAddress: true,
          address: true,
          paymentTerms: true,
        },
      },
      reservation: { select: { reservationNumber: true } },
      payments: {
        orderBy: { paymentDate: "asc" },
        select: { amount: true, paymentDate: true, paymentMethod: true },
      },
    },
  });
}
