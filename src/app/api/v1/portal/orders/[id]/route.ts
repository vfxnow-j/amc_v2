import { portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { getPortalOrder } from '@/lib/portal/orders'

/** GET /v1/orders/{order_number} — one order, if it belongs to one of this portal's accounts. */
export const GET = withPortal<{ id: string }>('portal:read', async (_req, { portal, params }) => {
  return portalOk(await getPortalOrder(portal.id, params.id))
})
