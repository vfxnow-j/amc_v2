'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { logAudit } from './audit'
import { analyzeAssetPricing, analyzeAllAssetPricing } from '@/lib/market-prices/analyzer'
import { searchMarketPrice } from '@/lib/market-prices/search'

/**
 * Update market price for an asset.
 */
export async function updateMarketPrice(
  assetId: string,
  price: number,
  source: string,
  notes?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { name: true, marketPrice: true },
  })

  if (!existing) throw new Error('Asset not found')

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      marketPrice: price,
      marketPriceSource: source,
      marketPriceUpdatedAt: new Date(),
      marketPriceNotes: notes || null,
    },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Asset',
    entityId: assetId,
    oldValues: { marketPrice: existing.marketPrice ? Number(existing.marketPrice) : null },
    newValues: { marketPrice: price, source },
    userId: authResult.userId,
  })

  revalidatePath(`/dashboard/assets/${assetId}`)
  revalidatePath('/dashboard/reports/pricing')

  return { success: true }
}

/**
 * Search for market prices online.
 */
export async function searchMarketPrices(assetId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { name: true, manufacturer: true, model: true },
  })

  if (!asset) throw new Error('Asset not found')

  const results = await searchMarketPrice(asset.name, asset.manufacturer, asset.model)
  return serialize(results)
}

/**
 * Get pricing analysis for a single asset.
 */
export async function getAssetPricingAnalysis(assetId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const analysis = await analyzeAssetPricing(assetId)
  if (!analysis) throw new Error('Asset not found')

  return analysis
}

/**
 * Get bulk pricing analysis for all assets (report).
 */
export async function getBulkPricingAnalysis() {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  return analyzeAllAssetPricing()
}

/**
 * Apply suggested rates to an asset.
 */
export async function applySuggestedRates(assetId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const analysis = await analyzeAssetPricing(assetId)
  if (!analysis) throw new Error('Asset not found')
  if (!analysis.suggestedDailyRate || !analysis.suggestedWeeklyRate || !analysis.suggestedMonthlyRate) {
    throw new Error('No suggested rates available — set a market price first')
  }

  const existing = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { dailyRate: true, weeklyRate: true, monthlyRate: true },
  })

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      dailyRate: analysis.suggestedDailyRate,
      weeklyRate: analysis.suggestedWeeklyRate,
      monthlyRate: analysis.suggestedMonthlyRate,
    },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Asset',
    entityId: assetId,
    oldValues: {
      dailyRate: existing?.dailyRate ? Number(existing.dailyRate) : null,
      weeklyRate: existing?.weeklyRate ? Number(existing.weeklyRate) : null,
      monthlyRate: existing?.monthlyRate ? Number(existing.monthlyRate) : null,
    },
    newValues: {
      dailyRate: analysis.suggestedDailyRate,
      weeklyRate: analysis.suggestedWeeklyRate,
      monthlyRate: analysis.suggestedMonthlyRate,
    },
    userId: authResult.userId,
  })

  revalidatePath(`/dashboard/assets/${assetId}`)
  revalidatePath('/dashboard/reports/pricing')

  return { success: true }
}
