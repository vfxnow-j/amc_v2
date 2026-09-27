import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  priceQuote,
  parseQuoteRequest,
  FLOW_QUOTE_VALID_MS,
  QUOTE_VALID_MS,
  type OfferPricing,
  type QuoteContext,
  type QuoteRequestLine,
} from './quote'
import { mergeCreditTiers, tierFor, STANDARD_TIER } from './tiers'
import { FLOW_DEFAULTS_FALLBACK, applyFlowDefaults } from '@/lib/flow/defaults'
import { flowConfigFromSettings, priceFlowLines } from '@/lib/pricing/flow-lines'
import { flowClientQuote } from '@/lib/pricing/flow-client-quote'
import { assertClientSafe } from './dto'
import { offerRanges } from './offers'

const ws: OfferPricing = {
  id: 'off_ws',
  visible: true,
  solutions: ['rental', 'rto', 'flow'],
  termsBySolution: null,
  components: [{
    assetId: 'a_ws',
    name: 'Workstation',
    quantity: 1,
    assetRates: { dailyRate: null, weeklyRate: null, monthlyRate: '400.00' },
    overrideRate: null,
    overridePricingType: null,
    isOneTime: false,
    flowBasis: { basis: 6000, incomplete: false },
  }],
}
const hidden: OfferPricing = { ...ws, id: 'off_hidden', visible: false }
const rentalOnly: OfferPricing = { ...ws, id: 'off_rent', solutions: ['rental'] }
const noRate: OfferPricing = {
  ...ws,
  id: 'off_norate',
  components: [{ ...ws.components[0], assetRates: { monthlyRate: null }, flowBasis: { basis: 0, incomplete: true } }],
}
const pkg: OfferPricing = {
  id: 'off_pkg',
  visible: true,
  solutions: ['rental', 'flow'],
  termsBySolution: { flow: [24] },
  components: [
    { ...ws.components[0], quantity: 2 },
    { assetId: 'a_mon', name: 'Monitor', quantity: 1, assetRates: { weeklyRate: 50 }, overrideRate: 150, overridePricingType: 'MONTHLY', isOneTime: false, flowBasis: { basis: 800, incomplete: false } },
  ],
}

const ctx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  offers: new Map([ws, hidden, rentalOnly, noRate, pkg].map((o) => [o.id, o])),
  tier: STANDARD_TIER,
  verificationLevel: 'agreement_and_coi',
  flowDefaults: FLOW_DEFAULTS_FALLBACK,
  window: { start: new Date('2026-10-01T12:00:00Z'), end: new Date('2026-12-31T12:00:00Z') },
  capacity: () => ({ available: 10, demand: 'normal' }),
  ...over,
})
const line = (offerId: string, solution: QuoteRequestLine['solution'], term: number | null = null, qty = 1): QuoteRequestLine => ({ offerId, qty, solution, term })

test('rental: the asset monthly rate over the window, as createReservation prices it', () => {
  const q = priceQuote([line('off_ws', 'rental', null, 2)], ctx())
  // Oct 1 – Dec 31 is exactly 3 calendar months.
  assert.deepEqual(q.lines[0], {
    offer_id: 'off_ws', solution: 'rental', term_months: null, qty: 2,
    unit_price: 400, line_total: 2400, demand: 'normal', allowed: true, reason: null,
  })
  assert.equal(q.total, 2400)
  assert.equal(q.validForMs, QUOTE_VALID_MS)
})

test('rto: the monthly rate across the term', () => {
  const q = priceQuote([line('off_ws', 'rto', 12)], ctx())
  assert.equal(q.lines[0].unit_price, 400)
  assert.equal(q.lines[0].line_total, 4800)
})

test('package: its line rate overrides the asset, and quantities multiply', () => {
  const q = priceQuote([line('off_pkg', 'rental', null, 1)], ctx())
  assert.equal(q.lines[0].unit_price, 2 * 400 + 150)
  assert.equal(q.lines[0].line_total, 950 * 3)
})

