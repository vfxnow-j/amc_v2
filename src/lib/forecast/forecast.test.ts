import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarDay } from '@/lib/billing/calendar'
import type { CycleLine, CycleTerms } from '@/lib/billing/cycle-invoice'
import { dueMonth, monthKey, orderCharges, type ScheduleOrder } from './schedule'
import { bookedVersionOf, groupDeals, normalizeDealName, type GroupableOrder } from './groups'

const anchor = { monthly: 1 as const, weekly: 1 }
const lines: CycleLine[] = [{ description: 'P620', assetId: 'a1', rate: 1000, quantity: 1, pricingType: 'MONTHLY', isOneTime: false, includedInParent: false }]
const terms: CycleTerms = { discountType: null, discountValue: 0, taxRate: 10, deliveryCost: 200, returnCost: 0 }
const order = (over: Partial<ScheduleOrder> = {}): ScheduleOrder => ({
  type: 'RENTAL', isRecurring: true, cycle: 'MONTHLY', cycleDays: null, start: calendarDay(2026, 9, 1),
  termMonths: null, recurrenceEnd: null, netTotal: 1000, taxShare: 0, rto: { months: null, payment: null, start: null }, flow: null, ...over,
})
const run = (o: ScheduleOrder, termsDays = 30) =>
  orderCharges({ order: o, lines, terms, anchor, from: calendarDay(2026, 9, 1), to: calendarDay(2027, 9, 1), termsDays })

test('dueMonth: net 30 from the 1st is always next month; net 15 from the 1st stays', () => {
  for (let m = 0; m < 12; m++) assert.equal(monthKey(dueMonth(calendarDay(2026, m, 1), 30)), monthKey(calendarDay(2026, m + 1, 1)))
  assert.equal(monthKey(dueMonth(calendarDay(2026, 9, 1), 15)), '2026-10')
  assert.equal(monthKey(dueMonth(calendarDay(2026, 9, 20), 15)), '2026-11')
})

test('month-to-month rental bills ex-tax every month to the end of the window, delivery on the first', () => {
  const c = run(order())
  assert.equal(c.length, 12)
  assert.equal(c[0].amount, 1200)
  assert.ok(c.slice(1).every((x) => x.amount === 1000))
})

test('a committed term stops billing; a mid-month start bills a prorated stub', () => {
  const c = run(order({ start: calendarDay(2026, 9, 16), termMonths: 3 }))
  assert.equal(monthKey(c[0].billed), '2026-10')
  assert.ok(c[0].amount < 1200 && c[0].amount > 200)
  assert.equal(monthKey(c[c.length - 1].billed), '2027-01')
  assert.ok(c[c.length - 1].amount < 1000)
})

test('rent-to-own bills its installment without tax; once-billed bills its net total on its date', () => {
  const rto = run(order({ type: 'RENT_TO_OWN', taxShare: 0.1, rto: { months: 3, payment: 1100, start: calendarDay(2026, 10, 1) } }))
  assert.deepEqual(rto.map((x) => x.amount), [990, 990, 990])
  const sale = run(order({ type: 'SALE', isRecurring: false, start: calendarDay(2026, 11, 5), netTotal: 5000 }))
  assert.deepEqual(sale.map((x) => [monthKey(x.billed), x.amount]), [['2026-12', 5000]])
})

test('Flow bills the schedule rate for each term month', () => {
  const c = run(order({ type: 'FLOW', flow: { months: 14, start: calendarDay(2026, 9, 1), rateForMonth: (m) => (m <= 12 ? 500 : 300) } }), 0)
  assert.equal(c.length, 12)
  assert.ok(c.every((x) => x.amount === 500))
})

const deal = (over: Partial<GroupableOrder>): GroupableOrder => ({
  id: 'x', clientId: 'c1', name: null, assetIds: [], status: 'DRAFT', updatedAt: new Date('2026-09-20'), stale: false, choice: null, ...over,
})

test('names match through "(copy)" and "Flow -"', () => {
  assert.equal(normalizeDealName('FLOW - 2x X13 Chassis (copy)'), normalizeDealName('2x X13 Chassis'))
})

