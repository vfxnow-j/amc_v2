import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyFromCost } from './sale-to-rental'

test('divides cost by the recovery months', () => {
  assert.equal(monthlyFromCost(6000, 8), 750)
  assert.equal(monthlyFromCost(1000, 7), 150)
})

test('refuses a missing cost or an unusable period', () => {
  assert.equal(monthlyFromCost(0, 8), null)
  assert.equal(monthlyFromCost(1000, 0), null)
  assert.equal(monthlyFromCost(Number.NaN, 8), null)
})

test('rounds up to a flat rate so recovery stays within the period', () => {
  assert.equal(monthlyFromCost(700, 7), 100)
  assert.equal(monthlyFromCost(850, 7), 125)
  assert.equal(monthlyFromCost(1000, 8), 125)
  assert.equal(monthlyFromCost(12600, 7), 1800)
  assert.equal(monthlyFromCost(60000, 7), 8600)
})
