import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canEnterEntities, entityIdsFor, canWriteInEntity, type AccessUser } from './access'

const base: AccessUser = { role: 'STAFF', entityAccess: true, entityScope: 'SELECTED', grantedEntityIds: ['a'] }

test('super admin enters every entity without a flag', () => {
  const u = { ...base, role: 'SUPER_ADMIN' as const, entityAccess: false }
  assert.equal(canEnterEntities(u), true)
  assert.deepEqual(entityIdsFor(u, ['a', 'b']), ['a', 'b'])
})

test('flag off means no access', () => {
  assert.equal(canEnterEntities({ ...base, entityAccess: false }), false)
  assert.deepEqual(entityIdsFor({ ...base, entityAccess: false }, ['a', 'b']), [])
})

test('SELECTED limits to grants that still exist', () => {
  assert.deepEqual(entityIdsFor({ ...base, grantedEntityIds: ['a', 'gone'] }, ['a', 'b']), ['a'])
})

test('ALL grants every entity', () => {
  assert.deepEqual(entityIdsFor({ ...base, entityScope: 'ALL' }, ['a', 'b']), ['a', 'b'])
})

test('flow users never get access, whatever the flag says', () => {
  const u = { ...base, role: 'FLOW_USER' as const, entityScope: 'ALL' as const }
  assert.equal(canEnterEntities(u), false)
  assert.deepEqual(entityIdsFor(u, ['a']), [])
})

test('writing needs STAFF or above', () => {
  assert.equal(canWriteInEntity('VIEWER'), false)
  assert.equal(canWriteInEntity('STAFF'), true)
  assert.equal(canWriteInEntity('ADMIN'), true)
  assert.equal(canWriteInEntity('FLOW_USER'), false)
})
