import { prisma } from "@/lib/prisma";
import { UNSETTLED } from "@/lib/queries/revenue";
import { OPEN_STATUSES } from "@/lib/reservations/status";

/** Queries behind the Accounts record. One per card, so each Suspends alone. */

export async function getClientHeader(id: string) {
  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      companyName: true,
      email: true,
      phone: true,
      address: true,
      billingAddress: true,
      paymentTerms: true,
      taxExempt: true,
      notes: true,
      marketingTag: true,
      qbCustomerId: true,
      createdAt: true,
      agreementSignedAt: true,
      agreementSignerName: true,
      idVerifiedAt: true,
      coiVerifiedAt: true,
      skipIdRequirement: true,
      skipCoiRequirement: true,
      _count: { select: { contacts: true, reservations: true, invoices: true } },
    },
  });

  if (!client) return null;

  return {
    ...client,
    contacts: client._count.contacts,
    orders: client._count.reservations,
    invoices: client._count.invoices,
  };
}

/**
 * What this client owes, and how late.
 *
 * Billed and paid come from every invoice ever raised; owed counts only the
 * states that represent live debt — a cancelled or voided invoice has a total
 * but is not money anybody is waiting for, and summing it would overstate the
 * position on a screen someone might chase a payment from.
 *
 * Overdue is unsettled *and* past its due date, the same definition the
 * Invoices list uses, because `Invoice.status = OVERDUE` is maintained by a
 * nightly job and an invoice can be genuinely late while the column still reads
 * SENT. Trusting the column here would let the record quietly disagree with the
 * list about the same client.
 */
export async function getClientCredit(id: string, now = new Date()) {
  const [all, owing, overdue, lastPayment, drafts] = await Promise.all([
    prisma.invoice.aggregate({
      where: { clientId: id, status: { notIn: ["CANCELLED", "VOID", "DRAFT"] } },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { AND: [UNSETTLED, { clientId: id }] },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { AND: [UNSETTLED, { clientId: id, dueDate: { lt: now } }] },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.payment.findFirst({
      where: { invoice: { clientId: id } },
      orderBy: { paymentDate: "desc" },
      select: { amount: true, paymentDate: true, paymentMethod: true },
    }),
    // Drafts are excluded from every figure above — nobody has been asked for
    // the money yet. They are counted so the card can say so, because "billed
    // $200, 1 invoiced" sitting beside a list of nine invoices otherwise reads
    // as a bug rather than as a pile of unsent drafts.
    prisma.invoice.aggregate({
      where: { clientId: id, status: "DRAFT" },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const owedOf = (row: { _sum: { total: unknown; amountPaid: unknown } }) =>
    Number(row._sum.total ?? 0) - Number(row._sum.amountPaid ?? 0);

  return {
    billed: Number(all._sum.total ?? 0),
    paid: Number(all._sum.amountPaid ?? 0),
    invoiced: all._count,
    owed: owedOf(owing),
    owingCount: owing._count,
    overdue: owedOf(overdue),
    overdueCount: overdue._count,
    draftTotal: Number(drafts._sum.total ?? 0),
    draftCount: drafts._count,
    lastPayment: lastPayment
      ? {
          amount: Number(lastPayment.amount),
          at: lastPayment.paymentDate,
          method: lastPayment.paymentMethod,
        }
      : null,
  };
}

export async function getClientContacts(id: string) {
  const contacts = await prisma.clientContact.findMany({
    where: { clientId: id },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isPrimary: true,
    },
  });
  return contacts;
}

/** Open orders first — what's live matters more than what's finished. */
export async function getClientOrders(id: string, take = 12) {
  const [open, recent] = await Promise.all([
    prisma.reservation.findMany({
      where: { clientId: id, status: { in: OPEN_STATUSES } },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        total: true,
      },
    }),
    prisma.reservation.findMany({
      where: { clientId: id, status: { notIn: OPEN_STATUSES } },
      orderBy: { startDate: "desc" },
      take,
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        total: true,
      },
    }),
  ]);

  const shape = (order: (typeof open)[number]) => ({
    id: order.id,
    reservationNumber: order.reservationNumber,
    status: order.status,
    start: order.startDate,
    end: order.endDate,
    total: Number(order.total),
  });

  return { open: open.map(shape), recent: recent.map(shape) };
}

export async function getClientInvoices(id: string, take = 12) {
  const [records, total] = await Promise.all([
    prisma.invoice.findMany({
      where: { clientId: id },
      orderBy: { issueDate: "desc" },
      take,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
      },
    }),
    prisma.invoice.count({ where: { clientId: id } }),
  ]);

  return {
    total,
    rows: records.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issued: invoice.issueDate,
      due: invoice.dueDate,
      total: Number(invoice.total),
      paid: Number(invoice.amountPaid),
    })),
  };
}

/**
 * Documents belonging to this client's orders.
 *
 * `Document` is polymorphic on RESERVATION and PURCHASE_ORDER — nothing attaches
 * to a client directly — so these are gathered through the client's orders. Two
 * queries rather than a join because the link is an untyped `entityId` string,
 * which Prisma cannot traverse as a relation.
 *
 * Deleted documents are excluded: `deletedAt` is a soft delete a user set
 * deliberately, and a Trash item reappearing on the client's record would
 * undo that decision.
 */
export async function getClientDocuments(id: string, take = 12) {
  const orders = await prisma.reservation.findMany({
    where: { clientId: id },
    select: { id: true, reservationNumber: true },
  });
  if (orders.length === 0) return { total: 0, rows: [] };

  const orderNumber = new Map(orders.map((o) => [o.id, o.reservationNumber]));
  const where = {
    entityType: "RESERVATION",
    entityId: { in: orders.map((o) => o.id) },
    deletedAt: null,
  } as const;

  const [records, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        documentType: true,
        filename: true,
        isSigned: true,
        signedBy: true,
        signedAt: true,
        createdAt: true,
        entityId: true,
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    total,
    rows: records.map((document) => ({
      id: document.id,
      type: document.documentType,
      filename: document.filename,
      isSigned: document.isSigned,
      signedBy: document.signedBy,
      signedAt: document.signedAt,
      createdAt: document.createdAt,
      orderId: document.entityId,
      orderNumber: orderNumber.get(document.entityId) ?? null,
    })),
  };
}
