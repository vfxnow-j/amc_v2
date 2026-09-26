import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleInvoice, cycleTermsFor, type CycleLine, type CycleTerms } from './cycle-invoice'

const line = (over: Partial<CycleLine> = {}): CycleLine => ({
  description: 'Lenovo P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY',
  isOneTime: false, includedInParent: false, ...over,
})
const terms = (over: Partial<CycleTerms> = {}): CycleTerms => ({
  discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 0, returnCost: 0, ...over,
})

test('a whole period: rate × qty, taxed', () => {
  const inv = cycleInvoice({ lines: [line({ quantity: 2 })], share: 1, first: false, terms: terms() })
  assert.equal(inv.itemsSubtotal, 2000)
  assert.equal(inv.taxAmount, 200)
  assert.equal(inv.total, 2200)
})

test('a stub bills its share of the rate', () => {
  const inv = cycleInvoice({ lines: [line()], share: 11 / 30, first: true, terms: terms() })
  assert.equal(inv.itemsSubtotal, 366.67)
  assert.equal(inv.taxAmount, 36.67)
  assert.equal(inv.total, 403.34)
})

test('a part included in its system price is not billed', () => {
  const inv = cycleInvoice({ lines: [line(), line({ description: 'RTX A6000', rate: 400, includedInParent: true })], share: 1, first: false, terms: terms() })
  assert.equal(inv.itemsSubtotal, 1000)
  assert.equal(inv.items.length, 1)
})

test('a one-time line is billed on the first invoice only, whole', () => {
  const setup = line({ description: 'Imaging', rate: 300, isOneTime: true })
  assert.equal(cycleInvoice({ lines: [line(), setup], share: 0.5, first: true, terms: terms() }).itemsSubtotal, 800)
  assert.equal(cycleInvoice({ lines: [line(), setup], share: 1, first: false, terms: terms() }).itemsSubtotal, 1000)
})

test('a percentage discount comes off every period, as its own line, before tax', () => {
  const inv = cycleInvoice({ lines: [line()], share: 1, first: false, terms: terms({ discountType: 'PERCENTAGE', discountValue: 10 }) })
  assert.equal(inv.discount, 100)
  assert.equal(inv.taxable, 900)
  assert.equal(inv.taxAmount, 90)
  assert.equal(inv.total, 990)
  assert.deepEqual(inv.items.at(-1), { description: 'Discount (10%)', quantity: 1, unitPrice: -100, amount: -100, assetId: null })
})

test('a fixed discount comes off once, on the first invoice', () => {
  const t = terms({ discountType: 'FIXED', discountValue: 250 })
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: true, terms: t }).total, 825)
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: false, terms: t }).total, 1100)
})

test('a fixed discount never exceeds what the invoice bills', () => {
  const inv = cycleInvoice({ lines: [line({ rate: 100 })], share: 1, first: true, terms: terms({ discountType: 'FIXED', discountValue: 500 }) })
  assert.equal(inv.discount, 100)
  assert.equal(inv.total, 0)
})

test('delivery and return ride on the first invoice, untaxed', () => {
  const t = terms({ deliveryCost: 150, returnCost: 50 })
  const first = cycleInvoice({ lines: [line()], share: 1, first: true, terms: t })
  assert.equal(first.oneTimeCharges, 200)
  assert.equal(first.taxAmount, 100)
  assert.equal(first.total, 1300)
  assert.equal(first.subtotal, 1200)
  assert.equal(cycleInvoice({ lines: [line()], share: 1, first: false, terms: t }).total, 1100)
})

test('shareNote labels recurring lines only', () => {
  const inv = cycleInvoice({ lines: [line(), line({ description: 'Imaging', rate: 300, isOneTime: true })], share: 0.5, first: true, terms: terms(), shareNote: ' × 0.5' })
  assert.equal(inv.items[0].description, 'Lenovo P620 (MONTHLY rate × 0.5)')
  assert.equal(inv.items[1].description, 'Imaging (one-time)')
})

test('cycleTermsFor applies the shipping margin', () => {
  const t = cycleTermsFor({ discountType: null, discountValue: null, taxRate: '9.5', deliveryCost: '100', returnCost: '100', shippingMarginType: 'PERCENTAGE', shippingMargin: 20 })
  assert.deepEqual(t, { discountType: null, discountValue: 0, taxRate: 9.5, deliveryCost: 120, returnCost: 120 })
})
