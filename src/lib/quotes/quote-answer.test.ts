import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanAnswerNote, MAX_LINE_QUANTITY, quoteAnswerProblem, validateApprovalChoice } from './quote-answer'

const now = new Date('2026-09-26T12:00:00Z')
const live = { expiresAt: new Date('2026-10-01T00:00:00Z'), usedAt: null }

test('a live, unused link on a quote can answer it', () => {
  assert.equal(quoteAnswerProblem(live, 'QUOTE_SENT', now), null)
  assert.equal(quoteAnswerProblem(live, 'DRAFT', now), null)
})

test('an expired or used link cannot answer', () => {
  assert.equal(quoteAnswerProblem({ ...live, expiresAt: new Date('2026-09-01T00:00:00Z') }, 'QUOTE_SENT', now), 'Quote link expired')
  assert.equal(quoteAnswerProblem({ ...live, usedAt: new Date('2026-09-20T00:00:00Z') }, 'QUOTE_SENT', now), 'This quote has already been answered.')
})

test('an order that has left quote status cannot be answered from a link', () => {
  for (const status of ['APPROVED', 'ACTIVE', 'REVISION', 'LOST', 'CANCELLED', 'COMPLETED', '']) {
    assert.notEqual(quoteAnswerProblem(live, status, now), null, `answerable at ${status}`)
  }
})

test('answer notes are strings within bounds', () => {
  assert.deepEqual(cleanAnswerNote('  more GPUs  ', { required: true }), { ok: true, note: 'more GPUs' })
  assert.equal(cleanAnswerNote('   ', { required: true }).ok, false)
  assert.equal(cleanAnswerNote(undefined, { required: true }).ok, false)
  assert.deepEqual(cleanAnswerNote(undefined, { required: false }), { ok: true, note: null })
  assert.deepEqual(cleanAnswerNote('', { required: false }), { ok: true, note: null })
  assert.equal(cleanAnswerNote({ toString: () => 'x' }, { required: false }).ok, false)
  assert.equal(cleanAnswerNote('x'.repeat(5001), { required: false }).ok, false)
})

const lines = [
  { id: 'a1', packageId: 'pkg_a', quantity: 2, editable: true },
  { id: 'a2', packageId: 'pkg_a', quantity: 1, editable: false },
  { id: 'b1', packageId: 'pkg_b', quantity: 1, editable: true },
]
const order = { packageIds: ['pkg_a', 'pkg_b'], activePackageId: 'pkg_a', lines }

test('the chosen option must be one of this order’s own', () => {
  assert.equal(validateApprovalChoice({ ...order, selectedPackageId: 'pkg_other', quantityChanges: undefined }).ok, false)
  assert.equal(validateApprovalChoice({ ...order, selectedPackageId: 42, quantityChanges: undefined }).ok, false)
  const same = validateApprovalChoice({ ...order, selectedPackageId: 'pkg_a', quantityChanges: undefined })
  assert.ok(same.ok && same.switchTo === null && same.scopePackageId === 'pkg_a')
  const other = validateApprovalChoice({ ...order, selectedPackageId: 'pkg_b', quantityChanges: undefined })
  assert.ok(other.ok && other.switchTo === 'pkg_b' && other.scopePackageId === 'pkg_b')
  const none = validateApprovalChoice({ ...order, selectedPackageId: '', quantityChanges: null })
  assert.ok(none.ok && none.switchTo === null && none.changes.length === 0)
})

test('quantities are whole numbers in range, on visible lines of the option being approved', () => {
  const ok = validateApprovalChoice({ ...order, selectedPackageId: undefined, quantityChanges: [{ itemId: 'a1', newQuantity: 3 }] })
  assert.ok(ok.ok)
  assert.deepEqual(ok.changes, [{ itemId: 'a1', newQuantity: 3 }])
  assert.equal(validateApprovalChoice({ ...order, selectedPackageId: undefined, quantityChanges: [{ itemId: 'a1', newQuantity: MAX_LINE_QUANTITY }] }).ok, true)
  for (const newQuantity of [0, -1, 1.5, MAX_LINE_QUANTITY + 1, Number.NaN, Infinity, '3', null]) {
    const r = validateApprovalChoice({ ...order, selectedPackageId: undefined, quantityChanges: [{ itemId: 'a1', newQuantity }] })
    assert.equal(r.ok, false, `accepted quantity ${String(newQuantity)}`)
  }
  // Another order's line, a hidden row, a line of an option not being approved, a duplicate.
  for (const changes of [
    [{ itemId: 'zz', newQuantity: 1 }],
    [{ itemId: 'a2', newQuantity: 1 }],
    [{ itemId: 'b1', newQuantity: 1 }],
    [{ itemId: 'a1', newQuantity: 1 }, { itemId: 'a1', newQuantity: 2 }],
    'a1',
    [null],
  ]) {
    assert.equal(validateApprovalChoice({ ...order, selectedPackageId: undefined, quantityChanges: changes }).ok, false, JSON.stringify(changes))
  }
  // Switching option moves the scope to that option's lines.
  assert.equal(validateApprovalChoice({ ...order, selectedPackageId: 'pkg_b', quantityChanges: [{ itemId: 'b1', newQuantity: 2 }] }).ok, true)
  assert.equal(validateApprovalChoice({ ...order, selectedPackageId: 'pkg_b', quantityChanges: [{ itemId: 'a1', newQuantity: 2 }] }).ok, false)
})

test('an order with no options scopes to all its visible lines', () => {
  const flat = { packageIds: [], activePackageId: null, lines: [{ id: 'x1', packageId: null, quantity: 1, editable: true }] }
  assert.equal(validateApprovalChoice({ ...flat, selectedPackageId: undefined, quantityChanges: [{ itemId: 'x1', newQuantity: 4 }] }).ok, true)
  assert.equal(validateApprovalChoice({ ...flat, selectedPackageId: 'pkg_a', quantityChanges: undefined }).ok, false)
})
