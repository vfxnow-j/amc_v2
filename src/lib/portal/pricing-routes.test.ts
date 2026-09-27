/**
 * Route-level checks for GET /v1/offers, GET /v1/public/price-ranges and
 * POST /v1/rates/quote: the exact functions each handler delegates to, run over
 * fixture rows shaped like the loaders' `select` (a fake db stands in for Prisma),
 * with every response body put through assertClientSafe.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertClientSafe, findClientUnsafeKeys } from './dto'
import { listOffers, listPublicRanges, loadOfferPricing } from './offers'
import { offerCapacity, priceQuote, quoteResponseBody, quoteSnapshotLines, type CapacitySignal } from './quote'
import { STANDARD_TIER } from './tiers'
import { FLOW_DEFAULTS_FALLBACK } from '@/lib/flow/defaults'

const cat = { id: 'c1', name: 'Workstations' }
const asset = (id: string, monthlyRate: number | null, extra: Record<string, unknown> = {}) => ({
  id, name: `Asset ${id}`, manufacturer: 'VFXnow', model: 'W1', retiredAt: null, category: cat,
  dailyRate: null, weeklyRate: null, monthlyRate, ...extra,
})
const base = {
  blurb: null, termsBySolution: null, software: ['Nuke'], specs: [{ key: 'GPU', value: 'RTX' }],
  sortOrder: 0, packageTemplate: null, pool: null, assetId: null,
}
const rows = [
  // Published and public; lists RTO, which must never come back.
  { ...base, id: 'off_ws', slug: 'ws', kind: 'ASSET', title: 'WS', solutions: ['rental', 'rto', 'flow'], isPublic: true, isVisible: true, assetId: 'a1', asset: asset('a1', 1200) },
  // Published, not public; a package with a WEEKLY line and a service with no override.
  {
    ...base, id: 'off_pkg', slug: 'pkg', kind: 'PACKAGE', title: 'Kit', solutions: ['rental'], isPublic: false, isVisible: true, asset: null,
    packageTemplate: {
      id: 't1', name: 'Kit', isActive: true,
      items: [
        { assetId: 'a2', serviceId: null, description: null, quantity: 1, rate: 90, pricingType: 'WEEKLY', isOneTime: false, asset: { name: 'Asset a2', category: cat, dailyRate: null, weeklyRate: null, monthlyRate: 500 }, service: null },
        { assetId: null, serviceId: 's1', description: null, quantity: 1, rate: null, pricingType: null, isOneTime: false, asset: null, service: { name: 'Setup', defaultRate: 150 } },
      ],
    },
  },
  // RTO only: nothing quotable, so it lists no solution and no band.
  { ...base, id: 'off_rto', slug: 'rto', kind: 'ASSET', title: 'RTO only', solutions: ['rto'], isPublic: true, isVisible: true, assetId: 'a3', asset: asset('a3', 800) },
  // Hidden.
  { ...base, id: 'off_hidden', slug: 'hid', kind: 'ASSET', title: 'Hidden', solutions: ['rental'], isPublic: true, isVisible: false, assetId: 'a4', asset: asset('a4', 999) },
]
const units = ['a1', 'a2', 'a3', 'a4'].map((assetId) => ({
  assetId, purchasePrice: 9000, landedCostAdjustment: 0, receivedDate: new Date('2026-01-15'), purchaseDate: null, soldAt: null, retiredAt: null,
}))

type Where = { id?: { in: string[] }; isVisible?: boolean; isPublic?: boolean }
const db = {
  portalOffer: {
    findMany: async ({ where }: { where: Where }) =>
      rows.filter((r) =>
        (!where.id || where.id.in.includes(r.id)) &&
        (where.isVisible === undefined || r.isVisible === where.isVisible) &&
        (where.isPublic === undefined || r.isPublic === where.isPublic)),
  },
  assetUnit: { findMany: async ({ where }: { where: { assetId: { in: string[] } } }) => units.filter((u) => where.assetId.in.includes(u.assetId)) },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const today = new Date('2026-10-01T12:00:00Z')
const ctx = { tier: STANDARD_TIER, flowDefaults: FLOW_DEFAULTS_FALLBACK, today }

test('GET /v1/offers: client-safe, published only, never RTO, never an exact price', async () => {
  const body = { data: await listOffers(db, {}, ctx) }
  assertClientSafe(body)
  assert.deepEqual(body.data.map((o) => o.id), ['off_ws', 'off_pkg', 'off_rto'])
  for (const o of body.data) {
    assert.ok(!o.solutions.some((s) => s.solution === 'rto'), o.id)
    assert.ok(!o.price_ranges.some((r) => r.solution === 'rto'), o.id)
  }
  const ws = body.data.find((o) => o.id === 'off_ws')!
  assert.deepEqual(ws.solutions.map((s) => s.solution), ['rental', 'flow'])
  assert.doesNotMatch(JSON.stringify(body), /1200|9000|defaultRate|"rate"/)
  // The package prices (its service line has no override, so the service's defaultRate is used).
  assert.equal(body.data.find((o) => o.id === 'off_pkg')!.price_ranges.length, 1)
  assert.deepEqual(body.data.find((o) => o.id === 'off_rto')!.solutions, [])
  // Filtering on rto finds nothing.
  assert.deepEqual(await listOffers(db, { solution: 'rto' }, ctx), [])
})

test('GET /v1/public/price-ranges: public offers only, bands only, no RTO, client-safe', async () => {
  const body = { data: await listPublicRanges(db, ctx) }
  assertClientSafe(body)
  assert.deepEqual(body.data.map((o) => o.offer_id), ['off_ws', 'off_rto'])
  const ws = body.data[0]
  assert.deepEqual(ws.price_ranges.map((r) => r.solution), ['rental', 'flow'])
  const rental = ws.price_ranges[0]
  assert.ok(rental.low < 1200 && rental.high > 1200)
  assert.deepEqual(body.data[1].price_ranges, [])
})

test('POST /v1/rates/quote: the handler pipeline, client-safe, RTO refused, total = allowed lines', async () => {
  const ids = ['off_ws', 'off_pkg', 'off_hidden']
  const loaded = await loadOfferPricing(db, ids, today)
  const perAsset = new Map([['a1', { available: 3, demand: 'high' as const }], ['a2', { available: 10, demand: 'normal' as const }]])
  const capacity = (id: string): CapacitySignal => (loaded.pricing.get(id)?.visible ? offerCapacity(loaded.assetsByOffer.get(id), perAsset) : null)
  const result = priceQuote(
    [
      { offerId: 'off_ws', qty: 1, solution: 'rental', term: null },
      { offerId: 'off_ws', qty: 1, solution: 'rto', term: 12 },
      { offerId: 'off_pkg', qty: 2, solution: 'rental', term: null },
      { offerId: 'off_hidden', qty: 1, solution: 'rental', term: null },
    ],
    { offers: loaded.pricing, tier: STANDARD_TIER, verificationLevel: 'none', flowDefaults: FLOW_DEFAULTS_FALLBACK, window: { start: new Date('2026-10-01T12:00:00Z'), end: new Date('2026-11-11T12:00:00Z') }, capacity },
  )
  const body = { data: quoteResponseBody('rq_1', new Date('2026-10-08T12:00:00Z'), result) }
  assertClientSafe(body)
  assert.deepEqual(body.data.lines.map((l) => [l.allowed, l.reason]), [
    [true, null], [false, 'solution_not_allowed'], [true, null], [false, 'offer_not_visible'],
  ])
  assert.equal(body.data.lines[0].demand, 'high')
  assert.equal(body.data.lines[3].demand, 'normal')
  // Oct 1 – Nov 11: 42 days = 6 weeks of the WEEKLY line (90 × 6 × 2) + the service once each.
  assert.equal(body.data.lines[2].line_total, 90 * 6 * 2 + 150 * 2)
  assert.equal(body.data.lines[2].one_time, 300)
  assert.equal(body.data.total, Math.round((body.data.lines[0].line_total! + body.data.lines[2].line_total!) * 100) / 100)
  // The snapshot keeps what the response must not: it is internal by design.
  const snap = quoteSnapshotLines('standard', result)
  assert.ok(findClientUnsafeKeys(snap).length > 0)
  assert.deepEqual(snap.internal[2].components!.map((c) => [c.rate, c.pricingType]), [[90, 'WEEKLY'], [150, 'PROJECT']])
})
