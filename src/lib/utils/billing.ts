import { addDays, addWeeks, startOfMonth, addMonths, endOfMonth, lastDayOfMonth } from 'date-fns'
import { prisma } from '@/lib/prisma'
import type { BillingCycleType } from '@/lib/types'

/**
 * Calculate the next billing date based on the billing cycle configuration.
 * Shared utility used by reservations and recurring billing.
 */
export function calculateNextBillingDate(
  startDate: Date,
  billingCycleType: BillingCycleType,
  billingCycleDay: number,
  billingCycleDays?: number
): Date | null {
  const now = new Date()
  const start = new Date(startDate)

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

    case 'WEEKLY': {
      // Find the next occurrence of the specified day of week
      let nextBilling = new Date(start)
      const targetDay = billingCycleDay // 0 = Sunday, 6 = Saturday
      const currentDay = nextBilling.getDay()
      const daysUntilTarget = (targetDay - currentDay + 7) % 7
      nextBilling = addDays(nextBilling, daysUntilTarget || 7) // If same day, go to next week

      // If the calculated date is in the past, move forward
      while (nextBilling <= now) {
        nextBilling = addWeeks(nextBilling, 1)
      }
      result = nextBilling
      break
    }

    case 'MONTHLY': {
      // Monthly billing always falls on the 1st of the month.
      // Use UTC arithmetic directly to avoid local-timezone drift from date-fns.
      const year = start.getUTCFullYear()
      let month = start.getUTCMonth()

      // Start from the 1st of start's month; if start is past the 1st, go to next month
      if (start.getUTCDate() > 1 || start.getUTCHours() > 0) {
        month++
      }

      // Advance until we're in the future
       
      while (true) {
        const candidate = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0))
        if (candidate > now) {
          result = candidate
          break
        }
        month++
      }
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
  const db = tx || prisma
  const year = new Date().getFullYear()
  const lastInvoice = await db.invoice.findFirst({
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })
  let sequence = 1
  if (lastInvoice?.invoiceNumber) {
    const match = lastInvoice.invoiceNumber.match(/INV-\d{4}-(\d+)/)
    if (match) sequence = parseInt(match[1], 10) + 1
  }
  return `INV-${year}-${sequence.toString().padStart(5, '0')}`
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
  billingCycleDays?: number
): { periodStart: Date; periodEnd: Date } {
  const d = new Date(billingDate)

  switch (billingCycleType) {
    case 'MONTHLY': {
      // Period = 1st of the month being billed → last day of that month (UTC)
      const year = d.getUTCFullYear()
      const month = d.getUTCMonth()
      const periodStart = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0))
      // Day 0 of next month = last day of current month
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const periodEnd = new Date(Date.UTC(year, month, lastDay, 12, 0, 0, 0))
      return { periodStart, periodEnd }
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
    case 'WEEKLY': {
      const periodStart = new Date(d)
      const periodEnd = addDays(d, 6)
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
