import { badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { requireAccount } from '@/lib/portal/tenancy'
import { listPortalOrders } from '@/lib/portal/orders'
import { decodeCursor, parseLimit } from '@/lib/portal/paging'

/** GET /v1/accounts/{portal_account_id}/orders?cursor=&limit= — the account's orders, oldest change first. */
export const GET = withPortal<{ id: string }>('portal:read', async (req, { portal, params, setAccountId }) => {
  const account = await requireAccount(portal.id, params.id)
  setAccountId(account.id)
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'))
  if (limit == null) throw badRequest('limit must be a whole number from 1 to 200.')
  const rawCursor = req.nextUrl.searchParams.get('cursor')
  const cursor = rawCursor ? decodeCursor(rawCursor) : undefined
  if (rawCursor && !cursor) throw badRequest('cursor is not one this API returned.')
  const page = await listPortalOrders({ portalClientId: portal.id, accountId: account.id, cursor: cursor ?? undefined, limit })
  return portalOk(page.data, 200, undefined, page.next_cursor)
})
