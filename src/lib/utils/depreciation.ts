// Depreciation calculation utilities - for use in both server and client

export type DepreciationMethod =
  | 'STRAIGHT_LINE'
  | 'DECLINING_BALANCE'
  | 'SUM_OF_YEARS'
  | 'UNITS_OF_PRODUCTION'

type NumLike = number | string | { toString(): string } | null | undefined

/**
 * Whole months of depreciation booked as of `asOf`, full-month convention:
 * the month the unit is placed in service counts in full, and each month is
 * booked at its month-end — so received Aug 15 shows 1 month on Sep 17
 * (August) and 2 once September closes. Calendar months, matching
 * accounting's schedule. UTC components, so date-only values stored as UTC
 * midnight land in the month they were entered for. (Ported from v1,
 * 2026-09-17; it replaced a 30-day-month count.)
 */
export function depreciationMonthsElapsed(start: Date, asOf: Date = new Date()): number {
  const months =
    (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - start.getUTCMonth())
  return Math.max(0, months)
}

/** Depreciable cost: invoice price plus the unit's share of PO extras. */
export function unitCost(purchasePrice: NumLike, landedCostAdjustment?: NumLike): number {
  const price = Number(purchasePrice ?? 0)
  if (!price) return 0
  return Math.round((price + Number(landedCostAdjustment ?? 0)) * 100) / 100
}

/**
 * Calculate current depreciated value of an asset
 */
export function calculateDepreciatedValue(
  purchasePrice: number,
  purchaseDate: Date,
  depreciationMethod: DepreciationMethod,
  usefulLifeMonths: number,
  salvageValue: number = 0,
  receivedDate?: Date | null,
  // As of when. Defaults to now; the depreciation report passes the start and
  // end of a period to get that period's expense from this same schedule.
  now: Date = new Date()
): number {
  // Depreciation starts when the unit is placed in service (received); older
  // records predating receiving fall back to the purchase date
  const depreciationStart = receivedDate || purchaseDate
  const monthsOwned = depreciationMonthsElapsed(depreciationStart, now)

  if (monthsOwned >= usefulLifeMonths) {
    return salvageValue
  }

  const depreciableAmount = purchasePrice - salvageValue

  switch (depreciationMethod) {
    case 'STRAIGHT_LINE': {
      const monthlyDepreciation = depreciableAmount / usefulLifeMonths
      return Math.max(salvageValue, purchasePrice - monthlyDepreciation * monthsOwned)
    }
    case 'DECLINING_BALANCE': {
      const rate = 2 / usefulLifeMonths
      let currentValue = purchasePrice
      for (let i = 0; i < monthsOwned; i++) {
        currentValue = Math.max(salvageValue, currentValue * (1 - rate))
      }
      return currentValue
    }
    default:
      return purchasePrice
  }
}

/**
 * Calculate rate based on pricing type
 */
export function calculateRate(
  dailyRate: number,
  pricingType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'PROJECT' | 'CUSTOM'
): number {
  switch (pricingType) {
    case 'DAILY':
      return dailyRate
    case 'WEEKLY':
      return dailyRate * 5 // 5-day week rate (discount)
    case 'MONTHLY':
      return dailyRate * 20 // 20-day month rate (bigger discount)
    default:
      return dailyRate
  }
}
