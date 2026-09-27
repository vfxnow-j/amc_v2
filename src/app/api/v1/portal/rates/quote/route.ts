import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { PortalError, badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { requireAccount } from '@/lib/portal/tenancy'
import { loadOfferPricing } from '@/lib/portal/offers'
import { loadCreditTiers, tierFor } from '@/lib/portal/tiers'
import {
  capacityWindowEnd,
  offerCapacity,
  parseQuoteRequest,
  priceQuote,
  quoteResponseBody,
  quoteSnapshotLines,
  type CapacitySignal,
} from '@/lib/portal/quote'
import { loadAssetCapacity } from '@/lib/portal/capacity-load'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * POST /v1/rates/quote — account-specific prices from the existing engines
 * (docs/portal-api.md §4). Body: { account_id, window: { start, end? }, lines:
 * [{ offer_id, qty, solution: rental|rto|flow, term_months? }] }.
 *
 * Every line comes back with unit_price (display: per unit per month; Flow =
 * month 1), line_total, one_time, demand, allowed and reason. `total` is the
 * allowed lines only. RTO is always refused (solution_not_allowed) until the owner
 * defines its portal basis. A window.start in the past is a 422.
 *
 * The priced snapshot — per-component rate and pricing type, and the Flow basis
 * and knobs an order needs to reproduce the figures — is stored in
 * portal_rate_quotes under rate_id and is never returned.
 */
export const POST = withPortal('portal:quote', async (req, { portal, setAccountId }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('The body must be JSON.')
  }
  const parsed = parseQuoteRequest(body)
  if (!parsed.ok) {
    throw new PortalError(422, 'validation_failed', parsed.message, { details: [{ path: parsed.field, message: parsed.message }] })
  }
  const request = parsed.value
  const account = await requireAccount(portal.id, request.accountId)
  setAccountId(account.id)

  const now = new Date()
  const [tiers, flowDefaults, loaded] = await Promise.all([
    loadCreditTiers(prisma),
    loadFlowDefaults(prisma),
    loadOfferPricing(prisma, request.lines.map((l) => l.offerId), now),
  ])

  // Capacity over the whole quote window (the rental end, or the longest Flow term),
  // read only for PUBLISHED offers: a hidden or retired offer's stock is never looked at.
  const to = capacityWindowEnd(request.window, request.lines)
  const liveOffers = [...loaded.assetsByOffer.keys()].filter((id) => loaded.pricing.get(id)?.visible)
  const assetIds = [...new Set(liveOffers.flatMap((id) => loaded.assetsByOffer.get(id)!.map((a) => a.assetId)))]
  const perAsset = new Map<string, { available: number; demand: 'normal' | 'high' }>()
  for (const id of assetIds) {
    const cap = await loadAssetCapacity(id, now, { from: request.window.start, to })
    if (cap) perAsset.set(id, { available: cap.pool.available_now, demand: cap.pool.demand })
  }
  const capacity = (offerId: string): CapacitySignal =>
    loaded.pricing.get(offerId)?.visible ? offerCapacity(loaded.assetsByOffer.get(offerId), perAsset) : null

  const tier = tierFor(tiers, account.creditTier)
  const result = priceQuote(request.lines, {
    offers: loaded.pricing,
    tier,
    verificationLevel: account.verificationLevel,
    flowDefaults,
    window: request.window,
    capacity,
  })

  const validUntil = new Date(now.getTime() + result.validForMs)
  const requestJson = {
    account_id: request.accountId,
    window: { start: request.window.start.toISOString(), end: request.window.end?.toISOString() ?? null },
    lines: request.lines.map((l) => ({ offer_id: l.offerId, qty: l.qty, solution: l.solution, term_months: l.term })),
  }
  const snapshot = await prisma.portalRateQuote.create({
    data: {
      accountId: account.id,
      requestHash: createHash('sha256').update(JSON.stringify(requestJson)).digest('hex'),
      request: requestJson,
      lines: quoteSnapshotLines(tier.id, result) as unknown as Prisma.InputJsonValue,
      total: result.total,
      validUntil,
    },
    select: { id: true },
  })

  return portalOk(quoteResponseBody(snapshot.id, validUntil, result))
})
