import { prisma } from '@/lib/prisma'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'
import { OFFERING_FOR_SOLUTION } from '@/lib/inventory/unit-offering'
import { loadAssetCapacityByOffering } from './capacity-load'
import { loadOfferPricing } from './offers'
import { capacityWindowEnd, offerCapacity, priceQuote, type CapacitySignal, type ParsedQuoteRequest, type QuoteResult } from './quote'
import { loadCreditTiers, tierFor, type CreditTier, type PortalSolution } from './tiers'
import type { PortalAccountRef } from './tenancy'

/**
 * Price a quote request for an account, with stock read now: what
 * POST /v1/rates/quote returns, and what POST /v1/orders runs again on the
 * stored request to prove nothing moved — price, stock or the account's
 * standing — between the quote and the order.
 */
export async function priceForAccount(
  account: Pick<PortalAccountRef, 'creditTier' | 'verificationLevel'>,
  request: ParsedQuoteRequest,
  now: Date,
): Promise<{ tier: CreditTier; result: QuoteResult }> {
  const [tiers, flowDefaults, loaded] = await Promise.all([
    loadCreditTiers(prisma),
    loadFlowDefaults(prisma),
    loadOfferPricing(prisma, request.lines.map((l) => l.offerId), now),
  ])

  // Capacity over the whole quote window (the rental end, the longest Flow term's
  // end, or the sale horizon), read only for PUBLISHED offers: a hidden or
  // retired offer's stock is never looked at.
  const to = capacityWindowEnd(request.window, request.lines)
  const liveOffers = [...loaded.assetsByOffer.keys()].filter((id) => loaded.pricing.get(id)?.visible)
  const assetIds = [...new Set(liveOffers.flatMap((id) => loaded.assetsByOffer.get(id)!.map((a) => a.assetId)))]
  const byAsset = new Map<string, NonNullable<Awaited<ReturnType<typeof loadAssetCapacityByOffering>>>>()
  for (const id of assetIds) {
    const cap = await loadAssetCapacityByOffering(id, now, { from: request.window.start, to })
    if (cap) byAsset.set(id, cap)
  }
  // Per solution: only units ticked for it. No solution: every unit, which all
  // of an offer's lines share. RTO maps to nothing and is refused before this.
  const capacity = (offerId: string, solution?: PortalSolution): CapacitySignal => {
    if (!loaded.pricing.get(offerId)?.visible) return null
    const key = solution ? OFFERING_FOR_SOLUTION[solution as keyof typeof OFFERING_FOR_SOLUTION] : 'ALL'
    if (!key) return null
    const perAsset = new Map<string, { available: number; demand: 'normal' | 'high' }>()
    for (const [id, figures] of byAsset) perAsset.set(id, { available: figures[key].available_now, demand: figures[key].demand })
    return offerCapacity(loaded.assetsByOffer.get(offerId), perAsset)
  }

  const tier = tierFor(tiers, account.creditTier)
  const result = priceQuote(request.lines, {
    offers: loaded.pricing,
    tier,
    verificationLevel: account.verificationLevel,
    flowDefaults,
    window: request.window,
    capacity,
  })
  return { tier, result }
}
