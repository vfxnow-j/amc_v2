import { prisma } from '@/lib/prisma'
import { getBillingAnchor } from '@/lib/settings/business'
import { CYCLE_ORDER_INCLUDE, cycleTermsForOrder, toCycleLine } from './cycle-invoice'
import { paymentLine, paymentSchedule, type PaymentLine } from './payment-schedule'

/**
 * The "Monthly payment …" line for an order, or null when it has none (sale,
 * one-time, RTO, Flow). Prices through the same {@link cycleTermsForOrder} /
 * {@link toCycleLine} scoping the billing run and the manual first invoice
 * use, so this is always the figure the client is actually invoiced.
 */
export async function paymentLineForOrder(reservationId: string): Promise<PaymentLine | null> {
  const order = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: CYCLE_ORDER_INCLUDE,
  })
  if (!order) return null
  const schedule = paymentSchedule({
    type: order.reservationType,
    isRecurring: order.isRecurring,
    cycle: order.billingCycleType,
    start: order.startDate,
    termMonths: order.termMonths,
    anchor: await getBillingAnchor(),
    lines: order.items.map(toCycleLine),
    terms: cycleTermsForOrder(order),
  })
  return schedule ? paymentLine(schedule) : null
}
