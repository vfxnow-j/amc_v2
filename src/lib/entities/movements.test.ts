import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyUnitMovement, applyStockMovement } from './movements'

const stored = { status: 'IN_STORAGE', locationId: 'L1' } as const
const deployed = { status: 'DEPLOYED', locationId: 'DC' } as const

test('receive creates a unit in storage at the location', () => {
  assert.deepEqual(applyUnitMovement(null, { type: 'RECEIVE', toLocationId: 'L1' }), { ok: true, next: stored })
})
test('receive needs a location', () => {
  assert.equal(applyUnitMovement(null, { type: 'RECEIVE' }).ok, false)
})
test('receive on a unit already in custody is refused', () => {
  assert.equal(applyUnitMovement(stored, { type: 'RECEIVE', toLocationId: 'L2' }).ok, false)
})
test('a unit handed back to its owner can be received again', () => {
  const r = applyUnitMovement({ status: 'RETURNED_TO_OWNER', locationId: null }, { type: 'RECEIVE', toLocationId: 'L2' })
  assert.deepEqual(r, { ok: true, next: { status: 'IN_STORAGE', locationId: 'L2' } })
})
test('move changes location while in storage', () => {
  assert.deepEqual(applyUnitMovement(stored, { type: 'MOVE', toLocationId: 'L2' }), { ok: true, next: { status: 'IN_STORAGE', locationId: 'L2' } })
})
test('move to where it already is is refused', () => {
  assert.equal(applyUnitMovement(stored, { type: 'MOVE', toLocationId: 'L1' }).ok, false)
})
test('a deployed unit cannot be moved, only returned', () => {
  assert.equal(applyUnitMovement(deployed, { type: 'MOVE', toLocationId: 'L1' }).ok, false)
})
test('release deploys to the destination and needs a recipient', () => {
  assert.deepEqual(applyUnitMovement(stored, { type: 'RELEASE', toLocationId: 'DC', recipient: 'Acme' }), { ok: true, next: deployed })
  assert.equal(applyUnitMovement(stored, { type: 'RELEASE', toLocationId: 'DC' }).ok, false)
  assert.equal(applyUnitMovement(stored, { type: 'RELEASE', recipient: 'Acme' }).ok, false)
})
test('release to the owner closes custody and needs no destination', () => {
  assert.deepEqual(applyUnitMovement(stored, { type: 'RELEASE', recipient: 'Acme', finalToOwner: true }), { ok: true, next: { status: 'RETURNED_TO_OWNER', locationId: null } })
})
test('release of something not in storage is refused', () => {
  assert.equal(applyUnitMovement(deployed, { type: 'RELEASE', toLocationId: 'X', recipient: 'A' }).ok, false)
})
test('return brings a deployed unit back to a location', () => {
  assert.deepEqual(applyUnitMovement(deployed, { type: 'RETURN', toLocationId: 'L1' }), { ok: true, next: stored })
  assert.equal(applyUnitMovement(stored, { type: 'RETURN', toLocationId: 'L1' }).ok, false)
})

test('stock: receive adds, creating the row', () => {
  const r = applyStockMovement([], { type: 'RECEIVE', toLocationId: 'L1', quantity: 40 })
  assert.deepEqual(r, { ok: true, rows: [{ locationId: 'L1', deployed: false, quantity: 40 }] })
})
test('stock: move splits and merges', () => {
  const r = applyStockMovement(
    [{ locationId: 'L1', deployed: false, quantity: 40 }, { locationId: 'L2', deployed: false, quantity: 5 }],
    { type: 'MOVE', fromLocationId: 'L1', toLocationId: 'L2', quantity: 15 },
  )
  assert.deepEqual(r, { ok: true, rows: [{ locationId: 'L1', deployed: false, quantity: 25 }, { locationId: 'L2', deployed: false, quantity: 20 }] })
})
test('stock: moving more than is there is refused', () => {
  assert.equal(applyStockMovement([{ locationId: 'L1', deployed: false, quantity: 3 }], { type: 'MOVE', fromLocationId: 'L1', toLocationId: 'L2', quantity: 4 }).ok, false)
})
test('stock: release deploys at the destination, return brings it back', () => {
  const out = applyStockMovement([{ locationId: 'L1', deployed: false, quantity: 10 }], { type: 'RELEASE', fromLocationId: 'L1', toLocationId: 'DC', recipient: 'A', quantity: 4 })
  assert.deepEqual(out, { ok: true, rows: [{ locationId: 'L1', deployed: false, quantity: 6 }, { locationId: 'DC', deployed: true, quantity: 4 }] })
  if (!out.ok) return
  const back = applyStockMovement(out.rows, { type: 'RETURN', fromLocationId: 'DC', toLocationId: 'L1', quantity: 4 })
  assert.deepEqual(back, { ok: true, rows: [{ locationId: 'L1', deployed: false, quantity: 10 }] })
})
test('stock: final release to owner only subtracts', () => {
  const r = applyStockMovement([{ locationId: 'L1', deployed: false, quantity: 10 }], { type: 'RELEASE', fromLocationId: 'L1', recipient: 'A', finalToOwner: true, quantity: 10 })
  assert.deepEqual(r, { ok: true, rows: [] })
})
test('stock: quantity must be a positive whole number', () => {
  assert.equal(applyStockMovement([], { type: 'RECEIVE', toLocationId: 'L1', quantity: 0 }).ok, false)
  assert.equal(applyStockMovement([], { type: 'RECEIVE', toLocationId: 'L1', quantity: 1.5 }).ok, false)
})
