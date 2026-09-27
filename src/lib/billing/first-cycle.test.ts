import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CYCLE_STAMPS_SINCE, firstStretchNote, isCycleInvoice, isFirstCycleInvoice, priorCycleInvoiceWhere } from './first-cycle'

const after = new Date(CYCLE_STAMPS_SINCE.getTime() + 86_400_000)
const before = new Date(CYCLE_STAMPS_SINCE.getTime() - 86_400_000)
const inv = (over: Partial<Parameters<typeof isCycleInvoice>[0]> = {}) => ({
  status: 'DRAFT', periodNumber: null, periodStartDate: null, createdAt: after, ...over,
})

test('no invoices yet: the next one is the first', () => {
  assert.equal(isFirstCycleInvoice([]), true)
})

test('an add-on invoice (no stretch stamp) does not take "first"', () => {
  assert.equal(isCycleInvoice(inv()), false)
  assert.equal(isFirstCycleInvoice([inv(), inv({ status: 'SENT' })]), true)
})

test('a stretch invoice — periodNumber or periodStartDate — does', () => {
  assert.equal(isCycleInvoice(inv({ periodNumber: 1 })), true)
  assert.equal(isCycleInvoice(inv({ periodStartDate: after })), true)
  assert.equal(isFirstCycleInvoice([inv(), inv({ periodNumber: 1 })]), false)
})

test('a void or cancelled stretch invoice does not count', () => {
  assert.equal(isCycleInvoice(inv({ periodNumber: 1, status: 'VOID' })), false)
  assert.equal(isCycleInvoice(inv({ periodNumber: 1, status: 'CANCELLED' })), false)
  assert.equal(isFirstCycleInvoice([inv({ periodNumber: 1, status: 'VOID' })]), true)
})

test('an unstamped invoice from before the stamping counts as the first stretch', () => {
  assert.equal(isCycleInvoice(inv({ createdAt: before })), true)
  assert.equal(isCycleInvoice(inv({ createdAt: before, status: 'VOID' })), false)
})

test('the prisma where says the same thing', () => {
  const where = priorCycleInvoiceWhere('r1')
  assert.equal(where.reservationId, 'r1')
  assert.deepEqual(where.status.notIn, ['VOID', 'CANCELLED'])
  assert.deepEqual(where.OR, [
    { periodNumber: { not: null } },
    { periodStartDate: { not: null } },
    { createdAt: { lt: CYCLE_STAMPS_SINCE } },
  ])
})

test('the stretch note is empty for a whole period or no stretch', () => {
  assert.equal(firstStretchNote(null), '')
  const d = new Date('2026-09-20T12:00:00Z')
  assert.equal(firstStretchNote({ start: d, end: d, periods: 1 }), '')
  assert.match(firstStretchNote({ start: new Date('2026-09-20T12:00:00Z'), end: new Date('2026-09-30T12:00:00Z'), periods: 11 / 30 }), /Sep 20 – Sep 30/)
})
