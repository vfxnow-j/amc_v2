import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depreciationMonthsElapsed, calculateDepreciatedValue, unitCost } from './depreciation'

const d = (s: string) => new Date(s + 'T00:00:00Z')

test('received month counts in full; current month books at month-end', () => {
  assert.equal(depreciationMonthsElapsed(d('2026-08-15'), d('2026-09-17')), 1)
  assert.equal(depreciationMonthsElapsed(d('2026-09-17'), d('2026-09-17')), 0)
  assert.equal(depreciationMonthsElapsed(d('2026-08-31'), d('2026-09-01')), 1)
  assert.equal(depreciationMonthsElapsed(d('2025-12-01'), d('2026-01-31')), 1)
  assert.equal(depreciationMonthsElapsed(d('2026-10-01'), d('2026-09-17')), 0) // future start
})

test('straight line uses calendar months', () => {
  // $6,774 over 60 months, 1 month elapsed → 6774 - 112.90
  const v = calculateDepreciatedValue(6774, d('2026-08-19'), 'STRAIGHT_LINE', 60, 0, d('2026-08-20'), d('2026-09-17'))
  assert.equal(Math.round(v * 100) / 100, 6661.1)
})

test('fully depreciated after life', () => {
  assert.equal(calculateDepreciatedValue(6000, d('2020-01-01'), 'STRAIGHT_LINE', 60, 0, null, d('2026-09-17')), 0)
})

test('received date wins over purchase date', () => {
  // purchased Feb, received Mar → as of Apr 17 only 1 month
  const v = calculateDepreciatedValue(6000, d('2026-02-19'), 'STRAIGHT_LINE', 60, 0, d('2026-03-13'), d('2026-04-17'))
  assert.equal(v, 5900)
})

test('unitCost adds signed adjustment and tolerates nulls/strings', () => {
  assert.equal(unitCost(6999, -225), 6774)
  assert.equal(unitCost('1504.00', '167.35'), 1671.35)
  assert.equal(unitCost(null, -225), 0) // no price → no cost, adjustment alone is meaningless
  assert.equal(unitCost(3000, null), 3000)
})