test('the tier price adjustment applies to rental rates', () => {
  const tier = tierFor(mergeCreditTiers({ tiers: { standard: { priceAdjustPct: 10 } } }), 'standard')
  const q = priceQuote([line('off_ws', 'rental')], ctx({ tier }))
  assert.equal(q.lines[0].unit_price, 440)
})

test('flow: unit_price is the month-1 payment per unit, line_total the contract, through the Flow chain', () => {
  const q = priceQuote([line('off_ws', 'flow', 24, 3)], ctx())
  const config = flowConfigFromSettings(applyFlowDefaults({ flowTermMonths: 24, flowMarginPct: null, flowStepPct: null }, FLOW_DEFAULTS_FALLBACK))!
  const priced = priceFlowLines([{ name: 'Workstation', costBasis: 6000, trueCost: 6000, quantity: 3 }], config)
  const client = flowClientQuote({ rates: priced.result.schedule.rows.map((r) => r.rate), discountAmount: 0, taxRate: 0, deliveryCost: 0, returnCost: 0, feasible: true })
  assert.equal(q.lines[0].line_total, client.totals.contract)
  assert.equal(q.lines[0].unit_price, Math.round((client.rows[0].payment / 3) * 100) / 100)
  assert.ok(q.lines[0].unit_price! > 0)
  assert.equal(q.lines[0].allowed, true)
  assert.equal(q.validForMs, FLOW_QUOTE_VALID_MS)
  // The snapshot keeps the basis and knobs so an order can reproduce it...
  assert.equal(q.internal[0].flow!.lines[0].costBasis, 6000)
  assert.equal(q.internal[0].flow!.knobs.flowMarginPct, FLOW_DEFAULTS_FALLBACK.marginPct)
  // ...and the client-facing lines never carry them.
  assertClientSafe({ data: { rate_id: 'r', valid_until: 'x', total: q.total, lines: q.lines } })
})

test('flow: the tier margin overrides the house default and moves the price', () => {
  const tier = tierFor(mergeCreditTiers({ tiers: { standard: { flowMarginPct: 20 } } }), 'standard')
  const base = priceQuote([line('off_ws', 'flow', 24)], ctx())
  const cheaper = priceQuote([line('off_ws', 'flow', 24)], ctx({ tier }))
  assert.ok(cheaper.lines[0].line_total! < base.lines[0].line_total!)
})

test('flow never reads lease funding: no funding module is imported by the pricing path', () => {
  for (const f of ['quote.ts', 'offers.ts']) {
    const src = readFileSync(join(__dirname, f), 'utf8')
    assert.doesNotMatch(src, /load-funding|lease-funding|loadFlowFunding|flowInputsForOrder/, f)
  }
})

test('reasons: offer_not_visible, solution_not_allowed, term_not_allowed, unpriced', () => {
  const q = priceQuote([
    line('off_hidden', 'rental'),
    line('off_missing', 'rental'),
    line('off_rent', 'flow', 24),
    line('off_ws', 'flow', 60),
    line('off_pkg', 'flow', 36),
    line('off_norate', 'rental'),
    line('off_norate', 'flow', 24),
  ], ctx())
  assert.deepEqual(q.lines.map((l) => l.reason), [
    'offer_not_visible', 'offer_not_visible', 'solution_not_allowed', 'term_not_allowed', 'term_not_allowed', 'unpriced', 'unpriced',
  ])
  for (const l of q.lines) {
    assert.equal(l.allowed, false)
    assert.equal(l.unit_price, null)
  }
  assert.equal(q.total, 0)
})

test('reason: verification_required — Flow needs agreement_and_coi, but the price still shows', () => {
  const q = priceQuote([line('off_ws', 'flow', 24), line('off_ws', 'rental')], ctx({ verificationLevel: 'none' }))
  assert.equal(q.lines[0].reason, 'verification_required')
  assert.equal(q.lines[0].allowed, false)
  assert.ok(q.lines[0].unit_price! > 0)
  assert.equal(q.lines[1].allowed, true)
})

