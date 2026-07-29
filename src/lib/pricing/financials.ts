/**
 * One derivation of a reservation's money, shared by every surface that shows it.
 *
 * The order detail page used to recompute line amounts from rate × qty × periods
 * while the quote PDF, the public quote link and the emails all read the *stored*
 * `subtotal` columns. Those agree only while storage is current — so any order
 * whose rows predated a pricing change showed one total on screen and a different
 * one on the document the client actually received (RES-2026-00089: $11,980.29 on
 * screen, $8,800.00 on the PDF).
 *
 * Everything client-facing now derives through here, so a document can never quote a
 * number the order page doesn't show. The stored columns remain the billing record —
 * mutations keep them in step, and `scripts/reprice-term-subtotals.ts` repairs rows
 * written before the term-proration fix.
 */

import { calculatePeriods, computeItemSubtotal, roundMoney } from './periods'

export type FinancialItem = {
  rate: unknown
  quantity?: number | null
  pricingType: string
  isOneTime?: boolean | null
}

export type FinancialOrder = {
  startDate: Date | string
  endDate: Date | string
  isRecurring?: boolean | null
}

/** Line amount for one item over the order's term. Mirrors what the server persists. */
export function deriveItemAmount(item: FinancialItem, order: FinancialOrder): number {
  const periods = item.isOneTime
    ? 1
    : calculatePeriods(order.startDate, order.endDate, item.pricingType, order.isRecurring ?? false)
  return computeItemSubtotal(Number(item.rate) || 0, item.quantity || 1, periods)
}

/** Client-facing shipping cost after the order's margin is applied. */
export function applyShippingMargin(
  cost: number,
  marginType?: string | null,
  margin?: number | null
): number {
  if (!cost || !marginType || !margin || margin <= 0) return cost
  if (marginType === 'PERCENTAGE') return roundMoney(cost * (1 + margin / 100))
  return roundMoney(cost + margin)
}

/**
 * Full money breakdown for an order from its line rows.
 *
 * `items` must already be scoped to the package being quoted — alternative quote
 * packages carry their own lines and must not be summed into the active total.
 */
export function computeReservationFinancials(params: {
  order: FinancialOrder
  items: FinancialItem[]
  discountType?: string | null
  discountValue?: unknown
  taxRate?: unknown
  deliveryCost?: unknown
  returnCost?: unknown
  shippingMarginType?: string | null
  shippingMargin?: unknown
  rentalCreditAmount?: unknown
}): {
  itemAmounts: number[]
  itemsSubtotal: number
  discountAmount: number
  taxRate: number
  taxAmount: number
  deliveryCost: number
  returnCost: number
  total: number
} {
  const itemAmounts = params.items.map((item) => deriveItemAmount(item, params.order))
  const itemsSubtotal = roundMoney(itemAmounts.reduce((sum, amount) => sum + amount, 0))

  const discountValue = Number(params.discountValue) || 0
  let discountAmount = 0
  if (params.discountType === 'PERCENTAGE' && discountValue > 0) {
    discountAmount = roundMoney(itemsSubtotal * (discountValue / 100))
  } else if (params.discountType === 'FIXED' && discountValue > 0) {
    discountAmount = roundMoney(Math.min(discountValue, itemsSubtotal))
  }

  const credit = Number(params.rentalCreditAmount) || 0
  const afterCredit = itemsSubtotal - discountAmount - credit
  const taxRate = Number(params.taxRate) || 0
  const taxAmount = roundMoney(afterCredit * (taxRate / 100))

  const marginType = params.shippingMarginType ?? null
  const marginValue = Number(params.shippingMargin) || 0
  const deliveryCost = applyShippingMargin(Number(params.deliveryCost) || 0, marginType, marginValue)
  const returnCost = applyShippingMargin(Number(params.returnCost) || 0, marginType, marginValue)

  return {
    itemAmounts,
    itemsSubtotal,
    discountAmount,
    taxRate,
    taxAmount,
    deliveryCost,
    returnCost,
    total: roundMoney(afterCredit + taxAmount + deliveryCost + returnCost),
  }
}
