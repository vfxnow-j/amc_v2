import type {
  FundingRequestStatus,
  POStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { daysUntil } from "@/lib/format";
import { getPOHeaderStats } from "@/lib/queries/accounting";

/**
 * Queries behind Procurement → Overview.
 *
 * One definition per concept. "Committed" is `getPOHeaderStats` — SUBMITTED and
 * PARTIAL, summed on `PurchaseOrder.total` — the same call the Purchase orders
 * header and the dashboard's On order tile make, so the three can never show
 * different figures for the same thing. This module adds only what that figure
 * cannot say on its own: how much of a part-received order is still out, and
 * what is late.
 *
 * `total` was measured against its parts before being trusted (2026-09-16,
 * all 34 POs): subtotal equals the sum of line amounts, each line amount equals
 * quantity × unit price, feesTotal equals the fee lines, and total equals
 * subtotal − discount + freight + fees + tax, on every row. It is not a drifting
 * cache the way `Reservation.subtotal` is.
 */

/** The statuses "committed" and "awaiting receipt" mean. */
export const OPEN_PO_STATUSES: POStatus[] = ["SUBMITTED", "PARTIAL"];

/** Pipeline order, the lifecycle in docs/procurement.md. */
export const FUNDING_STATUSES: FundingRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "DECLINED",
  "FUNDED",
  "FULFILLED",
  "CANCELLED",
];

// Defined beside the funding screens, which share it; re-exported so the
// Overview's import is unchanged.
export { FUNDING_STATUS_LABEL } from "@/lib/procurement/funding-labels";

/**
 * The committed figure, plus what it is made of.
 *
 * For a PARTIAL order, `total` still includes the lines already on the shelf.
 * The lines know their received quantities, so the unreceived *line* value is
 * stateable exactly; freight, fees, tax and discount are order-level and are not
 * apportioned to lines anywhere, so no unreceived share of them is claimed.
 */
export async function getCommittedSpend() {
  const [header, partials, drafts, cancelled] = await Promise.all([
    getPOHeaderStats(),
    prisma.purchaseOrder.findMany({
      where: { status: "PARTIAL" },
      select: {
        total: true,
        items: { select: { quantity: true, receivedQuantity: true, unitPrice: true } },
      },
    }),
    prisma.purchaseOrder.aggregate({
      where: { status: "DRAFT" },
      _count: true,
      _sum: { total: true },
    }),
    prisma.purchaseOrder.count({ where: { status: "CANCELLED" } }),
  ]);

  let partialTotal = 0;
  let partialUnreceivedLines = 0;
  for (const po of partials) {
    partialTotal += Number(po.total);
    for (const item of po.items) {
      const outstanding = Math.max(item.quantity - item.receivedQuantity, 0);
      partialUnreceivedLines += outstanding * Number(item.unitPrice);
    }
  }

  return {
    openCount: header.openCount,
    openValue: header.openValue,
    partialCount: partials.length,
    partialTotal,
    partialUnreceivedLines,
    draftCount: drafts._count,
    draftValue: Number(drafts._sum.total ?? 0),
    cancelledCount: cancelled,
  };
}

/**
 * Everything submitted and not fully received, soonest expected first.
 *
 * "Past expected" is by calendar day: an order expected today is not late
 * until tomorrow. An order with no expected date cannot be late and says so.
 */
export async function getAwaitingReceipt(now: Date = new Date()) {
  const records = await prisma.purchaseOrder.findMany({
    where: { status: { in: OPEN_PO_STATUSES } },
    orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
    select: {
      id: true,
      poNumber: true,
      status: true,
      orderDate: true,
      expectedDate: true,
      total: true,
      vendor: { select: { id: true, name: true } },
      items: { select: { quantity: true, receivedQuantity: true } },
    },
  });

  const rows = records.map((record) => {
    const ordered = record.items.reduce((sum, item) => sum + item.quantity, 0);
    const received = record.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
    const daysLate =
      record.expectedDate && daysUntil(record.expectedDate, now) < 0
        ? -daysUntil(record.expectedDate, now)
        : 0;
    return {
      id: record.id,
      poNumber: record.poNumber,
      status: record.status,
      orderDate: record.orderDate,
      expectedDate: record.expectedDate,
      total: Number(record.total),
      vendor: record.vendor,
      ordered,
      received,
      daysLate,
    };
  });

  const late = rows.filter((row) => row.daysLate > 0);
  return {
    rows,
    lateCount: late.length,
    lateValue: late.reduce((sum, row) => sum + row.total, 0),
    undatedCount: rows.filter((row) => row.expectedDate === null).length,
  };
}

/** Count and amount requested per status, every status present even at zero. */
export async function getFundingPipeline() {
  const grouped = await prisma.fundingRequest.groupBy({
    by: ["status"],
    _count: true,
    _sum: { amountRequested: true },
  });

  const byStatus = FUNDING_STATUSES.map((status) => {
    const row = grouped.find((group) => group.status === status);
    return {
      status,
      count: row?._count ?? 0,
      amount: Number(row?._sum.amountRequested ?? 0),
    };
  });

  return {
    total: byStatus.reduce((sum, row) => sum + row.count, 0),
    byStatus,
  };
}

/** Months of received spend the vendor table covers. */
export const VENDOR_SPEND_MONTHS = 12;

/**
 * Spend per vendor on POs received in the trailing twelve months, dated by
 * `receivedDate` — when the hardware landed, which is when the order stopped
 * being a commitment. PARTIAL orders are outside it (their value is in
 * Committed); DRAFT and CANCELLED were never spend.
 */
export async function getVendorSpend(now: Date = new Date()) {
  const since = new Date(now);
  since.setMonth(since.getMonth() - VENDOR_SPEND_MONTHS);

  const [grouped, undated, partialCount] = await Promise.all([
    prisma.purchaseOrder.groupBy({
      by: ["vendorId"],
      where: { status: "RECEIVED", receivedDate: { gte: since, lte: now } },
      _count: true,
      _sum: { total: true },
    }),
    prisma.purchaseOrder.count({ where: { status: "RECEIVED", receivedDate: null } }),
    prisma.purchaseOrder.count({ where: { status: "PARTIAL" } }),
  ]);

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: grouped.map((row) => row.vendorId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));

  const rows = grouped
    .map((row) => ({
      vendorId: row.vendorId,
      name: nameOf.get(row.vendorId) ?? "Unknown vendor",
      count: row._count,
      total: Number(row._sum.total ?? 0),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    since,
    rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    orderCount: rows.reduce((sum, row) => sum + row.count, 0),
    undatedCount: undated,
    partialCount,
  };
}
