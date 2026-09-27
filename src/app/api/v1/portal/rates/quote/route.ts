import { createHash } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { PortalError, badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { requireAccount } from '@/lib/portal/tenancy'
import { parseQuoteRequest, quoteResponseBody, quoteSnapshotLines } from '@/lib/portal/quote'
import { priceForAccount } from '@/lib/portal/price-run'

/**
 * POST /v1/rates/quote — account-specific prices from the existing engines
 * (docs/portal-api.md §4). Body: { account_id, window: { start, end? }, lines:
 * [{ offer_id, qty, solution: rental|flow|sale, term_months? }] }. (rto is
 * accepted only to be refused: it is never offered in the portal.)
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
  const { tier, result } = await priceForAccount(account, request, now)

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
