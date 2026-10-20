import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastMonth, parseMonth, shiftMonth, monthLabel } from './month'

test('last month rolls the year back in January', () => {
  assert.equal(lastMonth(new Date('2026-10-19T12:00:00Z')), '2026-09')
  assert.equal(lastMonth(new Date('2026-01-02T00:00:00Z')), '2025-12')
})

test('parseMonth accepts YYYY-MM only', () => {
  const now = new Date('2026-10-19T12:00:00Z')
  assert.equal(parseMonth('2026-03', now), '2026-03')
  for (const bad of ['2026-13', '2026-00', '26-03', 'abc', '', null, undefined]) assert.equal(parseMonth(bad as never, now), '2026-09')
})

test('shiftMonth crosses year ends; label is the long month', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(monthLabel('2026-09'), 'September 2026')
})
