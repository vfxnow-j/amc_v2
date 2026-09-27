import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publicRange, RANGE_STEP } from './price-ranges'

test('min = max is widened by at least 10% each way, then rounded out to $25', () => {
  assert.deepEqual(publicRange([400]), { low: 350, high: 450 })
  assert.deepEqual(publicRange([1000, 1000]), { low: 900, high: 1100 })
})

test('an exact price never appears as either end, even on a $25 step', () => {
  // 900 × 0.9 = 810 → 800; 900 × 1.1 = 990 → 1000. Neither is 900.
  assert.deepEqual(publicRange([900]), { low: 800, high: 1000 })
  // A wide band whose ends are $25 multiples still steps outward.
  assert.deepEqual(publicRange([100, 500]), { low: 75, high: 525 })
})

test('no end is ever an exact price, over many price sets', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rand() * 5)
    const prices = Array.from({ length: n }, () =>
      rand() < 0.3 ? Math.ceil(rand() * 200) * 25 : Math.round(rand() * 500000) / 100 + 0.01,
    )
    const r = publicRange(prices)!
    for (const p of prices) {
      assert.notEqual(r.low, p)
      assert.notEqual(r.high, p)
    }
    assert.ok(r.low < Math.min(...prices))
    assert.ok(r.high > Math.max(...prices))
    assert.equal(r.low % RANGE_STEP, 0)
    assert.equal(r.high % RANGE_STEP, 0)
    assert.ok(r.low >= 0)
    const mid = (Math.min(...prices) + Math.max(...prices)) / 2
    assert.ok(r.high - r.low >= mid * 0.2 - 1e-9, 'band floor is ±10%')
  }
})

test('nothing to describe gives null', () => {
  assert.equal(publicRange([]), null)
  assert.equal(publicRange([0, NaN, -5]), null)
})

test('a small price never goes below zero', () => {
  assert.deepEqual(publicRange([12]), { low: 0, high: 25 })
})
