import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowOrder, FLOW_CONFIG_DEFAULTS } from './flow-order'
import { flowConfigFromSettings, priceFlowLines } from './flow-lines'

const CONFIG = { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 }

test('stored rate is the per-unit contract value, so rate x qty sums to the contract', () => {
  const p = priceFlowLines([
    { name: 'Threadripper', costBasis: 5500, trueCost: 5500, quantity: 2 },
    { name: 'Monitor', costBasis: 400, trueCost: 400, quantity: 1 },
  ], CONFIG)
  assert.equal(p.ok, true)
  assert.deepEqual(p.rates, [8250, 600])            // 1.5x cost, per unit
  assert.deepEqual(p.subtotals, [16500, 600])
  assert.equal(p.contractValue, 17100)
  assert.equal(p.subtotals.reduce((s, x) => s + x, 0), p.contractValue)
})

test('matches flowOrder() exactly — the one-call rule', () => {
  const lines = [
    { name: 'A', costBasis: 9000, trueCost: 7000, quantity: 1 },
    { name: 'B', costBasis: 1234.56, trueCost: 1234.56, quantity: 3 },
  ]
  const p = priceFlowLines(lines, CONFIG)
  const r = flowOrder(lines, CONFIG)
  assert.equal(p.contractValue, r.contractValue)
  assert.equal(p.monthlyNow, r.monthlyNow)
  assert.equal(p.result?.contractValue, r.contractValue)
})

test('monthly payment is the CURRENT period rate, not contract / term', () => {
  const lines = [{ name: 'A', costBasis: 10000, trueCost: 10000, quantity: 1 }]
  const m1 = priceFlowLines(lines, { ...CONFIG, currentMonth: 1 })
  const m13 = priceFlowLines(lines, { ...CONFIG, currentMonth: 13 })
  const r = flowOrder(lines, CONFIG)
  assert.equal(m1.monthlyNow, r.rateForMonth(1))
  assert.equal(m13.monthlyNow, r.rateForMonth(13))
  // The schedule is front-loaded, so month 1 is not the level average.
  assert.notEqual(m1.monthlyNow, Math.round((m1.contractValue / 24) * 100) / 100)
  assert.ok(m1.monthlyNow > m13.monthlyNow)
})

test('a basis below true cost is floored in the stored rate too', () => {
  const p = priceFlowLines([{ name: 'GPU', costBasis: 300, trueCost: 600, quantity: 1 }], CONFIG)
  assert.equal(p.rates[0], 900)                     // 600 x 1.5, not 300 x 1.5
  assert.equal(p.flooredLines, 1)
})

test('a line with no basis, or a zero basis, is unpriced and blocks the order', () => {
  const p = priceFlowLines([
    { name: 'Costed', costBasis: 1000, trueCost: 1000, quantity: 1 },
    { name: 'Missing', costBasis: null, trueCost: null, quantity: 1 },
    { name: 'Zero', costBasis: 0, trueCost: null, quantity: 2 },
  ], CONFIG)
  assert.equal(p.ok, false)
  assert.deepEqual(p.unpriced, [1, 2])
  assert.deepEqual(p.rates, [1500, 0, 0])
  assert.match(p.problem || '', /cost basis/i)
})

test('an empty order is infeasible and blocked', () => {
  const p = priceFlowLines([], CONFIG)
  assert.equal(p.ok, false)
  assert.equal(p.feasible, false)
  assert.ok(p.problem)
})

test('a co-term month outside the term is infeasible and blocked', () => {
  const p = priceFlowLines([{ name: 'A', costBasis: 1000, trueCost: 1000, quantity: 1, addedAtMonth: 40 }], CONFIG)
  assert.equal(p.feasible, false)
  assert.equal(p.ok, false)
  assert.match(p.problem || '', /feasible/i)
})

test('per-unit rates round half-up to cents, despite float error', () => {
  // 99.99 x 1.5 = 149.985, which floats as 149.98499999...; it must still round up.
  const p = priceFlowLines([{ name: 'Cam', costBasis: 99.99, trueCost: 99.99, quantity: 1 }], CONFIG)
  assert.equal(p.rates[0], 149.99)
  const q = priceFlowLines([{ name: 'Odd', costBasis: 100.01, trueCost: 100.01, quantity: 3 }], CONFIG)
  assert.equal(q.rates[0], 150.02)                  // 150.015 -> 150.02
})

test('stored subtotals always sum to the contract value, to the cent', () => {
  // Per-unit rounding would drift: 3 x 149.99 = 449.97, but 3 x 149.985 = 449.955 -> 449.96.
  const lines = [
    { name: 'DeckLink', costBasis: 749, trueCost: 749, quantity: 1 },
    { name: 'Workstation', costBasis: 2189.4, trueCost: 2189.4, quantity: 2 },
    { name: 'Cam', costBasis: 99.99, trueCost: 99.99, quantity: 3 },
    { name: 'Odd', costBasis: 100.01, trueCost: 100.01, quantity: 7 },
  ]
  const p = priceFlowLines(lines, CONFIG)
  const sum = Math.round(p.subtotals.reduce((s, x) => s + x, 0) * 100) / 100
  assert.equal(sum, p.contractValue)
  // and each subtotal stays within rounding of rate x qty
  p.subtotals.forEach((sub, i) => {
    assert.ok(Math.abs(sub - p.rates[i] * lines[i].quantity) <= 0.005 * lines[i].quantity + 0.011, `line ${i}`)
  })
})

test('config comes from the stored order settings, falling back to the defaults', () => {
  assert.equal(flowConfigFromSettings({ flowTermMonths: null }), null)
  const c = flowConfigFromSettings({
    flowTermMonths: 36,
    flowMarginPct: '35.5',                          // Prisma Decimals arrive as objects/strings
    flowFinancePct: null,
    flowTaxExempt: null,
    flowPeriodsBilled: 12,
  })!
  assert.equal(c.termMonths, 36)
  assert.equal(c.marginPct, 35.5)
  assert.equal(c.financePct, FLOW_CONFIG_DEFAULTS.financePct)
  assert.equal(c.taxExempt, true)
  assert.equal(c.recoverByMonth, FLOW_CONFIG_DEFAULTS.recoverByMonth)
  assert.equal(c.currentMonth, 13)
})

test('a false tax-exempt flag is honoured', () => {
  const c = flowConfigFromSettings({ flowTermMonths: 24, flowTaxExempt: false })!
  assert.equal(c.taxExempt, false)
})
