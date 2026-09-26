/**
 * One billing stretch of a recurring order, priced: which lines bill, the
 * discount, tax, and what rides on the first invoice only.
 *
 * The quote's "Monthly payment" line, the billing run and the manual first
 * invoice all price through here, so what the client is told each month is
 * what they are invoiced. Before this the billing run summed rate × qty over
 * every line on the order — parts already in a system's price, lines from quote
 * options the client didn't choose, one-time charges every month — and never
 * applied the discount (found 2026-09-26).
 *
 * Owner rules: a percentage discount comes off every period; a fixed amount
 * comes off once, on the first invoice (as revenue earned counts it,
 * lib/billing/earned.ts). Delivery and return are charged once, untaxed, as
 * computeReservationFinancials treats them. Pure — no prisma, no next.
 */
import { applyShippingMargin } from '@/lib/pricing/financials'
import { roundMoney } from '@/lib/pricing/periods'

export type CycleLine = {
  description: string
  assetId: string | null
  rate: number
  quantity: number
  pricingType: string
  isOneTime: boolean
  includedInParent: boolean
}

export type CycleTerms = {
  discountType: string | null
  discountValue: number
  taxRate: number
  /** Client-facing, after the shipping margin. */
  deliveryCost: number
  returnCost: number
}

export type CycleInvoiceLine = { description: string; quantity: number; unitPrice: number; amount: number; assetId: string | null }

export type CycleInvoice = {
  items: CycleInvoiceLine[]
  itemsSubtotal: number
  discount: number
  taxable: number
  taxAmount: number
  oneTimeCharges: number
  subtotal: number
  total: number
}

export function cycleInvoice(input: {
  lines: CycleLine[]
  /** Periods' worth this stretch bills: 1 for a whole period, 11/30 for a Sep 20–30 stub. */
  share: number
  first: boolean
  terms: CycleTerms
  /** Appended inside each recurring line's "(… rate)" label, e.g. " × 0.37, Sep 20 – Sep 30". */
  shareNote?: string
}): CycleInvoice {
  const { share, first, terms } = input
  const items: CycleInvoiceLine[] = []
  let itemsSubtotal = 0
  for (const l of input.lines) {
    if (l.includedInParent) continue
    if (l.isOneTime && !first) continue
    const quantity = l.quantity || 1
    const amount = roundMoney(quantity * l.rate * (l.isOneTime ? 1 : share))
    itemsSubtotal += amount
    items.push({
      description: l.isOneTime ? `${l.description} (one-time)` : `${l.description} (${l.pricingType} rate${input.shareNote ?? ''})`,
      quantity,
      unitPrice: l.rate,
      amount,
      assetId: l.assetId,
    })
  }
  itemsSubtotal = roundMoney(itemsSubtotal)

  let discount = 0
  if (terms.discountType === 'PERCENTAGE' && terms.discountValue > 0) {
    discount = roundMoney((itemsSubtotal * terms.discountValue) / 100)
  } else if (terms.discountType === 'FIXED' && terms.discountValue > 0 && first) {
    discount = roundMoney(Math.min(terms.discountValue, itemsSubtotal))
  }
  if (discount > 0) {
    items.push({
      description: terms.discountType === 'PERCENTAGE' ? `Discount (${terms.discountValue}%)` : 'Discount',
      quantity: 1,
      unitPrice: -discount,
      amount: -discount,
      assetId: null,
    })
  }

  const taxable = roundMoney(itemsSubtotal - discount)
  const taxAmount = roundMoney((taxable * terms.taxRate) / 100)

  let oneTimeCharges = 0
  if (first) {
    for (const [label, cost] of [['Delivery', terms.deliveryCost], ['Return', terms.returnCost]] as const) {
      if (cost > 0) {
        items.push({ description: label, quantity: 1, unitPrice: cost, amount: cost, assetId: null })
        oneTimeCharges += cost
      }
    }
  }
  oneTimeCharges = roundMoney(oneTimeCharges)

  const subtotal = roundMoney(taxable + oneTimeCharges)
  return { items, itemsSubtotal, discount, taxable, taxAmount, oneTimeCharges, subtotal, total: roundMoney(subtotal + taxAmount) }
}

export function toCycleLine(item: {
  asset?: { name: string } | null
  description?: string | null
  assetId: string | null
  rate: unknown
  quantity?: number | null
  pricingType: string
  isOneTime?: boolean | null
  includedInParent?: boolean | null
}): CycleLine {
  return {
    description: item.asset?.name || item.description || 'Ad-hoc item',
    assetId: item.assetId,
    rate: Number(item.rate) || 0,
    quantity: Number(item.quantity) || 1,
    pricingType: item.pricingType,
    isOneTime: !!item.isOneTime,
    includedInParent: !!item.includedInParent,
  }
}

export function cycleTermsFor(order: {
  discountType: string | null
  discountValue: unknown
  taxRate: unknown
  deliveryCost: unknown
  returnCost: unknown
  shippingMarginType?: string | null
  shippingMargin?: unknown
}): CycleTerms {
  const marginType = order.shippingMarginType ?? null
  const margin = Number(order.shippingMargin) || 0
  return {
    discountType: order.discountType,
    discountValue: Number(order.discountValue) || 0,
    taxRate: Number(order.taxRate) || 0,
    deliveryCost: applyShippingMargin(Number(order.deliveryCost) || 0, marginType, margin),
    returnCost: applyShippingMargin(Number(order.returnCost) || 0, marginType, margin),
  }
}
