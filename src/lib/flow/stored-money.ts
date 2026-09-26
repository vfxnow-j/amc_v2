/**
 * What a Flow order STORES, from its priced lines — the pure half of v1's
 * repriceFlowTx (src/lib/actions/reservations.ts ~302), split out so it can be
 * tested without a database. lib/flow/reprice.ts does the reads and writes.
 *
 * - Each line's rate/subtotal is its per-unit/extended CONTRACT value from
 *   priceFlowLines; the order subtotal is their sum.
 * - Discount, tax and total go through the same calculateReservationTotals every
 *   other order edit writes with.
 * - totalCost is measured off each line's snapshotted true cost (what the gear cost
 *   us), never the pricing basis, which may have been raised; margin follows.
 * - flowMonthlyPayment is the rate for the period the order is in, never contract ÷
 *   term: the schedule steps at each anniversary.
 * - The end date is the start plus the term.
 *
 * Funding is not an input here: it shapes the internal economics, never the price.
 *
 * Pure and client-safe.
 */
import { roundMoney } from '@/lib/pricing/periods'
import { calculateReservationTotals } from '@/lib/pricing/reservation-totals'
import { calendarDay, intendedDay } from '@/lib/billing/calendar'
import type { FlowBasis } from '@/lib/pricing/flow-basis'

type NumLike = number | string | { toString(): string } | null | undefined

const num = (v: NumLike): number => {
  if (v == null || v === '') return 0
  const n = Number(typeof v === 'object' ? v.toString() : v)
  return Number.isFinite(n) ? n : 0
}

const numOrNull = (v: NumLike): number | null => {
  if (v == null || v === '') return null
  const n = Number(typeof v === 'object' ? v.toString() : v)
  return Number.isFinite(n) ? n : null
}

/**
 * A stored day (noon UTC, lib/billing/calendar) plus whole months, on UTC calendar
 * components so it stays a stored day. A day past the target month's end lands on
 * its last day, as date-fns addMonths does (Jan 31 + 1 → Feb 28/29).
 */
export function addTermMonths(day: Date, months: number): Date {
  const d = intendedDay(new Date(day))
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + Math.round(months)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return calendarDay(y, m, Math.min(d.getUTCDate(), last))
}

export type FlowLineCost = { trueCost: number; costBasis: number }

/**
 * The true cost and pricing basis a Flow line is created with: true cost is the
 * landed-cost basis; the basis may be raised above it but never sits below it.
 */
export function flowCreateLineCost(explicitBasis: number | null | undefined, landedBasis: number): FlowLineCost {
  const explicit = explicitBasis != null && Number.isFinite(explicitBasis) && explicitBasis >= 0 ? explicitBasis : null
  return { trueCost: landedBasis, costBasis: Math.max(explicit ?? landedBasis, landedBasis) }
}

/**
 * Snapshot a line's true cost (and a missing basis) from the landed-cost basis, as
 * v1's repriceFlowTx does. Only asked of asset lines missing either figure.
 *
 * The true cost, once set, is never re-derived. Refused (`ok: false`) when the
 * asset's units are not fully costed: a Flow line must not be priced off a guess.
 */
export function flowSnapshotLineCost(
  stored: { trueCost: NumLike; costBasis: NumLike },
  basis: Pick<FlowBasis, 'basis' | 'incomplete'> | undefined,
  label: string,
): { ok: true; cost: FlowLineCost } | { ok: false; error: string } {
  if (!basis || !(basis.basis > 0) || basis.incomplete) {
    return {
      ok: false,
      error: `${label}: its units' landed cost is incomplete, so it cannot be priced as Flow. Fix the unit costs first.`,
    }
  }
  const trueCost = numOrNull(stored.trueCost) ?? basis.basis
  const storedBasis = numOrNull(stored.costBasis)
  const costBasis = storedBasis == null || storedBasis < trueCost ? trueCost : storedBasis
  return { ok: true, cost: { trueCost, costBasis } }
}

export type FlowMoneyOrder = {
  startDate: Date
  termMonths: number
  discountType?: string | null
  discountValue?: NumLike
  taxRate?: NumLike
  /** Already resolved: the active package's cost when it has one, else the order's. */
  deliveryCost?: NumLike
  returnCost?: NumLike
  shippingMarginType?: string | null
  shippingMargin?: NumLike
  rentalCreditAmount?: NumLike
  internalShippingCost?: NumLike
  subRentalCost?: NumLike
  hardwareCost?: NumLike
}

export type FlowPricedFigures = {
  rates: number[]
  subtotals: number[]
  contractValue: number
  monthlyNow: number
}

export type FlowStoredMoney = {
  lines: { rate: number; subtotal: number }[]
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  totalCost: number
  totalMargin: number
  flowContractValue: number
  flowMonthlyPayment: number
  endDate: Date
}

export function flowStoredMoney(
  lines: { trueCost?: NumLike; quantity: number }[],
  priced: FlowPricedFigures,
  order: FlowMoneyOrder,
): FlowStoredMoney {
  let subtotal = 0
  let itemCost = 0
  const out: { rate: number; subtotal: number }[] = []
  lines.forEach((line, k) => {
    const rate = priced.rates[k] ?? 0
    const lineSubtotal = priced.subtotals[k] ?? 0
    subtotal += lineSubtotal
    itemCost += num(line.trueCost) * line.quantity
    out.push({ rate, subtotal: lineSubtotal })
  })
  subtotal = roundMoney(subtotal)

  const { discountAmount, taxAmount, total } = calculateReservationTotals({
    itemsSubtotal: subtotal,
    discountType: order.discountType,
    discountValue: num(order.discountValue),
    taxRate: num(order.taxRate),
    deliveryCost: num(order.deliveryCost),
    returnCost: num(order.returnCost),
    shippingMarginType: order.shippingMarginType || null,
    shippingMargin: num(order.shippingMargin),
    rentalCreditAmount: num(order.rentalCreditAmount),
  })
  const totalCost = itemCost + num(order.internalShippingCost) + num(order.subRentalCost) + num(order.hardwareCost)

  return {
    lines: out,
    subtotal,
    discountAmount,
    taxAmount,
    total,
    totalCost,
    totalMargin: subtotal - totalCost,
    flowContractValue: priced.contractValue,
    flowMonthlyPayment: priced.monthlyNow,
    endDate: addTermMonths(order.startDate, order.termMonths),
  }
}
