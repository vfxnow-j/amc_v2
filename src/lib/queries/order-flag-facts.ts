import { prisma } from "@/lib/prisma";
import type { OrderAutoFacts } from "@/lib/flags/rules";

/**
 * What the auto-raise rules need to know about one order.
 *
 * `returnDue` is the order's end date, and only rentals and Flow orders have a
 * return to be late on. "Past due" invoices are the ones a client owes on:
 * sent, part-paid or already marked overdue, with a due date behind us.
 * Drafts, paid, cancelled and void invoices never count.
 */
export async function loadOrderAutoFacts(reservationId: string): Promise<OrderAutoFacts | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { reservationType: true, endDate: true },
  });
  if (!order) return null;

  const [unitsOut, pastDue, unitsDataFlagged] = await Promise.all([
    prisma.reservationItemUnit.count({
      where: {
        reservationItem: { reservationId },
        checkedOutAt: { not: null },
        checkedInAt: null,
      },
    }),
    prisma.invoice.count({
      where: {
        reservationId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        dueDate: { lt: new Date() },
      },
    }),
    prisma.reservationItemUnit.count({
      where: {
        reservationItem: { reservationId },
        assetUnit: { dataFlag: { not: null } },
      },
    }),
  ]);

  const hasReturn = order.reservationType === "RENTAL" || order.reservationType === "FLOW";
  return {
    returnDue: hasReturn ? order.endDate : null,
    unitsOut,
    invoicePastDue: pastDue > 0,
    unitsDataFlagged,
  };
}
