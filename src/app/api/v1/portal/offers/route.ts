import { prisma } from '@/lib/prisma'
import { badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { listOffers, parseOfferFilters } from '@/lib/portal/offers'
import { loadCreditTiers, tierFor } from '@/lib/portal/tiers'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * GET /v1/offers?solution=&category=&software=
 *
 * The curated catalog (docs/portal-api.md §1): published offers with their specs,
 * category, software tags, allowed solutions and terms, and price RANGES at the
 * default tier — never an exact price, and nothing that depends on an account.
 * `category` matches a category id or name; `software` one tag (case-insensitive).
 */
export const GET = withPortal('portal:read', async (req) => {
  const filters = parseOfferFilters(req.nextUrl.searchParams)
  if (!filters.ok) throw badRequest(filters.message)
  const [tiers, flowDefaults] = await Promise.all([loadCreditTiers(prisma), loadFlowDefaults(prisma)])
  const offers = await listOffers(prisma, filters.value, { tier: tierFor(tiers, null), flowDefaults, today: new Date() })
  return portalOk(offers)
})
