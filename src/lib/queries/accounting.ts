import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  INVOICE_VIEWS,
  PO_VIEWS,
  UNSETTLED_STATUSES,
  type InvoiceView,
  type POView,
} from "@/lib/accounting/labels";

/** Queries behind the Revenue cluster. */

export const PAGE_SIZE = 40;

/* ── Invoices ───────────────────────────────────────────────────────────── */

/**
 * Unsettled money. `OVERDUE` is a stored status that a nightly job maintains, so
 * an invoice can be past its due date while still reading `SENT` — the views
 * below lean on the dates rather than trusting the column alone.
 *
 * Exported because the Accounts record shows the same client's position: two
 * definitions of "owed" in one app means the list and the record disagree in
 * front of whoever is chasing the money. The statuses themselves live in
 * `revenue/labels`, which the record screens read too — they judge one invoice
 * rather than querying for many, and a second hand-typed list would rot.
 */
export const UNSETTLED: Prisma.InvoiceWhereInput = {
  status: { in: UNSETTLED_STATUSES },
};

function invoiceViewWhere(
  view: InvoiceView,
  now: Date,
): Prisma.InvoiceWhereInput {
  switch (view) {
    case "outstanding":
      return UNSETTLED;
    case "overdue":
      return { AND: [UNSETTLED, { dueDate: { lt: now } }] };
    case "paid":
      return { status: "PAID" };
    case "draft":
      return { status: "DRAFT" };
    case "all":
      return {};
  }
}

function invoiceSearchWhere(search: string): Prisma.InvoiceWhereInput {
  const contains = { contains: search, mode: "insensitive" } as const;
  return {
    OR: [
      { invoiceNumber: contains },
      { client: { name: contains } },
      { client: { companyName: contains } },
      { reservation: { reservationNumber: contains } },
    ],
  };
}

function invoiceWhere(view: InvoiceView, search: string, now: Date) {
  const base = invoiceViewWhere(view, now);
  return search ? { AND: [base, invoiceSearchWhere(search)] } : base;
}

export async function getInvoiceViewCounts(search = "", now = new Date()) {
  const counts = await Promise.all(
    INVOICE_VIEWS.map((view) =>
      prisma.invoice.count({ where: invoiceWhere(view, search, now) }),
    ),
  );
  return Object.fromEntries(
    INVOICE_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<InvoiceView, number>;
}

export async function getInvoiceList({
  view = "outstanding",
  search = "",
  page = 1,
  now = new Date(),
}: {
  view?: InvoiceView;
  search?: string;
  page?: number;
  now?: Date;
} = {}) {
  const where = invoiceWhere(view, search, now);

  const [records, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        status: true,
        qbSyncedAt: true,
        client: { select: { name: true } },
        reservation: { select: { id: true, reservationNumber: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => {
      const total = Number(record.total);
      const paid = Number(record.amountPaid);
      const settled = record.status === "PAID" || record.status === "CANCELLED" || record.status === "VOID";
      return {
        id: record.id,
        invoiceNumber: record.invoiceNumber,
        clientName: record.client.name,
        orderNumber: record.reservation?.reservationNumber ?? null,
        orderId: record.reservation?.id ?? null,
        issueDate: record.issueDate,
        dueDate: record.dueDate,
        total,
        outstanding: total - paid,
        status: record.status,
        synced: record.qbSyncedAt !== null,
        isOverdue: !settled && record.dueDate < now,
      };
    }),
  };
}

export async function getInvoiceHeaderStats(now = new Date()) {
  const [outstanding, overdue] = await Promise.all([
    prisma.invoice.aggregate({
      where: UNSETTLED,
      _sum: { total: true, amountPaid: true },
    }),
    prisma.invoice.aggregate({
      where: { AND: [UNSETTLED, { dueDate: { lt: now } }] },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
  ]);

  const owed =
    Number(outstanding._sum.total ?? 0) - Number(outstanding._sum.amountPaid ?? 0);
  const late =
    Number(overdue._sum.total ?? 0) - Number(overdue._sum.amountPaid ?? 0);

  return { owed, late, lateCount: overdue._count };
}

/* ── Payments ───────────────────────────────────────────────────────────── */

export async function getPayments({
  search = "",
  page = 1,
}: { search?: string; page?: number } = {}) {
  const contains = { contains: search, mode: "insensitive" } as const;
  const where: Prisma.PaymentWhereInput = search
    ? {
        OR: [
          { reference: contains },
          { paymentMethod: contains },
          { invoice: { invoiceNumber: contains } },
          { invoice: { client: { name: contains } } },
        ],
      }
    : {};

  const [records, total, received] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        paymentMethod: true,
        reference: true,
        qbPaymentId: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            client: { select: { name: true } },
          },
        },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    receivedAllTime: Number(received._sum.amount ?? 0),
    rows: records.map((record) => ({
      id: record.id,
      amount: Number(record.amount),
      paymentDate: record.paymentDate,
      // Free text in v1, so it is shown as stored rather than mapped to an enum
      // that doesn't exist.
      method: record.paymentMethod,
      reference: record.reference,
      invoiceNumber: record.invoice.invoiceNumber,
      invoiceId: record.invoice.id,
      clientName: record.invoice.client.name,
      synced: record.qbPaymentId !== null,
    })),
  };
}

/* ── Contracts: sales · rent-to-own · leases ────────────────────────────── */

export async function getContractOrders({
  type,
  page = 1,
}: {
  type: "SALE" | "RENT_TO_OWN";
  page?: number;
}) {
  const where: Prisma.ReservationWhereInput = { reservationType: type };

  const [records, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy: [{ startDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        reservationNumber: true,
        startDate: true,
        status: true,
        total: true,
        client: { select: { name: true } },
        _count: { select: { items: true } },
        invoices: { select: { total: true, amountPaid: true } },
      },
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => {
      const invoiced = record.invoices.reduce(
        (sum, invoice) => sum + Number(invoice.total),
        0,
      );
      const paid = record.invoices.reduce(
        (sum, invoice) => sum + Number(invoice.amountPaid),
        0,
      );
      return {
        id: record.id,
        reservationNumber: record.reservationNumber,
        clientName: record.client.name,
        startDate: record.startDate,
        status: record.status,
        value: Number(record.total),
        lines: record._count.items,
        invoiced,
        outstanding: invoiced - paid,
      };
    }),
  };
}

/**
 * Leases, with the paydown each one has left.
 *
 * `Lease` carries no running balance, so "paid down" is derived from elapsed
 * term × monthly payment, capped at the total — an estimate from the schedule,
 * not a ledger. It is labeled as scheduled on screen for that reason: the real
 * figure would need the lender's statements, which v2 does not hold.
 */
export async function getLeases(now = new Date()) {
  const records = await prisma.lease.findMany({
    orderBy: [{ status: "asc" }, { endDate: "asc" }],
    select: {
      id: true,
      leaseName: true,
      leaseNumber: true,
      lender: true,
      monthlyPayment: true,
      totalAmount: true,
      payoffAmount: true,
      startDate: true,
      endDate: true,
      termMonths: true,
      status: true,
      _count: { select: { assetUnits: true } },
    },
  });

  return records.map((record) => {
    const monthly = Number(record.monthlyPayment);
    const total = Number(record.totalAmount);
    const elapsed = Math.max(
      0,
      Math.min(
        record.termMonths,
        (now.getFullYear() - record.startDate.getFullYear()) * 12 +
          (now.getMonth() - record.startDate.getMonth()),
      ),
    );
    const scheduledPaid =
      record.status === "PAID_OFF" ? total : Math.min(total, elapsed * monthly);

    return {
      id: record.id,
      leaseName: record.leaseName,
      leaseNumber: record.leaseNumber,
      lender: record.lender,
      monthly,
      total,
      payoff: record.payoffAmount === null ? null : Number(record.payoffAmount),
      endDate: record.endDate,
      status: record.status,
      units: record._count.assetUnits,
      scheduledPaid,
      scheduledRemaining: Math.max(0, total - scheduledPaid),
    };
  });
}

export async function getContractCounts() {
  const [sales, rentToOwn, leases] = await Promise.all([
    prisma.reservation.count({ where: { reservationType: "SALE" } }),
    prisma.reservation.count({ where: { reservationType: "RENT_TO_OWN" } }),
    prisma.lease.count(),
  ]);
  return { sales, "rent-to-own": rentToOwn, leases };
}

/* ── Rate cards ─────────────────────────────────────────────────────────── */

export async function getRateCards() {
  const records = await prisma.rateCard.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isDefault: true,
      updatedAt: true,
      rates: {
        select: {
          id: true,
          pricingType: true,
          rate: true,
          categoryId: true,
        },
      },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    isDefault: record.isDefault,
    updatedAt: record.updatedAt,
    rateCount: record.rates.length,
    // A rate with no category is the card's catch-all for everything else.
    categoryCount: new Set(
      record.rates.map((rate) => rate.categoryId).filter(Boolean),
    ).size,
  }));
}

