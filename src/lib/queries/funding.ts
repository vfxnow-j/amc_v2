import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  FUNDING_VIEWS,
  FUNDING_VIEW_STATUSES,
  type FundingView,
} from "@/lib/procurement/funding-labels";

/**
 * Queries behind Procurement → Funding requests: the list, the record, and what
 * the record's controls offer. One per card where a card can Suspend alone.
 *
 * Every Decimal leaves here as a number or null, never as a zero standing in
 * for a blank — "no interest rate entered" and "0%" are different answers on a
 * request, and the payback markers treat them differently.
 */

const PAGE_SIZE = 50;

const n = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

function listWhere(view: FundingView, search: string): Prisma.FundingRequestWhereInput {
  const statuses = FUNDING_VIEW_STATUSES[view];
  const where: Prisma.FundingRequestWhereInput = statuses ? { status: { in: statuses } } : {};
  if (search) {
    where.OR = [
      { requestNumber: { contains: search, mode: "insensitive" } },
      { requestedBy: { contains: search, mode: "insensitive" } },
      { equipmentSummary: { contains: search, mode: "insensitive" } },
      { projectName: { contains: search, mode: "insensitive" } },
      { lender: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function getFundingViewCounts(search = "") {
  const counts = await Promise.all(
    FUNDING_VIEWS.map((view) => prisma.fundingRequest.count({ where: listWhere(view, search) })),
  );
  return Object.fromEntries(
    FUNDING_VIEWS.map((view, index) => [view, counts[index]]),
  ) as Record<FundingView, number>;
}

/**
 * The header figure. Summed on `amountRequested` and named as requested — it is
 * the ask, not money committed or drawn; a request can still be declined.
 */
export async function getFundingHeaderStats() {
  const [open, submitted] = await Promise.all([
    prisma.fundingRequest.aggregate({
      where: { status: { in: FUNDING_VIEW_STATUSES.open ?? [] } },
      _count: true,
      _sum: { amountRequested: true },
    }),
    prisma.fundingRequest.count({ where: { status: "SUBMITTED" } }),
  ]);
  return {
    openCount: open._count,
    openRequested: Number(open._sum.amountRequested ?? 0),
    submittedCount: submitted,
  };
}

export async function getFundingRequestList({
  view = "open",
  search = "",
  page = 1,
}: { view?: FundingView; search?: string; page?: number } = {}) {
  const where = listWhere(view, search);
  const [records, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      orderBy: [{ requestDate: "desc" }, { requestNumber: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        requestNumber: true,
        status: true,
        requestedBy: true,
        requestDate: true,
        neededByDate: true,
        amountRequested: true,
        purchaseType: true,
        projectName: true,
        client: { select: { name: true } },
        lease: { select: { leaseNumber: true } },
        _count: { select: { purchaseOrders: true, reservations: true } },
      },
    }),
    prisma.fundingRequest.count({ where }),
  ]);

  return {
    total,
    pageSize: PAGE_SIZE,
    rows: records.map((record) => ({
      id: record.id,
      requestNumber: record.requestNumber,
      status: record.status,
      requestedBy: record.requestedBy,
      requestDate: record.requestDate,
      neededByDate: record.neededByDate,
      amountRequested: Number(record.amountRequested),
      purchaseType: record.purchaseType,
      customer: record.client?.name ?? record.projectName ?? null,
      leaseNumber: record.lease?.leaseNumber ?? null,
      purchaseOrders: record._count.purchaseOrders,
      orders: record._count.reservations,
    })),
  };
}

/** The whole request, for the record and the edit form. */
export async function getFundingRecord(id: string) {
  const request = await prisma.fundingRequest.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      lease: {
        select: { id: true, leaseName: true, leaseNumber: true, lender: true, status: true },
      },
      items: { orderBy: { sortOrder: "asc" } },
      purchaseOrders: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          total: true,
          orderDate: true,
          leaseId: true,
          vendor: { select: { name: true } },
          lease: { select: { id: true, leaseNumber: true } },
        },
        orderBy: { orderDate: "desc" },
      },
      reservations: {
        select: {
          id: true,
          reservationNumber: true,
          status: true,
          reservationType: true,
          startDate: true,
          endDate: true,
          client: { select: { name: true } },
        },
        orderBy: { startDate: "desc" },
      },
    },
  });
  if (!request) return null;

  return {
    ...request,
    amountRequested: Number(request.amountRequested),
    totalEquipmentCost: Number(request.totalEquipmentCost),
    customerRentalRate: n(request.customerRentalRate),
    customerRentalCharge: n(request.customerRentalCharge),
    expectedInitialRevenue: n(request.expectedInitialRevenue),
    amountBorrowed: n(request.amountBorrowed),
    interestRate: n(request.interestRate),
    monthlyPayment: n(request.monthlyPayment),
    financingFees: n(request.financingFees),
    estimatedTotalInterest: n(request.estimatedTotalInterest),
    expectedGrossProfit: n(request.expectedGrossProfit),
    expectedAnnualUtilization: n(request.expectedAnnualUtilization),
    expectedAnnualRevenue: n(request.expectedAnnualRevenue),
    estimatedResaleValue: n(request.estimatedResaleValue),
    items: request.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitCost: Number(item.unitCost),
      amount: Number(item.amount),
    })),
    // The PO's total is shown as the PO's figure, never summed against the
    // request: a PO can back more than one request, and a request can be
    // raised before its PO is priced.
    purchaseOrders: request.purchaseOrders.map((po) => ({
      ...po,
      total: Number(po.total),
    })),
    // No order value here. `Reservation.total` is a cached figure that drifts
    // from the order's lines in both directions (docs/build-plan.md), so the
    // record links to the order rather than quoting a number it can't vouch for.
    reservations: request.reservations,
  };
}

export type FundingRecord = NonNullable<Awaited<ReturnType<typeof getFundingRecord>>>;

export async function getFundingDocuments(id: string) {
  return prisma.document.findMany({
    where: { entityType: "FUNDING_REQUEST", entityId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, createdAt: true, updatedAt: true },
  });
}

/**
 * What can be attached to a request: purchase orders that are not canceled and
 * client orders that are neither canceled nor lost — v1's own exclusions — less
 * whatever is already attached. The most recent 300 of each, as in v1.
 */
export async function getFundingAttachOptions(id: string) {
  const [purchaseOrders, orders] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: { not: "CANCELLED" }, fundingRequests: { none: { id } } },
      select: {
        id: true,
        poNumber: true,
        status: true,
        total: true,
        vendor: { select: { name: true } },
      },
      orderBy: { orderDate: "desc" },
      take: 300,
    }),
    prisma.reservation.findMany({
      where: {
        status: { notIn: ["CANCELLED", "LOST"] },
        fundingRequests: { none: { id } },
      },
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        client: { select: { name: true } },
      },
      orderBy: { startDate: "desc" },
      take: 300,
    }),
  ]);

  return {
    purchaseOrders: purchaseOrders.map((po) => ({
      id: po.id,
      label: `${po.poNumber} · ${po.vendor.name}`,
      total: Number(po.total),
      status: po.status,
    })),
    orders: orders.map((order) => ({
      id: order.id,
      label: `${order.reservationNumber} · ${order.client.name}`,
      status: order.status,
    })),
  };
}

/** Loans a request can be funded by, newest first. */
export async function getFundingLeases() {
  return prisma.lease.findMany({
    select: { id: true, leaseName: true, leaseNumber: true, lender: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

/** The pickers the create and edit form need. */
export async function getFundingFormOptions() {
  const [clients, leases] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getFundingLeases(),
  ]);
  return { clients, leases };
}
