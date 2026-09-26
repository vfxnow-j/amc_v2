/**
 * The stored-money rule the order actions write with: discount, rental credit,
 * tax, then client-facing shipping. Moved verbatim out of actions/reservations.ts
 * so the Flow repricer (lib/flow/reprice.ts), which cannot live in a 'use server'
 * module, writes totals exactly the way every other order edit does.
 *
 * Deliberately unrounded, as it always was: lib/pricing/financials.ts is the
 * rounded, display-side derivation.
 *
 * Pure, no server-only imports.
 */

// Apply margin to a shipping cost to get the client-facing price
export function applyShippingMargin(cost: number, marginType?: string | null, margin?: number | null): number {
  if (!marginType || !margin || margin <= 0) return cost
  if (marginType === 'PERCENTAGE') return Math.round(cost * (1 + margin / 100) * 100) / 100
  return Math.round((cost + margin) * 100) / 100 // FIXED
}

// Centralized reservation total calculation with discount, tax, and logistics
export function calculateReservationTotals(params: {
  itemsSubtotal: number
  discountType?: string | null
  discountValue?: number
  taxRate: number
  deliveryCost?: number | null
  returnCost?: number | null
  shippingMarginType?: string | null
  shippingMargin?: number | null
  rentalCreditAmount?: number
}) {
  let discountAmount = 0
  if (params.discountType === 'PERCENTAGE' && params.discountValue && params.discountValue > 0) {
    discountAmount = params.itemsSubtotal * (params.discountValue / 100)
  } else if (params.discountType === 'FIXED' && params.discountValue && params.discountValue > 0) {
    discountAmount = Math.min(params.discountValue, params.itemsSubtotal)
  }

  const afterDiscount = params.itemsSubtotal - discountAmount
  const creditAmount = params.rentalCreditAmount || 0
  const afterCredit = afterDiscount - creditAmount
  const taxAmount = afterCredit * (params.taxRate / 100)
  const clientDelivery = applyShippingMargin(params.deliveryCost || 0, params.shippingMarginType, params.shippingMargin)
  const clientReturn = applyShippingMargin(params.returnCost || 0, params.shippingMarginType, params.shippingMargin)
  const logistics = clientDelivery + clientReturn
  const total = afterCredit + taxAmount + logistics

  return { discountAmount, taxAmount, total }
}

// `marginPercent` is stored as Decimal(5,2), so anything outside [-999.99, 999.99]
// triggers a Postgres numeric overflow. The form's auto-margin math (rate × cost ratio)
// can easily blow past this when an asset's purchase price is far larger than its
// rental rate — e.g. a $30k workstation rented at $2k/mo computes to ~-1268%. Margin
// is only meaningful for SALE/CLOUD items anyway, so we drop it entirely for rentals
// and clamp it for sales as a safety net.
export function sanitizeMarginPercent(margin: number | null | undefined, reservationType: string): number | null {
  if (margin == null || !Number.isFinite(margin)) return null
  if (reservationType !== 'SALE' && reservationType !== 'CLOUD') return null
  if (margin > 999.99) return 999.99
  if (margin < -999.99) return -999.99
  return margin
}
