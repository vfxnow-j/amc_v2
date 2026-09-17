import { addDays } from 'date-fns'
import { nextNumber } from '@/lib/numbering/next'
import type { BillingCycleType } from '@/lib/types'
import {
  DEFAULT_BILLING_ANCHOR,
  nextAnchoredBillingDate,
  periodFromAnchor,
  type BillingAnchor,
} from '@/lib/billing/calendar'

/**
 * Calculate the next billing date based on the billing cycle configuration.
 * Shared utility used by reservations and recurring billing.
 *
 * MONTHLY and WEEKLY bill on the business anchor (Settings → Business), not on
 * the order's own `billingCycleDay`: the first anchor after the term starts, or
 * after today for a term already under way. The old MONTHLY branch read "past
 * the 1st" off UTC hours, so a v1 start stored at Pacific midnight on the 1st
 * (`07:00Z`) counted as late and skipped its first month. Pass the anchor from
 * `getBillingAnchor()`; the default is the 1st and Monday.
 */
export function calculateNextBillingDate(
  startDate: Date,
  billingCycleType: BillingCycleType,
  billingCycleDay: number,
  billingCycleDays?: number,
  anchor: BillingAnchor = DEFAULT_BILLING_ANCHOR
): Date | null {
  const now = new Date()
  const start = new Date(startDate)

  if (billingCycleType === 'MONTHLY' || billingCycleType === 'WEEKLY') {
    return nextAnchoredBillingDate(start, billingCycleType, anchor)
  }

  let result: Date | null = null

  switch (billingCycleType) {
    case 'DAILY': {
      let nextBilling = addDays(start, 1)
      while (nextBilling <= now) {
        nextBilling = addDays(nextBilling, 1)
      }
      result = nextBilling
      break
    }

    // BI_WEEKLY previously fell through to `default` and returned null, so bi-weekly
    // orders never got a next billing date and the scheduler skipped them entirely.
    case 'BI_WEEKLY': {
      let nextBilling = addDays(start, 14)
      while (nextBilling <= now) {
        nextBilling = addDays(nextBilling, 14)
      }
      result = nextBilling
      break
    }

    case 'CUSTOM': {
      if (!billingCycleDays || billingCycleDays <= 0) return null

      // First billing is N days after start
      let nextBilling = addDays(start, billingCycleDays)

      // If in the past, keep adding intervals
      while (nextBilling <= now) {
        nextBilling = addDays(nextBilling, billingCycleDays)
      }
      result = nextBilling
      break
    }

    case 'ONE_TIME':
    default:
      return null // No recurring billing
  }

  // Set to noon UTC so client-side timezone conversion never shifts the date
  if (result) {
    result.setUTCHours(12, 0, 0, 0)
  }
  return result
}

/**
 * Generate a unique invoice number in the format INV-YYYY-NNNNN.
 * Accepts an optional prisma transaction client for use within transactions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateInvoiceNumber(tx?: any): Promise<string> {
  // Pattern and next number: Settings → Business → Numbering.
  return nextNumber('invoice', tx)
}

/**
 * Get the billing period boundaries for a given billing date.
 * MONTHLY: 1st of billing month → last day of billing month
 * DAILY: the billing date itself
 * WEEKLY: billing date → +6 days
 * BI_WEEKLY: billing date → +13 days
 * CUSTOM: billing date → +(cycleDays-1) days
 */
export function getBillingPeriod(
  billingDate: Date,
  billingCycleType: BillingCycleType,
  billingCycleDays?: number,
  anchor: BillingAnchor = DEFAULT_BILLING_ANCHOR
): { periodStart: Date; periodEnd: Date } {
  const d = new Date(billingDate)

  switch (billingCycleType) {
    case 'MONTHLY':
    case 'WEEKLY': {
      // The billing date up to the day before the next anchor — a whole month
      // or week when the date is on the anchor, a stretch when it is not.
      const { start, end } = periodFromAnchor(d, billingCycleType, anchor)
      return { periodStart: start, periodEnd: end }
    }
    case 'DAILY': {
      const periodStart = new Date(d)
      const periodEnd = new Date(d)
      periodStart.setUTCHours(12, 0, 0, 0)
      periodEnd.setUTCHours(12, 0, 0, 0)
      return { periodStart, periodEnd }
    }
    case 'BI_WEEKLY': {
      const periodStart = new Date(d)
      const periodEnd = addDays(d, 13)
      periodStart.setUTCHours(12, 0, 0, 0)
      periodEnd.setUTCHours(12, 0, 0, 0)
      return { periodStart, periodEnd }
    }
    case 'CUSTOM': {
      const days = billingCycleDays || 30
      const periodStart = new Date(d)
      const periodEnd = addDays(d, days - 1)
      periodStart.setUTCHours(12, 0, 0, 0)
      periodEnd.setUTCHours(12, 0, 0, 0)
      return { periodStart, periodEnd }
    }
    default:
      // ONE_TIME — just return the date itself
      d.setUTCHours(12, 0, 0, 0)
      return { periodStart: d, periodEnd: d }
  }
}
