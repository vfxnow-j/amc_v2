import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickScanLine, unitChargeFor } from './lines'

const line = (id: string, over: Partial<{ parentId: string | null; quantity: number; checkedOutCount: number }> = {}) =>
  ({ id, parentId: null, quantity: 1, checkedOutCount: 0, ...over })

test('the line this unit is already assigned to wins, even when full', () => {
  const lines = [line('top'), line('gpu', { parentId: 'ws', checkedOutCount: 1 })]
  assert.equal(pickScanLine(lines, 'gpu')?.id, 'gpu')
})

test('no assignment: a top-level line with room comes before a part with room', () => {
  const lines = [line('gpu', { parentId: 'ws' }), line('top')]
  assert.equal(pickScanLine(lines, null)?.id, 'top')
})

test('top-level full, part has room: the part (GPU marries into its workstation)', () => {
  const lines = [line('top', { checkedOutCount: 1 }), line('gpu', { parentId: 'ws' })]
  assert.equal(pickScanLine(lines, null)?.id, 'gpu')
})

test('everything full: first top-level line stretches', () => {
  const lines = [line('gpu', { parentId: 'ws', checkedOutCount: 1 }), line('top', { checkedOutCount: 1 })]
  assert.equal(pickScanLine(lines, null)?.id, 'top')
})

test('only full parts: first part', () => {
  assert.equal(pickScanLine([line('gpu', { parentId: 'ws', checkedOutCount: 1 })], null)?.id, 'gpu')
})

test('no lines: null (caller creates an ad-hoc line)', () => {
  assert.equal(pickScanLine([], null), null)
})

test('an assignment to a line not in the candidates is ignored', () => {
  assert.equal(pickScanLine([line('top')], 'elsewhere')?.id, 'top')
})

test('a part included in its system price checks out at no charge', () => {
  assert.equal(unitChargeFor({ includedInParent: true }, 450), 0)
  assert.equal(unitChargeFor({ includedInParent: false }, 450), 450)
})
