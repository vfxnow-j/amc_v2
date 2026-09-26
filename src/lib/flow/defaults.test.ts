import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFlowDefaults, applyFlowDefaults, storedFlowConfig, FLOW_DEFAULTS_FALLBACK } from './defaults'
import { priceFlowLines } from '@/lib/pricing/flow-lines'
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

test('knobs are fixed at birth: a Settings change never moves an existing order', () => {
  // Born under one settings row: the blank knobs resolved once and stored.
  const before = mergeFlowDefaults({ marginPct: 35, financePct: 12, deprPct: 25, taxExempt: false })
  const stored = {
    flowTermMonths: 24,
    flowPeriodsBilled: 0,
    flowStepPct: null,
    ...applyFlowDefaults({
      flowMarginPct: null, flowFinancePct: null, flowPurchaseTaxPct: null, flowTaxExempt: null,
      flowRecoverByMonth: null, flowDeprPct: 28, flowLifeMonths: null,
    }, before),
  }
  assert.equal(stored.flowMarginPct, 35)
  assert.equal(stored.flowTaxExempt, false)
  assert.equal(stored.flowDeprPct, 28)
  const lines = [
    { name: 'A', costBasis: 5000, trueCost: 5000, quantity: 1 },
    { name: 'B', costBasis: 2400, trueCost: 2000, quantity: 2 },
  ]
  const config = storedFlowConfig(stored)!
  const priced = priceFlowLines(lines, config)
  assert.ok(priced.ok)

  // Settings change. A NEW order would take it...
  const after = mergeFlowDefaults({ marginPct: 60, financePct: 20, purchaseTaxPct: 5, lifeMonths: 36, taxExempt: true })
  assert.notDeepEqual(applyFlowDefaults({ flowMarginPct: null }, after).flowMarginPct, stored.flowMarginPct)
  // ...but the existing order's reprice inputs and money do not move: the stored
  // config takes no settings argument at all.
  assert.deepEqual(storedFlowConfig(stored), config)
  const repriced = priceFlowLines(lines, storedFlowConfig(stored)!)
  assert.equal(repriced.contractValue, priced.contractValue)
  assert.deepEqual(repriced.rates, priced.rates)
  assert.deepEqual(repriced.subtotals, priced.subtotals)
  assert.equal(repriced.monthlyNow, priced.monthlyNow)
})

test('a legacy null knob prices at the engine default, never the settings row (as v1)', () => {
  const legacy = { flowTermMonths: 24, flowMarginPct: null, flowFinancePct: null, flowLifeMonths: null, flowStepPct: null }
  const c = storedFlowConfig(legacy)!
  assert.equal(c.marginPct, FLOW_CONFIG_DEFAULTS.marginPct)
  assert.equal(c.financePct, FLOW_CONFIG_DEFAULTS.financePct)
  assert.equal(c.lifeMonths, FLOW_CONFIG_DEFAULTS.lifeMonths)
  assert.equal(c.taxExempt, FLOW_CONFIG_DEFAULTS.taxExempt)
  // A null step stays null: the recoverByMonth-shaped schedule, not a missing value.
  assert.equal(c.stepPct, null)
  assert.equal(storedFlowConfig({ flowTermMonths: null }), null)
})

test('applyFlowDefaults never defaults the step', () => {
  const o = applyFlowDefaults({ flowTermMonths: 24, flowStepPct: null }, mergeFlowDefaults({ marginPct: 50 }))
  assert.equal(o.flowStepPct, null)
})
