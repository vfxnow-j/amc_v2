import { prisma } from '@/lib/prisma'
import { getBillingAnchor } from '@/lib/settings/business'
import { paymentLineForOption, type PaymentLine } from './payment-schedule'

/**
 * The one shape every cycle-pricing query needs to price any option, not just
 * whichever is active: unlike `CYCLE_ORDER_INCLUDE` (cycle-invoice.ts) this
 * doesn't filter items or packages down first, because
 * {@link paymentLineForOption} does that scoping itself once it knows which
 * option it's pricing.
 */
export const PAYMENT_LINE_ORDER_INCLUDE = {
  items: { include: { asset: true } },
  packages: { select: { id: true, isActive: true, deliveryCost: true, returnCost: true } },
}

/**
 * The "Monthly payment …" line for an order, or null when it has none (sale,
 * one-time, RTO, Flow). With no `packageId`, prices the active option — the
 * figure the Billing card, the billing run and the signed Quote PDF all show.
 * With a `packageId`, prices that option instead (e.g. an option on the online
 * quote the client is looking at that isn't the active one) — see
 * {@link paymentLineForOption}.
 */
export async function paymentLineForOrder(reservationId: string, packageId?: string): Promise<PaymentLine | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: PAYMENT_LINE_ORDER_INCLUDE,
  })
  if (!order) return null
  return paymentLineForOption(order, order.items, order.packages, await getBillingAnchor(), packageId)
}
