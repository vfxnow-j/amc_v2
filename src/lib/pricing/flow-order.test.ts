import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowOrder, FLOW_CONFIG_DEFAULTS, type FlowOrderLine } from './flow-order'

const LINES: FlowOrderLine[] = [
  { name: 'Threadripper', costBasis: 5500, quantity: 2 },
]

test('quote and schedule are built from the same items — they cannot disagree', () => {
  for (const termMonths of [24, 36]) {
    const r = flowOrder(
      [...LINES, { name: 'Mixed', costBasis: 9000, trueCost: 7000, quantity: 1 }],
      { ...FLOW_CONFIG_DEFAULTS, termMonths },
    )
    assert.equal(r.schedule.contract, r.quote.client.totalPayable, `term ${termMonths}`)
    assert.equal(r.schedule.termMonths, r.quote.inputs.termMonths, `term ${termMonths}`)
    for (let m = 1; m <= termMonths; m++) {
      assert.ok(Math.abs(r.rateForMonth(m) - r.quote.schedule.rates[m - 1]) <= 0.015,
        `term ${termMonths} month ${m}`)
    }
  }
})

test('a Flow term bills 1.5x cost — cost, +10% financing, +40% margin', () => {
  const r = flowOrder(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(r.contractValue, 16500)          // 11000 x 1.5
  assert.equal(r.quote.economics.hardware, 11000)
})

test('the basis is floored at true cost — a line can never quote below what it cost', () => {
  const r = flowOrder([{ name: 'RTX 3060 Ti', costBasis: 300, trueCost: 600, quantity: 1 }],
    { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(r.quote.chain.cost, 600)         // floored up from 300
  assert.equal(r.flooredLines, 1)
})

test('an edited basis above cost is honoured, and profit still reads true cost', () => {
  const r = flowOrder([{ name: 'Premium', costBasis: 8000, trueCost: 5500, quantity: 1 }],
    { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(r.quote.chain.cost, 8000)        // priced off the edited basis
  assert.equal(r.quote.economics.hardware, 5500) // profit still reads what we paid
  assert.equal(r.flooredLines, 0)
})

test('an absent trueCost means the basis, untaxed — it is money already spent', () => {
  // landedCostAdjustment already contains tax actually paid, so purchase tax must
  // not be applied to it a second time.
  const exempt = flowOrder(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(exempt.quote.economics.hardware, exempt.quote.chain.landed)

  const taxed = flowOrder(LINES, {
    ...FLOW_CONFIG_DEFAULTS, termMonths: 24, taxExempt: false, purchaseTaxPct: 9.75,
  })
  assert.equal(taxed.quote.economics.hardware, 11000)          // what we actually spent
  assert.ok(taxed.quote.chain.landed > taxed.quote.economics.hardware)  // the chain is taxed, the cost is not
})

test('monthlyNow is the rate for the month the order is in', () => {
  const r = flowOrder(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24, currentMonth: 13 })
  assert.equal(r.monthlyNow, r.rateForMonth(13))
  assert.notEqual(r.rateForMonth(13), r.rateForMonth(1))   // it stepped at the anniversary
})

test('a co-termed line enters at its month', () => {
  const r = flowOrder([
    ...LINES,
    { name: 'Added', costBasis: 12000, quantity: 1, addedAtMonth: 6 },
  ], { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.ok(r.rateForMonth(6) > r.rateForMonth(5))
})

test('financed gear feeds the cash picture, cash-owned gear does not', () => {
  const owned = flowOrder(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(owned.quote.cash.outAtSigning, 0)      // never `new` procurement
  assert.equal(owned.quote.economics.financeActual, 0)

  const financed = flowOrder(LINES, {
    ...FLOW_CONFIG_DEFAULTS, termMonths: 24,
    funding: { aprPct: 8, balance: 11000, monthsLeft: 24 },
  })
  assert.ok(financed.quote.economics.financeActual > 0)
  assert.ok(financed.quote.cash.notePayment > 0)
})

test('an empty order prices at zero without throwing', () => {
  const r = flowOrder([], { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(r.contractValue, 0)
  assert.equal(r.monthlyNow, 0)
})
