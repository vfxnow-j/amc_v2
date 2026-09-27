import type { CapacityFigures, NextAvailable } from './capacity'
import type { OfferPart } from './offers'

/**
 * Live stock per offer and solution for GET /v1/offers (docs/portal-api.md,
 * Phase 2): what the catalog shows, polled about once a minute. A quote
 * re-checks over its own window; an order re-checks again when it is placed.
 */

export type SolutionAvailability = {
  /** Null: nothing physical behind the offer (services only), so no stock limit. */
  available_now: number | null
  next_available: NextAvailable
  demand: 'normal' | 'high'
}

/**
 * An offer's availability under one offering, from its parts' figures. A single
 * asset is its own figures; a package is as available as its scarcest part
 * (whole packages the parts allow), ready when its last part is ready, and in
 * high demand if any part is. An offer with no physical part has nothing to run
 * out of (available_now null). A part whose figures could not be read fails closed: nothing now,
 * nothing promised.
 */
export function combineParts(
  parts: OfferPart[],
  figuresOf: (assetId: string) => CapacityFigures | undefined,
  today: string,
): SolutionAvailability {
  if (!parts.length) {
    return { available_now: null, next_available: { date: today, status: 'confirmed' }, demand: 'normal' }
  }
  let available = Number.MAX_SAFE_INTEGER
  let demand: 'normal' | 'high' = 'normal'
  let date: string | null = null
  let status: NextAvailable['status'] = 'confirmed'
  for (const part of parts) {
    const f = figuresOf(part.assetId)
    if (!f) return { available_now: 0, next_available: { date: null, status: 'none' }, demand: 'normal' }
    available = Math.min(available, Math.floor(f.available_now / part.quantity))
    if (f.demand === 'high') demand = 'high'
    if (f.next_available.status === 'none') status = 'none'
    else if (status !== 'none') {
      if (f.next_available.status === 'expected') status = 'expected'
      if (f.next_available.date && (!date || f.next_available.date > date)) date = f.next_available.date
    }
  }
  return {
    available_now: available,
    next_available: status === 'none' ? { date: null, status: 'none' } : { date, status },
    demand,
  }
}

const OFFERING = { rental: 'RENTAL', sale: 'SALE', flow: 'FLOW' } as const
type Figures = Record<'RENTAL' | 'SALE' | 'FLOW', CapacityFigures>

/** Availability keyed by solution, for the solutions the offer is sold as. */
export function offerAvailability(
  solutions: string[],
  parts: OfferPart[],
  figuresByAsset: Map<string, Figures>,
  today: string,
): Partial<Record<keyof typeof OFFERING, SolutionAvailability>> {
  const out: Partial<Record<keyof typeof OFFERING, SolutionAvailability>> = {}
  for (const solution of solutions) {
    if (!(solution in OFFERING)) continue
    const key = OFFERING[solution as keyof typeof OFFERING]
    out[solution as keyof typeof OFFERING] = combineParts(parts, (id) => figuresByAsset.get(id)?.[key], today)
  }
  return out
}

/**
 * Whether any unit could ever serve this solution: every physical part has at
 * least one in-fleet unit ticked for it. A solution nothing is ticked for is
 * dropped from the offer rather than shown as permanently out of stock.
 */
export function solutionStocked(solution: string, parts: OfferPart[], figuresByAsset: Map<string, Figures>): boolean {
  if (!(solution in OFFERING)) return false
  if (!parts.length) return true
  const key = OFFERING[solution as keyof typeof OFFERING]
  return parts.every((part) => (figuresByAsset.get(part.assetId)?.[key].total ?? 0) > 0)
}
