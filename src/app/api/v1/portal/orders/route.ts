import { PortalError, badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { requireAccount } from '@/lib/portal/tenancy'
import { listPortalOrders, placePortalOrder } from '@/lib/portal/orders'
import { parseIdempotencyKey, parseOrderRequest } from '@/lib/portal/orders-core'
import { decodeCursor, parseLimit } from '@/lib/portal/paging'

/**
 * POST /v1/orders — place an order: exactly a rate (docs/portal-api.md, Phase 2).
 * Body { rate_id, account_id, site_id, po_number?, notes? } and the
 * Idempotency-Key header (the portal's quote id). 201 with the order; the same
 * key and body again → 200 with the same order; the same key with another body
 * → 422 idempotency_mismatch. Refusals: 409 rate_expired | rate_mismatch |
 * conflict (details per line), 404 for an unknown account or site.
 *
 * GET /v1/orders?updated_since=<ISO>&cursor=&limit= — every order of every
 * account of this portal changed since then, oldest change first; follow
 * next_cursor until it is null, then poll again from the last updated_at.
 */
export const POST = withPortal('portal:write', async (req, { portal, setAccountId }) => {
  const key = parseIdempotencyKey(req.headers.get('idempotency-key'))
  if (!key) throw new PortalError(400, 'idempotency_key_required', 'Send an Idempotency-Key header (your quote id; letters, digits, - and _).')
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('The body must be JSON.')
  }
  const parsed = parseOrderRequest(body)
  if (!parsed.ok) throw new PortalError(422, 'validation_failed', parsed.message, { details: [{ path: parsed.field, message: parsed.message }] })
  const account = await requireAccount(portal.id, parsed.value.accountId)
  setAccountId(account.id)
  const { status, order } = await placePortalOrder({ portalClientId: portal.id, account, request: parsed.value, idempotencyKey: key, now: new Date() })
  return portalOk(order, status)
})

export const GET = withPortal('portal:read', async (req, { portal }) => {
  const params = req.nextUrl.searchParams
  const limit = parseLimit(params.get('limit'))
  if (limit == null) throw badRequest('limit must be a whole number from 1 to 200.')
  const rawCursor = params.get('cursor')
  const cursor = rawCursor ? decodeCursor(rawCursor) : undefined
  if (rawCursor && !cursor) throw badRequest('cursor is not one this API returned.')
  const rawSince = params.get('updated_since')
  const since = rawSince ? new Date(rawSince) : undefined
  if (rawSince && Number.isNaN(since!.getTime())) throw badRequest('updated_since must be an ISO 8601 timestamp.')
  const page = await listPortalOrders({ portalClientId: portal.id, updatedSince: since, cursor: cursor ?? undefined, limit })
  return portalOk(page.data, 200, undefined, page.next_cursor)
})
