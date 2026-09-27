import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { PortalError, badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { requireAccount } from '@/lib/portal/tenancy'
import { loadOfferPricing } from '@/lib/portal/offers'
import { loadCreditTiers, tierFor } from '@/lib/portal/tiers'
import { parseQuoteRequest, priceQuote, termEnd, type CapacitySignal } from '@/lib/portal/quote'
import { loadAssetCapacity } from '@/lib/portal/capacity-load'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * POST /v1/rates/quote — account-specific prices from the existing engines
 * (docs/portal-api.md §4). Body: { account_id, window: { start, end? }, lines:
 * [{ offer_id, qty, solution: rental|rto|flow, term_months? }] }.
 *
 * Every line comes back with unit_price (per unit per month; Flow = month 1),
 * line_total, demand, allowed and reason. The priced snapshot — including the
 * Flow basis and knobs an order needs to reproduce the figures — is stored in
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

  // Capacity over the whole quote window: the rental end, or the longest term.
  let to = request.window.end ?? request.window.start
  for (const l of request.lines) {
    if (l.term != null) {
      const end = termEnd(request.window.start, l.term)
      if (end > to) to = end
    }
  }
  const assetIds = [...new Set([...loaded.assetsByOffer.values()].flat().map((a) => a.assetId))]
  const perAsset = new Map<string, { available: number; demand: 'normal' | 'high' }>()
  for (const id of assetIds) {
    const cap = await loadAssetCapacity(id, now, { from: request.window.start, to })
    if (cap) perAsset.set(id, { available: cap.pool.available_now, demand: cap.pool.demand })
  }
  // An offer's capacity is its scarcest part: whole offers the units allow.
  const capacity = (offerId: string): CapacitySignal => {
    const parts = loaded.assetsByOffer.get(offerId)
    if (!parts?.length) return null
    let available = Infinity
    let demand: 'normal' | 'high' = 'normal'
    for (const p of parts) {
      const c = perAsset.get(p.assetId)
      if (!c) return null
      available = Math.min(available, Math.floor(c.available / p.quantity))
      if (c.demand === 'high') demand = 'high'
    }
    return { available, demand }
  }

  const result = priceQuote(request.lines, {
    offers: loaded.pricing,
    tier: tierFor(tiers, account.creditTier),
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
      lines: { tier: tierFor(tiers, account.creditTier).id, client: result.lines, internal: result.internal } as unknown as Prisma.InputJsonValue,
      total: result.total,
      validUntil,
    },
    select: { id: true },
  })

  return portalOk({
    rate_id: snapshot.id,
    valid_until: validUntil.toISOString(),
    total: result.total,
    lines: result.lines,
  })
})
