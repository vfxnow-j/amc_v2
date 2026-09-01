import type {
  BillingCycleType,
  DiscountType,
  ReservationStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * What the order record needs to show and drive the order's stage.
 *
 * Kept apart from `getReservationHeader` on purpose: the header is what the
 * page needs before anything can paint, and this is a second, wider read that
 * the stage strip and the billing card can wait for behind their own Suspense
 * boundaries. Nothing here is needed to render the lines.
 */

export type OrderLifecycle = {
  id: string;
  status: ReservationStatus;
  /** When each stage happened, for the timeline's second line. */
  stamps: {
    created: Date;
    quoteSent: Date | null;
    quoteExpires: Date | null;
    approved: Date | null;
    preparing: Date | null;
    shipped: Date | null;
    completed: Date | null;
    lost: Date | null;
  };
  lostReason: string | null;
  actionRequired: boolean;
  actionRequiredNote: string | null;
  /** Who on the floor has the order. Null until it is prepared. */
  preparedBy: { id: string; name: string } | null;
  client: { id: string; name: string; email: string | null; paymentTerms: number };
  billing: {
    cycleType: BillingCycleType;
    cycleDay: number;
    cycleDays: number | null;
    isRecurring: boolean;
    notBilled: boolean;
    nextBillingDate: Date | null;
    lastBilledDate: Date | null;
    periodsCompleted: number;
    recurrenceEndDate: Date | null;
    taxRate: number;
    discountType: DiscountType | null;
    discountValue: number;
    discountAmount: number;
    /** The order's own terms, or null when it inherits the client's. */
    paymentTerms: number | null;
    total: number;
  };
  /** How much has been raised and settled against the order so far. */
  invoiced: { count: number; billed: number; paid: number };
  /** Live links to the online quote, and when the newest one dies. */
  quoteLinks: { count: number; latestExpiry: Date | null };
};

export async function getOrderLifecycle(
  id: string,
): Promise<OrderLifecycle | null> {
  const now = new Date();
  const [order, invoices, links] = await Promise.all([
    prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        createdAt: true,
        quoteSentAt: true,
        quoteExpiresAt: true,
        approvedAt: true,
        preparingAt: true,
        shippedAt: true,
        completedAt: true,
        lostAt: true,
        lostReason: true,
        actionRequired: true,
        actionRequiredNote: true,
        preparedBy: { select: { id: true, name: true } },
        client: {
          select: { id: true, name: true, email: true, paymentTerms: true },
        },
        billingCycleType: true,
        billingCycleDay: true,
        billingCycleDays: true,
        isRecurring: true,
        notBilled: true,
        nextBillingDate: true,
        lastBilledDate: true,
        billingPeriodsCompleted: true,
        recurrenceEndDate: true,
        taxRate: true,
        discountType: true,
        discountValue: true,
        discountAmount: true,
        paymentTerms: true,
        total: true,
      },
    }),
    prisma.invoice.aggregate({
      where: { reservationId: id, status: { notIn: ["VOID", "CANCELLED"] } },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.quoteToken.aggregate({
      where: { reservationId: id, expiresAt: { gt: now }, usedAt: null },
      _max: { expiresAt: true },
      _count: true,
    }),
  ]);

  if (!order) return null;

  return {
    id: order.id,
    status: order.status,
    stamps: {
      created: order.createdAt,
      quoteSent: order.quoteSentAt,
      quoteExpires: order.quoteExpiresAt,
      approved: order.approvedAt,
      preparing: order.preparingAt,
      shipped: order.shippedAt,
      completed: order.completedAt,
      lost: order.lostAt,
    },
    lostReason: order.lostReason,
    actionRequired: order.actionRequired,
    actionRequiredNote: order.actionRequiredNote,
    preparedBy: order.preparedBy,
    client: order.client,
    billing: {
      cycleType: order.billingCycleType,
      cycleDay: order.billingCycleDay,
      cycleDays: order.billingCycleDays,
      isRecurring: order.isRecurring,
      notBilled: order.notBilled,
      nextBillingDate: order.nextBillingDate,
      lastBilledDate: order.lastBilledDate,
      periodsCompleted: order.billingPeriodsCompleted,
      recurrenceEndDate: order.recurrenceEndDate,
      taxRate: Number(order.taxRate),
      discountType: order.discountType,
      discountValue: Number(order.discountValue ?? 0),
      discountAmount: Number(order.discountAmount),
      paymentTerms: order.paymentTerms,
      total: Number(order.total),
    },
    invoiced: {
      count: invoices._count,
      billed: Number(invoices._sum.total ?? 0),
      paid: Number(invoices._sum.amountPaid ?? 0),
    },
    quoteLinks: {
      count: links._count,
      latestExpiry: links._max.expiresAt,
    },
  };
}

/** Who can be handed an order to prepare. */
export async function getFloorStaff(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
