import { test } from 'node:test'
import assert from 'node:assert/strict'
import { earnedRevenue, type EarningCheckout } from './earned'

const anchor = { monthly: 1 as const, weekly: 1 }
const day = (s: string) => new Date(`${s}T12:00:00Z`)

// One unit on a recurring monthly order, out since January, still out in June.
const checkout = (reservationType: string, lineRate: number, totalCharge: number): EarningCheckout => ({
  status: 'ACTIVE',
  checkoutDate: day('2026-01-01'),
  actualReturn: null,
  totalCharge,
  lineRate,
  linePricingType: 'MONTHLY',
  lineQuantity: 1,
  lineSubtotal: lineRate,
  lineOneTime: false,
  order: {
    reservationType,
    status: 'ACTIVE',
    isRecurring: true,
    notBilled: false,
    billingCycleType: 'MONTHLY',
    billingCycleDays: null,
    startDate: day('2026-01-01'),
    recurrenceEndDate: null,
    completedAt: null,
  },
})

test('a recurring rental earns its line rate for every period out', () => {
  assert.ok(earnedRevenue(checkout('RENTAL', 500, 500), anchor, day('2026-06-10')) > 500)
})

test('a Flow unit keeps its checkout charge — its line rate is the whole contract', () => {
  assert.equal(earnedRevenue(checkout('FLOW', 12000, 12000), anchor, day('2026-06-10')), 12000)
})

test('a rent-to-own unit keeps its checkout charge', () => {
  assert.equal(earnedRevenue(checkout('RENT_TO_OWN', 9000, 9000), anchor, day('2026-06-10')), 9000)
})
