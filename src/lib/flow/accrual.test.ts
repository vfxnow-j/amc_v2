import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowAccrualInWindow } from './accrual'

const d = (s: string) => new Date(`${s}T12:00:00Z`)
// A stepped schedule: 100 a month in year one, 60 after the anniversary.
const rate = (m: number) => (m <= 12 ? 100 : 60)

test('a month accrues its scheduled rate, not the contract total', () => {
  const sum = flowAccrualInWindow({
    start: d('2026-01-01'), effectiveEnd: d('2026-12-31'),
    from: d('2026-03-01'), to: d('2026-03-31'), termMonths: 24, rateForMonth: rate,
  })
  assert.equal(sum, 100)
})

test('months after the anniversary accrue the stepped rate', () => {
  const sum = flowAccrualInWindow({
    start: d('2026-01-01'), effectiveEnd: d('2028-06-01'),
    from: d('2026-11-01'), to: d('2027-03-01'), termMonths: 24, rateForMonth: rate,
  })
  // Nov, Dec at 100; Jan, Feb (months 13, 14) at 60.
  assert.equal(sum, 320)
})

test('nothing accrues past the term', () => {
  const sum = flowAccrualInWindow({
    start: d('2026-01-01'), effectiveEnd: d('2030-01-01'),
    from: d('2026-01-01'), to: d('2030-01-01'), termMonths: 3, rateForMonth: rate,
  })
  assert.equal(sum, 300)
})

test('nothing accrues after the effective end', () => {
  const sum = flowAccrualInWindow({
    start: d('2026-01-01'), effectiveEnd: d('2026-02-15'),
    from: d('2026-01-01'), to: d('2027-01-01'), termMonths: 24, rateForMonth: rate,
  })
  // Months starting Jan 1 and Feb 1 only.
  assert.equal(sum, 200)
})

test('a window before the start accrues nothing', () => {
  const sum = flowAccrualInWindow({
    start: d('2026-06-01'), effectiveEnd: d('2027-01-01'),
    from: d('2026-01-01'), to: d('2026-06-01'), termMonths: 24, rateForMonth: rate,
  })
  assert.equal(sum, 0)
})