test('reason: insufficient_capacity, and demand from the capacity signal', () => {
  const q = priceQuote([line('off_ws', 'rental', null, 5)], ctx({ capacity: () => ({ available: 4, demand: 'high' }) }))
  assert.equal(q.lines[0].reason, 'insufficient_capacity')
  assert.equal(q.lines[0].demand, 'high')
})

test('reason: credit_limit over the tier maximum refuses every otherwise-allowed line', () => {
  const tier = tierFor(mergeCreditTiers({ tiers: { standard: { maxOrderTotal: 3000 } } }), 'standard')
  const q = priceQuote([line('off_ws', 'rental', null, 2), line('off_ws', 'rental')], ctx({ tier }))
  assert.deepEqual(q.lines.map((l) => l.reason), ['credit_limit', 'credit_limit'])
  assert.equal(q.allowedTotal, 0)
  assert.equal(q.total, 3600)
})

test('offer ranges are bands, never the exact monthly price, and client-safe', () => {
  const ranges = offerRanges(ws, { tier: STANDARD_TIER, flowDefaults: FLOW_DEFAULTS_FALLBACK, today: new Date('2026-10-01T00:00:00Z') })
  const rental = ranges.find((r) => r.solution === 'rental')!
  assert.deepEqual({ low: rental.low, high: rental.high }, { low: 350, high: 450 })
  const flow = ranges.find((r) => r.solution === 'flow')!
  assert.deepEqual(flow.term_months, [12, 24, 36, 48])
  const exact = priceQuote([12, 24, 36, 48].map((t) => line('off_ws', 'flow', t)), ctx()).lines.map((l) => l.unit_price)
  for (const p of exact) {
    assert.notEqual(flow.low, p)
    assert.notEqual(flow.high, p)
    assert.ok(flow.low < p! && flow.high > p!)
  }
  assertClientSafe(ranges)
})

test('parseQuoteRequest refuses hostile input', () => {
  const ok = { account_id: 'acct_1', window: { start: '2026-10-01', end: '2026-12-31' }, lines: [{ offer_id: 'off_ws', qty: 1, solution: 'rental' }] }
  assert.equal(parseQuoteRequest(ok).ok, true)
  const bad: unknown[] = [
    null, [], 'x',
    { ...ok, account_id: 5 },
    { ...ok, account_id: 'a b' },
    { ...ok, window: { start: 'yesterday' } },
    { ...ok, window: { start: '2026-10-01', end: '2026-09-01' } },
    { ...ok, window: { start: '2026-02-31x' } },
    { ...ok, lines: [] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 0, solution: 'rental' }] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 1000, solution: 'rental' }] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 1.5, solution: 'rental' }] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 1, solution: 'sale' }] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 1, solution: 'flow', term_months: 60 }] },
    { ...ok, lines: [{ offer_id: 'off_ws', qty: 1, solution: 'flow', term_months: '24' }] },
    { ...ok, lines: [{ offer_id: { $ne: 1 }, qty: 1, solution: 'rental' }] },
    { ...ok, window: { start: '2026-10-01' }, lines: [{ offer_id: 'off_ws', qty: 1, solution: 'rental' }] },
    { ...ok, lines: Array.from({ length: 51 }, () => ({ offer_id: 'off_ws', qty: 1, solution: 'rental' })) },
  ]
  for (const b of bad) assert.equal(parseQuoteRequest(b).ok, false, JSON.stringify(b)?.slice(0, 120))
  const flow = parseQuoteRequest({ account_id: 'acct_1', window: { start: '2026-10-01' }, lines: [{ offer_id: 'o', qty: 2, solution: 'flow', term_months: 48 }] })
  assert.ok(flow.ok && flow.value.lines[0].term === 48 && flow.value.window.end === null)
})
