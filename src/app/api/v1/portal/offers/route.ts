import { prisma } from '@/lib/prisma'
import { badRequest, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { listOfferEntries, parseOfferFilters } from '@/lib/portal/offers'
import { offerAvailability, solutionStocked } from '@/lib/portal/availability'
import { loadAssetCapacityByOffering } from '@/lib/portal/capacity-load'
import { dayOf } from '@/lib/portal/capacity'
import { loadCreditTiers, tierFor } from '@/lib/portal/tiers'
import { loadFlowDefaults } from '@/lib/flow/order-inputs'

/**
 * GET /v1/offers?solution=&category=&software=
 *
 * The curated catalog (docs/portal-api.md §1): published offers with their specs,
 * category, software tags, allowed solutions and terms, and price RANGES at the
 * default tier — never an exact price, and nothing that depends on an account —
 * plus live `availability` per solution (Phase 2), counting only units ticked
 * for that solution.
 * `category` matches a category id or name; `software` one tag (case-insensitive).
 */
export const GET = withPortal('portal:read', async (req) => {
  const filters = parseOfferFilters(req.nextUrl.searchParams)
  if (!filters.ok) throw badRequest(filters.message)
  const [tiers, flowDefaults] = await Promise.all([loadCreditTiers(prisma), loadFlowDefaults(prisma)])
  const today = new Date()
  const entries = await listOfferEntries(prisma, filters.value, { tier: tierFor(tiers, null), flowDefaults, today })

  // Live stock per solution, read once per asset across all listed offers.
  const assetIds = [...new Set(entries.flatMap((e) => e.parts.map((p) => p.assetId)))]
  const figures = new Map<string, NonNullable<Awaited<ReturnType<typeof loadAssetCapacityByOffering>>>>()
  for (const id of assetIds) {
    const f = await loadAssetCapacityByOffering(id, today)
    if (f) figures.set(id, f)
  }
  const day = dayOf(today)
  return portalOk(
    entries.map(({ dto, parts }) => {
      // Only solutions some unit is ticked for; the rest are dropped, not shown empty.
      const solutions = dto.solutions.filter((s) => solutionStocked(s.solution, parts, figures))
      const sold = new Set(solutions.map((s) => s.solution))
      return {
        ...dto,
        solutions,
        price_ranges: dto.price_ranges.filter((r) => sold.has(r.solution)),
        availability: offerAvailability([...sold], parts, figures, day),
      }
    }),
  )
})
