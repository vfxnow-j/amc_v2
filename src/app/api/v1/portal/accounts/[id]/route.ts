import { prisma } from '@/lib/prisma'
import { badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { putPortalAccount } from '@/lib/portal/accounts'

/**
 * PUT /v1/accounts/{portal_account_id} (docs/portal-api.md §3).
 *
 * Upsert keyed on (this portal client, portal_account_id) — a portal client
 * can never reach another one's account this way, since the lookup is always
 * scoped by the caller's own id from the token. See src/lib/portal/accounts.ts
 * for the create/update/re-link rules.
 */
export const PUT = withPortal<{ id: string }>('portal:write', async (req, { portal, params, setAccountId }) => {
  const portalAccountId = params.id
  if (!portalAccountId) throw badRequest('Missing portal_account_id')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('The body must be JSON.')
  }

  const { id, dto } = await putPortalAccount(prisma, portal.id, portalAccountId, body)
  setAccountId(id)
  return portalOk(dto)
})
