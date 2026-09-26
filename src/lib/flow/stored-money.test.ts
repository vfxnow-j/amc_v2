import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addTermMonths, flowCreateLineCost, flowSnapshotLineCost, flowStoredMoney } from './stored-money'
import { priceFlowLines } from '@/lib/pricing/flow-lines'
import { FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'
import { calendarDay } from '@/lib/billing/calendar'

const day = (y: number, m: number, d: number) => calendarDay(y, m - 1, d)

test('addTermMonths stays a stored day and clamps to the month end', () => {
  assert.equal(addTermMonths(day(2026, 9, 26), 24).toISOString(), '2028-09-26T12:00:00.000Z')
  assert.equal(addTermMonths(day(2026, 1, 31), 1).toISOString(), '2026-02-28T12:00:00.000Z')
  assert.equal(addTermMonths(day(2027, 11, 30), 3).toISOString(), '2028-02-29T12:00:00.000Z')
  // A legacy Pacific-midnight start is read as its intended day first.
  assert.equal(addTermMonths(new Date('2026-03-01T08:00:00.000Z'), 12).toISOString(), '2027-03-01T12:00:00.000Z')
})

test('a created line: true cost is the landed basis, the basis is floored at it', () => {
  assert.deepEqual(flowCreateLineCost(null, 1000), { trueCost: 1000, costBasis: 1000 })
  assert.deepEqual(flowCreateLineCost(800, 1000), { trueCost: 1000, costBasis: 1000 })
  assert.deepEqual(flowCreateLineCost(1200, 1000), { trueCost: 1000, costBasis: 1200 })
  assert.deepEqual(flowCreateLineCost(-5, 1000), { trueCost: 1000, costBasis: 1000 })
})

test('snapshot: true cost is set once and kept; a missing basis is filled and floored', () => {
  const b = { basis: 1000, incomplete: false }
  assert.deepEqual(flowSnapshotLineCost({ trueCost: null, costBasis: null }, b, 'X'), { ok: true, cost: { trueCost: 1000, costBasis: 1000 } })
  // An existing true cost is never re-derived, even when the landed basis has moved.
  assert.deepEqual(flowSnapshotLineCost({ trueCost: 900, costBasis: null }, b, 'X'), { ok: true, cost: { trueCost: 900, costBasis: 900 } })
  assert.deepEqual(flowSnapshotLineCost({ trueCost: null, costBasis: 1500 }, b, 'X'), { ok: true, cost: { trueCost: 1000, costBasis: 1500 } })
  assert.deepEqual(flowSnapshotLineCost({ trueCost: null, costBasis: 600 }, b, 'X'), { ok: true, cost: { trueCost: 1000, costBasis: 1000 } })
})

test('snapshot refuses gear whose landed cost is incomplete or zero', () => {
  for (const basis of [undefined, { basis: 0, incomplete: false }, { basis: 1000, incomplete: true }]) {
    const r = flowSnapshotLineCost({ trueCost: null, costBasis: null }, basis, 'Workstation')
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /^Workstation: its units' landed cost is incomplete/)
  }
})

const LINES = [
  { name: 'A', costBasis: 4321.17, trueCost: 4321.17, quantity: 2 },
  { name: 'B', costBasis: 1999.99, trueCost: 1500, quantity: 3 },
  { name: 'C', costBasis: 777.77, trueCost: 777.77, quantity: 1 },
]

test('stored money: line subtotals sum to the contract, payment is the current rate, cost is true cost', () => {
  const config = { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 }
  const priced = priceFlowLines(LINES, config)
  assert.ok(priced.ok)
  const m = flowStoredMoney(LINES, priced, { startDate: day(2026, 9, 26), termMonths: 24 })
  assert.equal(Math.round(m.lines.reduce((s, l) => s + l.subtotal, 0) * 100), Math.round(priced.contractValue * 100))
  assert.equal(m.subtotal, Math.round(priced.contractValue * 100) / 100)
  assert.equal(m.flowContractValue, priced.contractValue)
  assert.equal(m.flowMonthlyPayment, priced.result.rateForMonth(1))
  assert.equal(m.totalCost, 4321.17 * 2 + 1500 * 3 + 777.77)
  assert.equal(m.totalMargin, m.subtotal - m.totalCost)
  assert.equal(m.total, m.subtotal)
  assert.equal(m.endDate.toISOString(), '2028-09-26T12:00:00.000Z')
  assert.deepEqual(m.lines.map((l) => l.rate), priced.rates)
})

test('stored money: discount, tax, shipping and internal costs go through the shared totals rule', () => {
  const config = { ...FLOW_CONFIG_DEFAULTS, termMonths: 36 }
  const priced = priceFlowLines(LINES, config)
  const m = flowStoredMoney(LINES, priced, {
    startDate: day(2026, 1, 15),
    termMonths: 36,
    discountType: 'PERCENTAGE',
    discountValue: '10',
    taxRate: 9.5,
    deliveryCost: 100,
    returnCost: 50,
    shippingMarginType: 'FIXED',
    shippingMargin: 25,
    internalShippingCost: 40,
    hardwareCost: 60,
  })
  const afterDiscount = m.subtotal * 0.9
  assert.equal(m.discountAmount, m.subtotal * 0.1)
  assert.equal(m.taxAmount, afterDiscount * 0.095)
  assert.equal(m.total, afterDiscount + afterDiscount * 0.095 + 125 + 75)
  assert.equal(m.totalCost, 4321.17 * 2 + 1500 * 3 + 777.77 + 40 + 60)
})

test('lease funding and gear age never move the price', () => {
  const plain = priceFlowLines(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  const funded = priceFlowLines(LINES, {
    ...FLOW_CONFIG_DEFAULTS,
    termMonths: 24,
    monthsInService: 30,
    funding: [
      { balance: 6000, aprPct: 7, monthsLeft: 58, label: 'L1' },
      { balance: 2000, aprPct: 5.55, monthsLeft: 30, label: 'L2' },
    ],
  })
  assert.deepEqual(funded.rates, plain.rates)
  assert.deepEqual(funded.subtotals, plain.subtotals)
  assert.equal(funded.contractValue, plain.contractValue)
  assert.equal(funded.monthlyNow, plain.monthlyNow)
})

test('past a step, the stored payment is that period’s rate, not contract ÷ term', () => {
  const priced = priceFlowLines(LINES, { ...FLOW_CONFIG_DEFAULTS, termMonths: 36, currentMonth: 14 })
  const m = flowStoredMoney(LINES, priced, { startDate: day(2026, 1, 1), termMonths: 36 })
  assert.equal(m.flowMonthlyPayment, priced.result.rateForMonth(14))
  assert.notEqual(m.flowMonthlyPayment, priced.result.rateForMonth(1))
})
