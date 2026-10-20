import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTE_LOCKED_MESSAGE,
  changesQuote,
  mayChange,
  quoteEditable,
  updateChangesQuote,
  type ChangeCategory,
} from './quote-lock'

const STATUSES = ['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'LOST']

const QUOTE: ChangeCategory[] = [
  'line-rate', 'line-quantity', 'line-add', 'line-remove', 'line-detail', 'line-order',
  'option', 'discount-tax', 'shipping-price', 'dates', 'build',
]
const OPERATIONAL: ChangeCategory[] = ['shipping-details', 'notes', 'checkout', 'status', 'billing', 'approval']

test('the refusal says what happened and the way forward', () => {
  assert.equal(QUOTE_LOCKED_MESSAGE, 'This quote has been sent. Request a revision to change it.')
})

test('status x category: quote changes only on a draft or a revision, operational changes always', () => {
  for (const status of STATUSES) {
    const open = status === 'DRAFT' || status === 'REVISION'
    for (const c of QUOTE) assert.equal(mayChange(c, status, 'SALE'), open, `${c} on ${status}`)
    for (const c of OPERATIONAL) assert.equal(mayChange(c, status, 'SALE'), true, `${c} on ${status}`)
  }
})

test('every category is classified one way or the other', () => {
  for (const c of QUOTE) assert.equal(changesQuote(c), true, c)
  for (const c of OPERATIONAL) assert.equal(changesQuote(c), false, c)
})

test('a live Flow or Cloud subscription stays manageable; other live orders do not', () => {
  assert.equal(quoteEditable('ACTIVE', 'FLOW'), true)
  assert.equal(quoteEditable('ACTIVE', 'CLOUD'), true)
  for (const t of ['SALE', 'RENTAL', 'RENT_TO_OWN']) assert.equal(quoteEditable('ACTIVE', t), false, t)
  // The exception is for ACTIVE only: a sent Flow quote is locked like any other.
  assert.equal(quoteEditable('QUOTE_SENT', 'FLOW'), false)
  assert.equal(quoteEditable('APPROVED', 'CLOUD'), false)
})

const existing = {
  startDate: new Date('2026-11-01'), endDate: new Date('2026-12-01'),
  discountType: 'PERCENTAGE', discountValue: '5', taxRate: '8.5',
  deliveryCost: '100', returnCost: '0', shippingMarginType: null, shippingMargin: '0',
}

test('a form posting the record back unchanged is not a quote change', () => {
  assert.equal(updateChangesQuote({
    startDate: new Date('2026-11-01'), endDate: new Date('2026-12-01'), discountType: 'PERCENTAGE',
    discountValue: 5, taxRate: 8.5, deliveryCost: 100, returnCost: 0, shippingMarginType: '', shippingMargin: 0,
    deliveryTrackingNumber: '1Z', notes: 'x', billingCycleType: 'MONTHLY',
  }, existing), false)
})

test('discount, tax, shipping price, dates and lines are quote changes', () => {
  assert.equal(updateChangesQuote({ discountValue: 10 }, existing), true)
  assert.equal(updateChangesQuote({ discountType: 'FIXED' }, existing), true)
  assert.equal(updateChangesQuote({ taxRate: 0 }, existing), true)
  assert.equal(updateChangesQuote({ deliveryCost: 120 }, existing), true)
  assert.equal(updateChangesQuote({ shippingMarginType: 'PERCENTAGE' }, existing), true)
  assert.equal(updateChangesQuote({ endDate: new Date('2026-12-15') }, existing), true)
  assert.equal(updateChangesQuote({ items: [] }, existing), true)
})

test('tracking, notes and billing terms are not quote changes', () => {
  assert.equal(updateChangesQuote({ deliveryTrackingNumber: 'abc', deliveryNotes: 'n', internalNotes: 'i', paymentTerms: 30, billingCycleType: 'WEEKLY' }, existing), false)
})

test('dates are ignored for an order that is already out (Extend moves them)', () => {
  assert.equal(updateChangesQuote({ endDate: new Date('2027-01-01') }, existing, { ignoreDates: true }), false)
  assert.equal(updateChangesQuote({ discountValue: 9 }, existing, { ignoreDates: true }), true)
})
