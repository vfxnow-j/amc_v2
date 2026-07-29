import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'

const DEFAULT_TARGET_MONTHS = 7

export type PricingClassification = 'underpriced' | 'overpriced' | 'fair' | 'unknown'

export type AssetPricingAnalysis = {
  assetId: string
  assetName: string
  category: string
  manufacturer: string | null
  model: string | null

  // Prices
  avgPurchasePrice: number | null
  marketPrice: number | null
  marketPriceSource: string | null
  marketPriceUpdatedAt: string | null

  // Market rental rate
  marketRentalRate: number | null
  marketRentalRateSource: string | null
  marketRentalRateUpdatedAt: string | null

  // Rental rates
  dailyRate: number | null
  weeklyRate: number | null
  monthlyRate: number | null

  // Revenue
  totalRevenue: number
  totalPurchaseValue: number
  totalUnits: number

  // ROI metrics
  monthsToPayback: number | null
  roiMultiple: number | null
  classification: PricingClassification

  // Suggested rates (based on target payback)
  suggestedDailyRate: number | null
  suggestedWeeklyRate: number | null
  suggestedMonthlyRate: number | null
  targetPaybackMonths: number
}

/**
 * Get the target payback months from settings (default 7).
 */
async function getTargetPaybackMonths(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: 'market_price_roi_target_months' },
  })

  if (setting?.value != null) {
    const val = Number(setting.value)
    if (!isNaN(val) && val > 0) return val
  }

  return DEFAULT_TARGET_MONTHS
}

/**
 * Analyze pricing and ROI for a single asset.
 */
export async function analyzeAssetPricing(assetId: string): Promise<AssetPricingAnalysis | null> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      model: true,
      dailyRate: true,
      weeklyRate: true,
      monthlyRate: true,
      marketPrice: true,
      marketPriceSource: true,
      marketPriceUpdatedAt: true,
      marketRentalRate: true,
      marketRentalRateSource: true,
      marketRentalRateUpdatedAt: true,
      totalQuantity: true,
      category: { select: { name: true } },
      units: {
        where: { status: { not: 'RETIRED' } },
        select: {
          purchasePrice: true,
          totalRevenue: true,
        },
      },
    },
  })

  if (!asset) return null

  const targetMonths = await getTargetPaybackMonths()

  const totalPurchaseValue = asset.units.reduce(
    (sum, u) => sum + (u.purchasePrice ? Number(u.purchasePrice) : 0),
    0
  )
  const totalRevenue = asset.units.reduce(
    (sum, u) => sum + Number(u.totalRevenue || 0),
    0
  )
  const avgPurchasePrice = asset.units.length > 0 && totalPurchaseValue > 0
    ? totalPurchaseValue / asset.units.length
    : null

  const monthlyRate = asset.monthlyRate ? Number(asset.monthlyRate) : null
  const dailyRate = asset.dailyRate ? Number(asset.dailyRate) : null
  const weeklyRate = asset.weeklyRate ? Number(asset.weeklyRate) : null
  const marketPrice = asset.marketPrice ? Number(asset.marketPrice) : null

  // Calculate months to payback (using purchase price and monthly rate)
  let monthsToPayback: number | null = null
  if (avgPurchasePrice && monthlyRate && monthlyRate > 0) {
    monthsToPayback = Math.round((avgPurchasePrice / monthlyRate) * 10) / 10
  }

  // ROI multiple
  const roiMultiple = totalPurchaseValue > 0
    ? Math.round((totalRevenue / totalPurchaseValue) * 100) / 100
    : null

  // Classification
  let classification: PricingClassification = 'unknown'
  if (monthsToPayback !== null) {
    if (monthsToPayback > 10) classification = 'underpriced'
    else if (monthsToPayback < 3) classification = 'overpriced'
    else classification = 'fair'
  }

  // Suggested rates based on target payback
  const purchaseBase = marketPrice || avgPurchasePrice
  let suggestedMonthlyRate: number | null = null
  let suggestedWeeklyRate: number | null = null
  let suggestedDailyRate: number | null = null

  if (purchaseBase && purchaseBase > 0) {
    suggestedMonthlyRate = Math.round((purchaseBase / targetMonths) * 100) / 100
    suggestedWeeklyRate = Math.round((suggestedMonthlyRate / 4) * 100) / 100
    suggestedDailyRate = Math.round((suggestedMonthlyRate / 22) * 100) / 100 // ~22 working days
  }

  return serialize({
    assetId: asset.id,
    assetName: asset.name,
    category: asset.category.name,
    manufacturer: asset.manufacturer,
    model: asset.model,
    avgPurchasePrice,
    marketPrice,
    marketPriceSource: asset.marketPriceSource,
    marketPriceUpdatedAt: asset.marketPriceUpdatedAt,
    marketRentalRate: asset.marketRentalRate ? Number(asset.marketRentalRate) : null,
    marketRentalRateSource: asset.marketRentalRateSource,
    marketRentalRateUpdatedAt: asset.marketRentalRateUpdatedAt,
    dailyRate,
    weeklyRate,
    monthlyRate,
    totalRevenue,
    totalPurchaseValue,
    totalUnits: asset.units.length,
    monthsToPayback,
    roiMultiple,
    classification,
    suggestedDailyRate,
    suggestedWeeklyRate,
    suggestedMonthlyRate,
    targetPaybackMonths: targetMonths,
  }) as AssetPricingAnalysis
}

/**
 * Analyze pricing for all assets (for the pricing report).
 */
export async function analyzeAllAssetPricing(): Promise<AssetPricingAnalysis[]> {
  const assets = await prisma.asset.findMany({
    where: {
      totalQuantity: { gt: 0 },
      units: { some: { status: { not: 'RETIRED' } } },
    },
    select: { id: true },
    orderBy: { name: 'asc' },
  })

  const results: AssetPricingAnalysis[] = []
  for (const asset of assets) {
    const analysis = await analyzeAssetPricing(asset.id)
    if (analysis) results.push(analysis)
  }

  return results
}
