import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveFlowBasis, type FlowBasisUnit } from './flow-basis'

const AS_OF = new Date('2026-09-22T00:00:00Z')

const unit = (over: Partial<FlowBasisUnit> = {}): FlowBasisUnit => ({
  purchasePrice: 5000,
  landedCostAdjustment: 0,
  receivedDate: new Date('2025-09-22T00:00:00Z'),
  purchaseDate: new Date('2025-09-22T00:00:00Z'),
  soldAt: null,
  retiredAt: null,
  ...over,
})

test('basis is landed cost averaged over live units', () => {
  const b = resolveFlowBasis([
    unit({ purchasePrice: 5000, landedCostAdjustment: 200 }),
    unit({ purchasePrice: 6000, landedCostAdjustment: -200 }),
  ], AS_OF)
  assert.equal(b.basis, 5500)       // (5200 + 5800) / 2
  assert.equal(b.costedUnits, 2)
  assert.equal(b.incomplete, false)
})

test('sold and retired units are excluded', () => {
  const b = resolveFlowBasis([
    unit({ purchasePrice: 4000 }),
    unit({ purchasePrice: 9000, soldAt: new Date('2026-01-01T00:00:00Z') }),
    unit({ purchasePrice: 9000, retiredAt: new Date('2026-01-01T00:00:00Z') }),
  ], AS_OF)
  assert.equal(b.basis, 4000)
  assert.equal(b.consideredUnits, 1)
})

test('uncosted units are flagged, not averaged in', () => {
  const b = resolveFlowBasis([
    unit({ purchasePrice: 4000 }),
    unit({ purchasePrice: null }),
  ], AS_OF)
  assert.equal(b.basis, 4000)       // not 2000
  assert.equal(b.costedUnits, 1)
  assert.equal(b.consideredUnits, 2)
  assert.equal(b.incomplete, true)
})

test('nothing costed means no basis, loudly', () => {
  const b = resolveFlowBasis([unit({ purchasePrice: null })], AS_OF)
  assert.equal(b.basis, 0)
  assert.equal(b.costedUnits, 0)
  assert.equal(b.incomplete, true)
})

test('no units at all is handled', () => {
  const b = resolveFlowBasis([], AS_OF)
  assert.equal(b.basis, 0)
  assert.equal(b.consideredUnits, 0)
  assert.equal(b.incomplete, true)
})

test('age prefers receivedDate over purchaseDate', () => {
  const b = resolveFlowBasis([unit({
    receivedDate: new Date('2026-03-22T00:00:00Z'),
    purchaseDate: new Date('2024-09-22T00:00:00Z'),
  })], AS_OF)
  assert.equal(b.monthsInService, 6)
})

test('age falls back to purchaseDate, and ignores the AMC import stamp', () => {
  const real = resolveFlowBasis([unit({
    receivedDate: null, purchaseDate: new Date('2024-09-22T00:00:00Z'),
  })], AS_OF)
  assert.equal(real.monthsInService, 24)

  // 2026-02-07 is the AMC port date, not a purchase. It must not be read as an age.
  const stamped = resolveFlowBasis([unit({
    receivedDate: null, purchaseDate: new Date('2026-02-07T00:00:00Z'),
  })], AS_OF)
  assert.equal(stamped.monthsInService, 0)
  assert.equal(stamped.undatedUnits, 1)
})

test('age is averaged and never negative', () => {
  const b = resolveFlowBasis([
    unit({ receivedDate: new Date('2024-09-22T00:00:00Z') }),
    unit({ receivedDate: new Date('2026-09-22T00:00:00Z') }),
    unit({ receivedDate: new Date('2027-09-22T00:00:00Z') }),  // future: clamps to 0
  ], AS_OF)
  assert.equal(b.monthsInService, 8)   // (24 + 0 + 0) / 3
})
