import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offerDto, parseOfferFilters, specsDto } from './offers'
import { assertClientSafe } from './dto'
import { STANDARD_TIER } from './tiers'
import { FLOW_DEFAULTS_FALLBACK } from '@/lib/flow/defaults'
import type { OfferPricing } from './quote'

// A row as the loader's select hands it over — rates on the asset included.
const row = {
  id: 'off_1', slug: 'ws-5090', kind: 'ASSET', title: 'RTX 5090 workstation', blurb: 'Fast.',
  solutions: ['rental', 'flow'], termsBySolution: { flow: [24, 36] }, software: ['Houdini', 'Nuke'],
  specs: [{ key: 'GPU', value: 'RTX 5090 32GB' }, { key: 'RAM', value: '256GB' }],
  isPublic: true, isVisible: true, sortOrder: 0, assetId: 'a1',
  asset: { id: 'a1', name: 'WS 5090', manufacturer: 'VFXnow', model: 'W1', retiredAt: null, category: { id: 'c1', name: 'Workstations' }, dailyRate: null, weeklyRate: null, monthlyRate: 1200 },
  packageTemplate: null, pool: null,
}
const pricing: OfferPricing = {
  id: 'off_1', visible: true, solutions: row.solutions, termsBySolution: row.termsBySolution,
  components: [{ assetId: 'a1', name: 'WS 5090', quantity: 1, assetRates: { monthlyRate: 1200 }, overrideRate: null, overridePricingType: null, isOneTime: false, flowBasis: { basis: 9000, incomplete: false } }],
}

test('the offer DTO is client-safe and carries no exact price', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dto = offerDto(row as any, pricing, { tier: STANDARD_TIER, flowDefaults: FLOW_DEFAULTS_FALLBACK, today: new Date('2026-10-01') })
  assertClientSafe({ data: [dto] })
  assert.deepEqual(dto.solutions, [{ solution: 'rental', term_months: null }, { solution: 'flow', term_months: [24, 36] }])
  assert.deepEqual(dto.category, { id: 'c1', name: 'Workstations' })
  const json = JSON.stringify(dto)
  assert.doesNotMatch(json, /1200|9000|monthlyRate|Rate"/)
  assert.equal(dto.price_ranges.length, 2)
})

test('filters: an unknown solution is refused; others pass through trimmed', () => {
  assert.equal(parseOfferFilters(new URLSearchParams('solution=lease')).ok, false)
  const f = parseOfferFilters(new URLSearchParams('solution=flow&software=%20Nuke%20'))
  assert.ok(f.ok && f.value.solution === 'flow' && f.value.software === 'Nuke' && f.value.category === null)
})

test('specs come out as key/value strings', () => {
  assert.deepEqual(specsDto({ GPU: 'A6000', RAM: 128 }), [{ key: 'GPU', value: 'A6000' }, { key: 'RAM', value: '128' }])
  assert.deepEqual(specsDto([{ key: ' ', value: 'x' }, 'junk']), [])
  assert.deepEqual(specsDto(null), [])
})
