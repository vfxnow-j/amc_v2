import { badRequest, notFound, portalOk } from '@/lib/portal/errors'
import { withPortal } from '@/lib/portal/with-portal'
import { loadPoolCapacity } from '@/lib/portal/capacity-load'
import { dayOf, type CapacityFigures } from '@/lib/portal/capacity'
import { businessToday } from '@/lib/billing/calendar'

/**
 * GET /v1/capacity?pool=<slug>[&from=YYYY-MM-DD&to=YYYY-MM-DD&qty=N]
 *
 * Private-cloud capacity for one pool, in the contract's availability shape
 * (docs/portal-api.md §2). The rules live in `lib/portal/capacity.ts`. With no
 * window the figures are for today; `qty` (default 1) is how many units
 * `next_available` has to find. Built by an explicit mapper — nothing from a
 * row reaches the response, and no per-asset breakdown or internal id does.
 */
export const GET = withPortal('portal:read', async (req) => {
  const params = req.nextUrl.searchParams
  const slug = params.get('pool')?.trim()
  if (!slug) throw badRequest('pool is required')
  if (slug.length > 100) throw badRequest('pool is not a valid slug')

  const from = optionalDay(params.get('from'), 'from')
  const to = optionalDay(params.get('to'), 'to')
  if (from && to && to < from) throw badRequest('to must not be before from')
  const qtyRaw = params.get('qty')
  const qty = qtyRaw === null ? 1 : Number(qtyRaw)
  if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) throw badRequest('qty must be a whole number from 1')

  // The business day in Los Angeles (noon UTC), not UTC's — which turns over at 5pm Pacific.
  const now = new Date()
  const today = businessToday(now)
  const result = await loadPoolCapacity(slug, today, { from, to, qty })
  if (!result || !result.pool_info) throw notFound('No such capacity pool')

  const windowFrom = from && dayOf(from) > dayOf(today) ? dayOf(from) : dayOf(today)
  return portalOk({
    pool: result.pool_info.slug,
    name: result.pool_info.name,
    unit_label: result.pool_info.unitLabel,
    window: { from: windowFrom, to: to && dayOf(to) > windowFrom ? dayOf(to) : windowFrom },
    qty,
    ...figures(result.pool),
    as_of: now.toISOString(),
  })
})

function figures(pool: CapacityFigures) {
  return {
    available_now: pool.available_now,
    total: pool.total,
    reserved: pool.reserved,
    tentative: pool.tentative,
    next_available: { date: pool.next_available.date, status: pool.next_available.status },
    demand: pool.demand,
  }
}

function optionalDay(value: string | null, name: string): Date | undefined {
  if (value === null || value === '') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${name} must be a date, YYYY-MM-DD`)
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || dayOf(date) !== value) throw badRequest(`${name} is not a real date`)
  return date
}
