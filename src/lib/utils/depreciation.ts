// Depreciation calculation utilities - for use in both server and client

export type DepreciationMethod =
  | 'STRAIGHT_LINE'
  | 'DECLINING_BALANCE'
  | 'SUM_OF_YEARS'
  | 'UNITS_OF_PRODUCTION'

/**
 * Calculate current depreciated value of an asset
 */
export function calculateDepreciatedValue(
  purchasePrice: number,
  purchaseDate: Date,
  depreciationMethod: DepreciationMethod,
  usefulLifeMonths: number,
  salvageValue: number = 0,
  receivedDate?: Date | null
): number {
  const now = new Date()
  const depreciationStart = receivedDate || purchaseDate
  const monthsOwned = Math.floor(
    (now.getTime() - depreciationStart.getTime()) / (1000 * 60 * 60 * 24 * 30)
  )

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
