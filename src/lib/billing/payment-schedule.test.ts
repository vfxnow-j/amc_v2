import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarDay } from './calendar'
import { paymentLine, paymentLineForOption, paymentSchedule, termEnd } from './payment-schedule'
import type { CycleLine, CycleTerms } from './cycle-invoice'

const anchor = { monthly: 1 as const, weekly: 1 }
const lines: CycleLine[] = [{ description: 'Lenovo P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY', isOneTime: false, includedInParent: false }]
const terms = (over: Partial<CycleTerms> = {}): CycleTerms => ({ discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 0, returnCost: 0, ...over })
const base = { type: 'RENTAL', isRecurring: true, cycle: 'MONTHLY', anchor, lines }

test('termEnd: same day N months on, clamped to month end', () => {
  assert.deepEqual(termEnd(calendarDay(2026, 8, 20), 6), calendarDay(2027, 2, 20))
  assert.deepEqual(termEnd(calendarDay(2026, 7, 31), 1), calendarDay(2026, 8, 30))
})

test('6 months starting on the 1st: six equal payments', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() })!
  assert.equal(s.rows!.length, 6)
  assert.deepEqual(s.regular, { subtotal: 1000, tax: 100, total: 1100 })
  assert.equal(s.termTotal, 6600)
  assert.equal(s.first, null)
  assert.equal(s.final, null)
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 + tax = $1,100.00 × 6 months · Term total $6,600.00')
})

test('6 months starting Sep 20: stub, five whole months, final stub', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 8, 20), termMonths: 6, terms: terms() })!
  assert.equal(s.rows!.length, 7)
  assert.equal(s.first!.total, 403.34)   // Sep 20–30: 11/30 of $1,000 + 10%
  assert.equal(s.final!.total, 674.19)   // Mar 1–19: 19/31 of $1,000 + 10%
  assert.equal(s.termTotal, 6577.53)
  assert.deepEqual(paymentLine(s).notes, [
    'First invoice (Sep 20 – Sep 30): $403.34',
    'Final invoice (Mar 1 – Mar 19): $674.19',
  ])
})

test('delivery and a fixed discount show up on the first invoice only', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 3, terms: terms({ deliveryCost: 200, discountType: 'FIXED', discountValue: 100 }) })!
  assert.equal(s.regular.total, 1100)
  assert.equal(s.first!.total, 1190)     // 1000 − 100, +90 tax, +200 delivery
  assert.equal(s.termTotal, 3390)
})

test('no committed term: billed until cancelled', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: null, terms: terms() })!
  assert.equal(s.rows, null)
  assert.equal(s.termTotal, null)
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 + tax = $1,100.00, billed each month until cancelled')
})

test('no tax: no "+ tax =" clause', () => {
  const s = paymentSchedule({ ...base, start: calendarDay(2026, 9, 1), termMonths: 2, terms: terms({ taxRate: 0 }) })!
  assert.equal(paymentLine(s).headline, 'Monthly payment: $1,000.00 × 2 months · Term total $2,000.00')
})

test('weekly cycles say weekly and give the term in months', () => {
  const s = paymentSchedule({ ...base, cycle: 'WEEKLY', lines: [{ ...lines[0], rate: 300, pricingType: 'WEEKLY' }], start: calendarDay(2026, 9, 5), termMonths: 1, terms: terms({ taxRate: 0 }) })!
  assert.match(paymentLine(s).headline, /^Weekly payment: \$300\.00 · 1-month term · Term total \$/)
})

test('no payment line for one-time, sale, rent-to-own or non-anchored cycles', () => {
  assert.equal(paymentSchedule({ ...base, cycle: 'ONE_TIME', start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, type: 'SALE', start: calendarDay(2026, 9, 1), termMonths: null, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, type: 'RENT_TO_OWN', start: calendarDay(2026, 9, 1), termMonths: 12, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, cycle: 'DAILY', start: calendarDay(2026, 9, 1), termMonths: 1, terms: terms() }), null)
  assert.equal(paymentSchedule({ ...base, isRecurring: false, start: calendarDay(2026, 9, 1), termMonths: 6, terms: terms() }), null)
})