/* ── Purchase orders ────────────────────────────────────────────────────── */

function poViewWhere(view: POView): Prisma.PurchaseOrderWhereInput {
  switch (view) {
    case "open":
      return { status: { in: ["SUBMITTED", "PARTIAL"] } };
    case "received":
      return { status: "RECEIVED" };
    case "draft":
      return { status: "DRAFT" };
    case "all":
      return {};
  }
}

function poWhere(view: POView, search: string) {
  const base = poViewWhere(view);
  if (!search) return base;
  const contains = { contains: search, mode: "insensitive" } as const;
  return {
    AND: [
      base,
      { OR: [{ poNumber: contains }, { vendor: { name: contains } }] },
    ],
  };
}

export async function getPOViewCounts(search = "") {
  const counts = await Promise.all(
    PO_VIEWS.map((view) =>
      prisma.purchaseOrder.count({ where: poWhere(view, search) }),
    ),
  );
  return Object.fromEntries(
    PO_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<POView, number>;
}

export async function getPurchaseOrders({
  view = "open",
  search = "",
  page = 1,
}: { view?: POView; search?: string; page?: number } = {}) {
  const where = poWhere(view, search);

  const [records, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        poNumber: true,
        orderDate: true,
        expectedDate: true,
        total: true,
        status: true,
        vendor: { select: { name: true } },
        shipToLocation: { select: { name: true } },
        items: { select: { quantity: true, receivedQuantity: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => {
      const ordered = record.items.reduce((sum, item) => sum + item.quantity, 0);
      const received = record.items.reduce(
        (sum, item) => sum + item.receivedQuantity,
        0,
      );
      return {
        id: record.id,
        poNumber: record.poNumber,
        vendorName: record.vendor.name,
        shipTo: record.shipToLocation?.name ?? null,
        orderDate: record.orderDate,
        expectedDate: record.expectedDate,
        total: Number(record.total),
        status: record.status,
        ordered,
        received,
      };
    }),
  };
}

export async function getPOHeaderStats() {
  const onOrder = await prisma.purchaseOrder.aggregate({
    where: { status: { in: ["SUBMITTED", "PARTIAL"] } },
    _sum: { total: true },
    _count: true,
  });
  return {
    openCount: onOrder._count,
    openValue: Number(onOrder._sum.total ?? 0),
  };
}
