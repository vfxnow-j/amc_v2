import { prisma } from "@/lib/prisma";
import { QUOTE_LOCKED_MESSAGE, quoteEditable } from "@/lib/orders/quote-lock";

/**
 * Refuse (by throwing) a change to what was quoted unless the order is a draft
 * or a revision — see lib/orders/quote-lock for the rule and its one exception.
 * A missing order is left for the caller's own "not found" to report.
 */
export async function assertQuoteEditable(reservationId: string): Promise<void> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true, reservationType: true },
  });
  if (order && !quoteEditable(order.status, order.reservationType)) throw new Error(QUOTE_LOCKED_MESSAGE);
}

/** The same check for an action that is handed a quote option, not an order. */
export async function assertQuoteEditableForPackage(packageId: string): Promise<void> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: { reservation: { select: { status: true, reservationType: true } } },
  });
  const order = pkg?.reservation;
  if (order && !quoteEditable(order.status, order.reservationType)) throw new Error(QUOTE_LOCKED_MESSAGE);
}