// paymentLineForOption — the online quote prices each option in memory from an
// order it already loaded, rather than one query per package.
const orderRow = {
  reservationType: 'RENTAL', isRecurring: true, billingCycleType: 'MONTHLY',
  startDate: calendarDay(2026, 9, 1), termMonths: null,
  discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 0, returnCost: 0,
}
const optionItem = (over: Record<string, unknown> = {}) => ({
  description: 'Lenovo P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY',
  isOneTime: false, includedInParent: false, packageId: null as string | null, ...over,
})

test('paymentLineForOption: no packageId prices whichever package is active', () => {
  const items = [optionItem({ packageId: 'a', rate: 1000 }), optionItem({ packageId: 'b', rate: 2000 })]
  const packages = [
    { id: 'a', isActive: true, deliveryCost: 0, returnCost: 0 },
    { id: 'b', isActive: false, deliveryCost: 0, returnCost: 0 },
  ]
  assert.match(paymentLineForOption(orderRow, items, packages, anchor)!.headline, /^Monthly payment: \$1,000\.00/)
})

test('paymentLineForOption: a packageId prices that option instead of the active one', () => {
  const items = [optionItem({ packageId: 'a', rate: 1000 }), optionItem({ packageId: 'b', rate: 2000 })]
  const packages = [
    { id: 'a', isActive: true, deliveryCost: 0, returnCost: 0 },
    { id: 'b', isActive: false, deliveryCost: 0, returnCost: 0 },
  ]
  assert.match(paymentLineForOption(orderRow, items, packages, anchor, 'b')!.headline, /^Monthly payment: \$2,000\.00/)
})

test('paymentLineForOption: an item with no package bills under every option', () => {
  const items = [optionItem({ packageId: null, rate: 500 }), optionItem({ packageId: 'a', rate: 1000 }), optionItem({ packageId: 'b', rate: 2000 })]
  const packages = [
    { id: 'a', isActive: true, deliveryCost: 0, returnCost: 0 },
    { id: 'b', isActive: false, deliveryCost: 0, returnCost: 0 },
  ]
  assert.match(paymentLineForOption(orderRow, items, packages, anchor, 'a')!.headline, /^Monthly payment: \$1,500\.00/)
  assert.match(paymentLineForOption(orderRow, items, packages, anchor, 'b')!.headline, /^Monthly payment: \$2,500\.00/)
})

test("paymentLineForOption: a package's own delivery/return cost is used for that option, not another's", () => {
  const items = [optionItem({ packageId: 'a' }), optionItem({ packageId: 'b' })]
  const packages = [
    { id: 'a', isActive: true, deliveryCost: 100, returnCost: 50 },
    { id: 'b', isActive: false, deliveryCost: 0, returnCost: 0 },
  ]
  // Delivery/return only ride on a differing first invoice, so a term short
  // enough that the whole thing is the "first" stretch shows the difference.
  const withTerm = { ...orderRow, termMonths: 1 }
  const a = paymentLineForOption(withTerm, items, packages, anchor, 'a')!
  const b = paymentLineForOption(withTerm, items, packages, anchor, 'b')!
  assert.notEqual(a.headline, b.headline)
})

test('paymentLineForOption: no packages at all prices the order\'s own items and shipping', () => {
  const line = paymentLineForOption(orderRow, [optionItem({ packageId: null })], [], anchor)!
  assert.match(line.headline, /^Monthly payment: \$1,000\.00/)
})

test('paymentLineForOption: a sale has no payment line, whichever option is asked for', () => {
  const saleOrder = { ...orderRow, reservationType: 'SALE' }
  assert.equal(paymentLineForOption(saleOrder, [optionItem()], [], anchor), null)
})
