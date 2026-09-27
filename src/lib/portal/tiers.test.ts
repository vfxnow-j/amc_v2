import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCreditTiers, tierFor, verificationMeets, CREDIT_TIERS_DEFAULT, PORTAL_FLOW_TERMS } from './tiers'

test('the coded default is one tier: every solution, Flow 12–48, list price, no limit', () => {
  const tiers = mergeCreditTiers(null)
  assert.deepEqual(Object.keys(tiers.tiers), ['standard'])
  const t = tierFor(tiers, 'standard')
  assert.deepEqual(t.solutions, ['rental', 'rto', 'flow'])
  assert.deepEqual(t.terms.flow, [12, 24, 36, 48])
  assert.deepEqual([...PORTAL_FLOW_TERMS], [12, 24, 36, 48])
  assert.equal(t.priceAdjustPct, 0)
  assert.equal(t.maxOrderTotal, null)
  assert.equal(t.flowMarginPct, null)
  assert.deepEqual(t.requiresVerification, { rental: 'none', rto: 'none', flow: 'agreement_and_coi' })
  assert.deepEqual(tiers, mergeCreditTiers(CREDIT_TIERS_DEFAULT))
})

test('a stored row merges over the default and cannot remove it', () => {
  const tiers = mergeCreditTiers({
    defaultTier: 'c',
    tiers: {
      standard: { priceAdjustPct: 5 },
      c: { label: 'C', solutions: ['rental', 'bogus'], maxOrderTotal: 10000, terms: { flow: [12, 60, 99] } },
    },
  })
  assert.equal(tiers.tiers.standard.priceAdjustPct, 5)
  assert.deepEqual(tiers.tiers.standard.solutions, ['rental', 'rto', 'flow'])
  assert.deepEqual(tiers.tiers.c.solutions, ['rental'])
  assert.equal(tiers.tiers.c.maxOrderTotal, 10000)
  assert.deepEqual(tiers.tiers.c.terms.flow, [12], '60 and 99 are outside the portal set')
  assert.equal(tiers.defaultTier, 'c')
})

test('hostile values are ignored', () => {
  const tiers = mergeCreditTiers({
    defaultTier: 'missing',
    tiers: { standard: { priceAdjustPct: -99, flowMarginPct: 'x', requiresVerification: { flow: 'root' } }, 'bad id!': {} },
  })
  assert.equal(tiers.defaultTier, 'standard')
  assert.equal(tiers.tiers.standard.priceAdjustPct, 0)
  assert.equal(tiers.tiers.standard.flowMarginPct, null)
  assert.equal(tiers.tiers.standard.requiresVerification.flow, 'agreement_and_coi')
  assert.equal(tiers.tiers['bad id!'], undefined)
})

test('an unknown tier name falls back to the default tier', () => {
  assert.equal(tierFor(mergeCreditTiers(null), 'platinum').id, 'standard')
})

test('verification levels rank none < id_verified < agreement_and_coi', () => {
  assert.equal(verificationMeets('none', 'none'), true)
  assert.equal(verificationMeets('id_verified', 'agreement_and_coi'), false)
  assert.equal(verificationMeets('agreement_and_coi', 'id_verified'), true)
  assert.equal(verificationMeets('garbage', 'id_verified'), false)
})