test('versions of one deal count once: furthest stage, then most recent; stale never beats fresh', () => {
  const groups = groupDeals([
    deal({ id: 'a', name: '40 Systems', status: 'DRAFT', updatedAt: new Date('2026-09-25') }),
    deal({ id: 'b', name: '40 Systems (copy)', status: 'QUOTE_SENT', updatedAt: new Date('2026-09-01') }),
    deal({ id: 'c', name: 'Other', assetIds: ['m1', 'm2'], status: 'QUOTE_SENT', stale: true }),
    deal({ id: 'd', name: 'Other build', assetIds: ['m1', 'm2', 'm3'] }),
    deal({ id: 'e', name: '40 Systems', clientId: 'c2' }),
  ])
  const of = (id: string) => groups.find((g) => g.orders.some((o) => o.id === id))!
  assert.deepEqual([...of('a').counted], ['b'])
  assert.deepEqual([...of('c').counted], ['d'])
  assert.deepEqual([...of('e').counted], ['e'])
})

test('owner choices: count, leave out, separate', () => {
  const groups = groupDeals([
    deal({ id: 'a', name: 'X', choice: 'COUNT', stale: true }),
    deal({ id: 'b', name: 'X', status: 'QUOTE_SENT' }),
    deal({ id: 'c', name: 'X', choice: 'SEPARATE' }),
    deal({ id: 'd', name: 'Y', choice: 'SKIP' }),
  ])
  const of = (id: string) => groups.find((g) => g.orders.some((o) => o.id === id))!
  assert.deepEqual([...of('a').counted], ['a'])
  assert.deepEqual([...of('c').counted], ['c'])
  assert.equal(of('d').counted.size, 0)
})

test('a quote that is a version of a booked order does not count on top of it', () => {
  // RES-2026-00090: a smaller re-quote of Ramsey's live RES-2026-00001, same models, same dates.
  const feb = { start: new Date('2026-02-01'), end: new Date('2026-08-31') }
  const live = { number: 'RES-1', clientId: 'c1', name: null, assetIds: ['m1', 'm2', 'm3'], period: feb }
  const q = (over: Partial<GroupableOrder> & { period?: typeof feb } = {}) =>
    ({ ...deal({ id: 'q', name: null, assetIds: ['m1', 'm2'], ...over }), period: over.period ?? feb })
  assert.equal(bookedVersionOf(q(), [live])?.number, 'RES-1')
  assert.equal(bookedVersionOf(q({ clientId: 'c2' }), [live]), null)
  assert.equal(bookedVersionOf(q({ assetIds: ['m9'] }), [live]), null)
  // The same client renting the same models again later is new business.
  assert.equal(bookedVersionOf(q({ period: { start: new Date('2026-10-07'), end: new Date('2026-10-31') } }), [live]), null)
  assert.equal(bookedVersionOf(q({ choice: 'SEPARATE' }), [live]), null)
  assert.equal(bookedVersionOf(q({ choice: 'COUNT' }), [live]), null)
})

test('a rental bills until its planned return, never under one whole month', () => {
  // Out Oct 3, back Oct 19: one stretch, topped up to a whole month (plus delivery on the first bill).
  const short = run(order({ start: calendarDay(2026, 9, 3), plannedEnd: calendarDay(2026, 9, 20) }))
  assert.deepEqual(short.map((x) => [monthKey(x.billed), x.amount]), [['2026-10', 1200]])
  // Out Oct 1, back Dec 3: Oct and Nov whole, December's stretch at the week minimum.
  const long = run(order({ plannedEnd: calendarDay(2026, 11, 4) }))
  assert.deepEqual(long.map((x) => monthKey(x.billed)), ['2026-10', '2026-11', '2026-12'])
  assert.equal(long[2].amount, Math.round((1000 * 7) / 31 * 100) / 100)
})

test('periodMonths: month, quarter, next quarter, year and 12 months from mid-quarter', async () => {
  const { periodMonths } = await import('./period')
  const today = calendarDay(2026, 10, 19) // 2026-11-19
  assert.deepEqual(periodMonths('month', today), ['2026-11'])
  assert.deepEqual(periodMonths('next-month', today), ['2026-12'])
  assert.deepEqual(periodMonths('quarter', today), ['2026-10', '2026-11', '2026-12'])
  assert.deepEqual(periodMonths('next-quarter', today), ['2027-01', '2027-02', '2027-03'])
  assert.equal(periodMonths('year', today)[0], '2026-01')
  assert.equal(periodMonths('year', today)[11], '2026-12')
  assert.equal(periodMonths('12m', today)[0], '2026-11')
  assert.equal(periodMonths('12m', today)[11], '2027-10')
})
