import { prisma } from '@/lib/prisma'
import { portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { listPublicRanges } from '@/lib/portal/offers'
import { loadCreditTiers, tierFor } from '@/lib/portal/tiers'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * GET /v1/public/price-ranges
 *
 * Bands only, for the public site: offers that are both published and marked
 * public, each with its per-solution monthly band rounded out to $25 (see
 * lib/portal/price-ranges). It must never include an exact price.
 */
export const GET = withPortal('portal:read', async () => {
  const [tiers, flowDefaults] = await Promise.all([loadCreditTiers(prisma), loadFlowDefaults(prisma)])
  return portalOk(await listPublicRanges(prisma, { tier: tierFor(tiers, null), flowDefaults, today: new Date() }))
})
