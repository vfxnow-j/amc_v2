import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyFromCost } from './sale-to-rental'

test('divides cost by the recovery months', () => {
  assert.equal(monthlyFromCost(6000, 8), 750)
  assert.equal(monthlyFromCost(1000, 7), 142.86)
})

test('refuses a missing cost or an unusable period', () => {
  assert.equal(monthlyFromCost(0, 8), null)
  assert.equal(monthlyFromCost(1000, 0), null)
  assert.equal(monthlyFromCost(Number.NaN, 8), null)
})
