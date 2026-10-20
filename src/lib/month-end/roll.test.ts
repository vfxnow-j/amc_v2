import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollMonth, heldAt, monthBounds, deprInfo, type MEUnit } from './roll'

const unit = (over: Partial<MEUnit>): MEUnit => ({
  id: over.barcode ?? 'u', barcode: 'u', cost: 6000,
  purchaseDate: new Date('2025-01-10T00:00:00Z'), receivedDate: new Date('2025-01-15T00:00:00Z'),
  method: 'STRAIGHT_LINE', lifeMonths: 60, salvage: 0,
  disposed: false, disposedAt: null, reacquiredAt: null, salePrice: null, saleFees: null,
  ...over,
})

test('held unit depreciates one month per month and balances', () => {
  const r = rollMonth([unit({})], '2026-09')
  // Jan 2025 → Aug 2026 = 20 months opening; 21 at close; 100/month
  assert.equal(r.opening.accum, 2000)
  assert.equal(r.closing.accum, 2100)
  assert.equal(r.depreciation, 100)
  assert.equal(r.check, 0)
})

test('addition in month counts in full that month (full-month convention)', () => {
  const r = rollMonth([unit({ purchaseDate: new Date('2026-09-20T00:00:00Z'), receivedDate: new Date('2026-09-22T00:00:00Z') })], '2026-09')
  assert.equal(r.opening.count, 0)
  assert.equal(r.additions.cost, 6000)
  assert.equal(r.depreciation, 100)
  assert.equal(r.closing.nbv, 5900)
  assert.equal(r.check, 0)
})

test('sale in month leaves at opening book value, gain = net − book', () => {
  const r = rollMonth([unit({ disposed: true, disposedAt: new Date('2026-09-12T12:00:00Z'), salePrice: 3000, saleFees: 400 })], '2026-09')
  assert.equal(r.disposals.count, 1)
  assert.equal(r.disposals.nbv, 4000) // 6000 − 20 × 100
  assert.equal(r.disposals.net, 2600)
  assert.equal(r.disposals.gainLoss, -1400)
  assert.equal(r.depreciation, 0)
  assert.equal(r.closing.count, 0)
  assert.equal(r.check, 0)
})

test('import-stamp units sit in their own bucket and never depreciate', () => {
  const u = unit({ receivedDate: null, purchaseDate: new Date('2026-02-07T00:00:00Z') })
  const r = rollMonth([u], '2026-09')
  assert.equal(r.unknownDate.openCount, 1)
  assert.equal(r.unknownDate.closeCost, 6000)
  assert.equal(r.opening.count, 0)
  assert.equal(r.additions.count, 0)
  assert.equal(r.depreciation, 0)
})

test('undated disposal is excluded everywhere; bought-back unit stays held', () => {
  const { start } = monthBounds('2026-09')
  assert.equal(heldAt(unit({ disposed: true, disposedAt: null }), start), false)
  assert.equal(heldAt(unit({ disposed: true, disposedAt: new Date('2026-03-01T12:00:00Z'), reacquiredAt: new Date('2026-04-01T12:00:00Z') }), start), true)
})

test('consecutive months chain: closing(Aug) = opening(Sep)', () => {
  const us = [unit({}), unit({ barcode: 'b', cost: 1200, disposed: true, disposedAt: new Date('2026-09-03T12:00:00Z'), salePrice: 500, saleFees: 50 })]
  assert.deepEqual(rollMonth(us, '2026-08').closing, rollMonth(us, '2026-09').opening)
})

test('depreciation term: end month, age past life, remaining, final book', async () => {
  const { deprInfo, monthBounds: mb } = await import('./roll')
  const old = unit({ receivedDate: new Date('2019-09-12T00:00:00Z'), purchaseDate: new Date('2019-09-01T00:00:00Z') })
  const d = deprInfo(old, mb('2026-09').end)
  assert.equal(d.endMonth, '2024-08')
  assert.equal(d.ageMonths, 85)
  assert.equal(d.monthsDepreciated, 60)
  assert.equal(d.monthsRemaining, 0)
  assert.equal(d.fullyDepreciated, true)
  assert.equal(d.bookValue, 0)
  const mid = deprInfo(unit({}), mb('2026-09').end)
  assert.equal(mid.endMonth, '2029-12')
  assert.equal(mid.monthsDepreciated, 21)
  assert.equal(mid.monthsRemaining, 39)
  assert.equal(mid.bookValue, 3900)
})

test('deprInfo: term, end month and position as of a date', () => {
  // Received 2025-01-15, 60 months: depreciates Jan 2025 through Dec 2029.
  const di = deprInfo(unit({}), new Date('2026-10-01T00:00:00Z'))
  assert.equal(di.endMonth, '2029-12')
  assert.equal(di.ageMonths, 21)
  assert.equal(di.monthsDepreciated, 21)
  assert.equal(di.monthsRemaining, 39)
  assert.equal(di.fullyDepreciated, false)
  assert.equal(di.monthly, 100)
  assert.equal(di.bookValue, 3900)
})

test('deprInfo: past useful life caps months depreciated; unknown date has no schedule', () => {
  const old = deprInfo(unit({ receivedDate: new Date('2019-01-10T00:00:00Z'), purchaseDate: new Date('2019-01-05T00:00:00Z') }), new Date('2026-10-01T00:00:00Z'))
  assert.equal(old.monthsDepreciated, 60)
  assert.equal(old.monthsRemaining, 0)
  assert.equal(old.fullyDepreciated, true)
  assert.equal(old.bookValue, 0)
  assert.ok(old.ageMonths! > 60)
  const stamp = deprInfo(unit({ receivedDate: null, purchaseDate: new Date('2026-02-07T00:00:00Z') }), new Date('2026-10-01T00:00:00Z'))
  assert.equal(stamp.start, null)
  assert.equal(stamp.bookValue, null)
})

test('a unit disposed before the month never shows in it; one sold the day it arrives is an addition and a disposal', () => {
  const gone = unit({ disposed: true, disposedAt: new Date('2026-03-01T12:00:00Z'), salePrice: 1000, saleFees: 0 })
  const r = rollMonth([gone], '2026-09')
  assert.equal(r.opening.count + r.closing.count + r.disposals.count + r.additions.count, 0)
  const flip = unit({ purchaseDate: new Date('2026-09-02T00:00:00Z'), receivedDate: new Date('2026-09-03T00:00:00Z'), disposed: true, disposedAt: new Date('2026-09-20T12:00:00Z'), salePrice: 7000, saleFees: 500 })
  const f = rollMonth([flip], '2026-09')
  assert.equal(f.additions.count, 1)
  assert.equal(f.disposals.count, 1)
  assert.equal(f.disposals.nbv, 6000) // September books at month-end, so a Sep 20 disposal is still at cost
  assert.equal(f.depreciation, 0)
  assert.equal(f.check, 0)
})
