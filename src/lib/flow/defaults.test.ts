import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFlowDefaults, applyFlowDefaults, FLOW_DEFAULTS_FALLBACK } from './defaults'
import { FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'

test('no settings row: the engine defaults, plus the 8% assumed rate', () => {
  assert.deepEqual(mergeFlowDefaults(null), FLOW_DEFAULTS_FALLBACK)
  assert.equal(FLOW_DEFAULTS_FALLBACK.marginPct, FLOW_CONFIG_DEFAULTS.marginPct)
  assert.equal(FLOW_DEFAULTS_FALLBACK.assumedAprPct, 8)
})

test('a stored row merges over the fallback, so a key added later still has a value', () => {
  const d = mergeFlowDefaults({ marginPct: 35, deprPct: 25 })
  assert.equal(d.marginPct, 35)
  assert.equal(d.deprPct, 25)
  assert.equal(d.financePct, FLOW_CONFIG_DEFAULTS.financePct)
})

test('a non-object value is ignored, as v1 does', () => {
  assert.deepEqual(mergeFlowDefaults('oops'), FLOW_DEFAULTS_FALLBACK)
  assert.deepEqual(mergeFlowDefaults(42), FLOW_DEFAULTS_FALLBACK)
})

test('applyFlowDefaults fills only the knobs the order left blank', () => {
  const d = mergeFlowDefaults({ marginPct: 35, lifeMonths: 48 })
  const o = applyFlowDefaults({ flowTermMonths: 24, flowMarginPct: 50, flowLifeMonths: null, flowFinancePct: null }, d)
  assert.equal(o.flowTermMonths, 24)
  assert.equal(o.flowMarginPct, 50)
  assert.equal(o.flowLifeMonths, 48)
  assert.equal(o.flowFinancePct, d.financePct)
})
