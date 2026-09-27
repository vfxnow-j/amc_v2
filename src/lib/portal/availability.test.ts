import { test } from 'node:test'
import assert from 'node:assert/strict'
import { combineParts, offerAvailability, solutionStocked } from './availability'
import type { CapacityFigures } from './capacity'

const fig = (available: number, next: CapacityFigures['next_available'], demand: 'normal' | 'high' = 'normal'): CapacityFigures => ({
  total: 10, reserved: 0, tentative: 0, available_now: available, next_available: next, demand,
})

test('a package is as available as its scarcest part, ready when its last part is', () => {
  const figures = new Map([
    ['ws', fig(6, { date: '2026-10-01', status: 'confirmed' })],
    ['tab', fig(3, { date: '2026-10-09', status: 'expected' }, 'high')],
  ])
  const got = combineParts([{ assetId: 'ws', quantity: 1 }, { assetId: 'tab', quantity: 2 }], (id) => figures.get(id), '2026-10-01')
  assert.deepEqual(got, { available_now: 1, next_available: { date: '2026-10-09', status: 'expected' }, demand: 'high' })
})

test('a part that never comes back makes the package none; an unreadable part fails closed', () => {
  const figures = new Map([['ws', fig(0, { date: null, status: 'none' })], ['tab', fig(5, { date: '2026-10-01', status: 'confirmed' })]])
  assert.deepEqual(combineParts([{ assetId: 'ws', quantity: 1 }, { assetId: 'tab', quantity: 1 }], (id) => figures.get(id), '2026-10-01').next_available, { date: null, status: 'none' })
  assert.deepEqual(combineParts([{ assetId: 'gone', quantity: 1 }], () => undefined, '2026-10-01'), { available_now: 0, next_available: { date: null, status: 'none' }, demand: 'normal' })
})

test('no physical parts: not limited by stock', () => {
  assert.equal(combineParts([], () => undefined, '2026-10-01').available_now, null)
})

test('availability is keyed by the solutions sold, from each offering\'s figures; never rto', () => {
  const figures = new Map([['ws', {
    RENTAL: fig(4, { date: '2026-10-01', status: 'confirmed' }),
    FLOW: fig(4, { date: '2026-10-01', status: 'confirmed' }),
    SALE: fig(1, { date: '2026-10-01', status: 'confirmed' }),
  }]])
  const got = offerAvailability(['rental', 'sale', 'rto'], [{ assetId: 'ws', quantity: 1 }], figures, '2026-10-01')
  assert.deepEqual(Object.keys(got), ['rental', 'sale'])
  assert.equal(got.sale?.available_now, 1)
  assert.equal(got.rental?.available_now, 4)
})

test('a solution no unit is ticked for is not stocked; services-only offers always are', () => {
  const none = { ...fig(0, { date: null, status: 'none' as const }), total: 0 }
  const figures = new Map([['ws', { RENTAL: fig(1, { date: '2026-10-01', status: 'confirmed' }), FLOW: none, SALE: none }]])
  assert.equal(solutionStocked('rental', [{ assetId: 'ws', quantity: 1 }], figures), true)
  assert.equal(solutionStocked('flow', [{ assetId: 'ws', quantity: 1 }], figures), false)
  assert.equal(solutionStocked('rto', [{ assetId: 'ws', quantity: 1 }], figures), false)
  assert.equal(solutionStocked('sale', [], figures), true)
})
