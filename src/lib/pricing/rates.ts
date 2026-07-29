/**
 * Which rate an order's billing period charges, and what that rate is.
 *
 * Pairs with ./periods.ts: this module picks the *unit* (the billing period defines
 * whether a line is priced per day, week or month) and derives the rate for that
 * unit; periods.ts then prorates whatever part of the term isn't a whole multiple of
 * it. Both halves are needed — picking the unit makes a 6-week order read as
 * "6 × weekly", but a 40-day order still has a remainder to prorate.
 *
 * Client-safe: no server-only imports, so the reservation form, the order detail page
 * and the server actions all resolve the same unit and the same rate.
 */

import type { BillingCycleType, PricingType } from '@/lib/types'

/**
 * The pricing unit an order's line items take from its billing cycle.
 *
 * CUSTOM bills every N days, so its natural unit is DAILY — mapping it to MONTHLY
 * (as this previously did in three separate copies) meant a "bill every 10 days"
 * order quietly priced off monthly rates.
 *
 * ONE_TIME is a single charge for the whole term, still priced off the monthly rate;
 * periods.ts multiplies it across the term because a one-time cycle is non-recurring.
 */
export function pricingTypeForBillingCycle(billingCycleType: string): PricingType {
  switch (billingCycleType) {
    case 'DAILY':
      return 'DAILY'
    case 'WEEKLY':
    case 'BI_WEEKLY':
      return 'WEEKLY'
    case 'CUSTOM':
      return 'DAILY'
    case 'MONTHLY':
    case 'ONE_TIME':
    default:
      return 'MONTHLY'
  }
}

/** Number of days each billing cycle covers, for the cycle-length hints in the UI. */
export function billingCycleDays(billingCycleType: string, customDays?: number | null): number | null {
  switch (billingCycleType) {
    case 'DAILY': return 1
    case 'WEEKLY': return 7
    case 'BI_WEEKLY': return 14
    case 'MONTHLY': return 30
    case 'CUSTOM': return customDays && customDays > 0 ? customDays : null
    default: return null
  }
}

type RateSource = { dailyRate?: unknown; weeklyRate?: unknown; monthlyRate?: unknown }

function toNumber(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'object' && 'toNumber' in (value as object)) {
    return (value as { toNumber(): number }).toNumber()
  }
  return Number(value) || 0
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Rate for a pricing unit, derived from whatever tier the asset actually has.
 *
 * Only 11 of ~224 catalog assets carry a weekly rate and 2 a daily one, so reading
 * `asset.weeklyRate` directly leaves most items with a monthly figure sitting under a
 * "/wk" label — a ~4x overcharge. The ladder fills the gap: a month is treated as
 * 4 weeks / 30 days.
 *
 * Note this makes the unit a deliberate pricing lever, not just a display choice: a
 * 6-week term is $544.56/unit priced monthly ($400 × 1.36) but $600.00 priced weekly
 * ($100 × 6), because a 4-week month prices short rentals richer than a 30.44-day one.
 * `billingCycleRepriceDelta` surfaces that gap when the cycle changes.
 */
export function deriveRentalRate(asset: RateSource, pricingType: PricingType): number {
  const daily = toNumber(asset.dailyRate)
  const weekly = toNumber(asset.weeklyRate)
  const monthly = toNumber(asset.monthlyRate)

  switch (pricingType) {
    case 'DAILY':
      if (daily > 0) return daily
      if (weekly > 0) return round(weekly / 7)
      if (monthly > 0) return round(monthly / 30)
      return 0
    case 'WEEKLY':
      if (weekly > 0) return weekly
      if (monthly > 0) return round(monthly / 4)
      if (daily > 0) return round(daily * 7)
      return 0
    case 'MONTHLY':
      if (monthly > 0) return monthly
      if (weekly > 0) return round(weekly * 4)
      if (daily > 0) return round(daily * 30)
      return 0
    case 'HOURLY':
      if (daily > 0) return round(daily / 8)
      if (monthly > 0) return round(monthly / 160)
      return 0
    case 'PROJECT':
    case 'CUSTOM':
      // Flat figures for the whole engagement — no auto-fill, the user sets the price
      return 0
    default:
      return monthly || weekly || daily || 0
  }
}

/** Cycles whose lines are term-priced. SALE/RTO keep their own pricing regardless. */
export const REPRICEABLE_CYCLES: readonly BillingCycleType[] = [
  'DAILY',
  'WEEKLY',
  'BI_WEEKLY',
  'MONTHLY',
  'CUSTOM',
  'ONE_TIME',
]
