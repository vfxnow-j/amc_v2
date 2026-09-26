import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowOrder, FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'
import type { OrderFunding } from './funding'
import {
  flowAgreementView,
  flowEconomicsView,
  flowScheduleRows,
  flowTermsLock,
  flowTermsView,
} from './record-view'

const start = new Date(Date.UTC(2026, 8, 26, 12))
const lines = [
  { itemId: 'a', name: 'RTX A6000', costBasis: 4262.5, trueCost: 4262.5, quantity: 2 },
  { itemId: 'b', name: 'DeckLink', costBasis: 1000, trueCost: 895, quantity: 1 },
]
const loan = { balance: 6956.88, aprPct: 7, monthsLeft: 58, label: 'FCB REFI 2024' }
const funding: OrderFunding = {
  loans: [loan],
  lines: [
    { itemId: 'a', units: 2, balance: 6956.88, payment: 141.73, interestOverTerm: 803.94, leases: [{ leaseId: 'l1', label: 'FCB REFI 2024', assumed: false }] },
    { itemId: 'b', units: 1, balance: 0, payment: 0, interestOverTerm: 0, leases: [] },
  ],
  assumedCount: 0,
}
const priced = (over: Partial<typeof FLOW_CONFIG_DEFAULTS> = {}) =>
  flowOrder(lines, { ...FLOW_CONFIG_DEFAULTS, termMonths: 24, monthsInService: 47, funding: [loan], ...over })

test('terms lock: closed, billed and agreed each say why; an open draft is null', () => {
  assert.equal(flowTermsLock({ status: 'DRAFT', flowPeriodsBilled: 0, flowTermsSnapshot: null }), null)
  assert.match(flowTermsLock({ status: 'CANCELLED', flowPeriodsBilled: 0, flowTermsSnapshot: null })!, /closed/)
  assert.match(flowTermsLock({ status: 'ACTIVE', flowPeriodsBilled: 1, flowTermsSnapshot: {} })!, /1 period has been billed/)
  assert.match(flowTermsLock({ status: 'APPROVED', flowPeriodsBilled: 0, flowTermsSnapshot: { acceptedAt: 'x' } })!, /agreed/)
})

test('terms view: current rate, the next step and its date, extension default', () => {
  const r = priced()
  const v = flowTermsView(r, { termMonths: 24, start, periodsBilled: 0, stepPct: null, extensionPct: null, defaultExtensionPct: 50, terms: null })
  assert.equal(v.currentMonth, 1)
  assert.equal(v.currentRate, r.schedule.rows[0].rate)
  assert.deepEqual(v.stepMonths, [13])
  assert.equal(v.next?.month, 13)
  assert.equal(v.next?.rate, r.schedule.rows[12].rate)
  assert.equal(v.next?.date.toISOString().slice(0, 10), '2027-09-26')
  assert.equal(v.end.toISOString().slice(0, 10), '2028-09-26')
  assert.equal(v.extensionPct, 50)
  assert.equal(v.extensionIsDefault, true)
  assert.equal(v.contractValue, r.contractValue)
})

test('terms view: past the last step there is no next rate, and an override extension wins', () => {
  const v = flowTermsView(priced(), { termMonths: 24, start, periodsBilled: 14, stepPct: null, extensionPct: 40, defaultExtensionPct: 50, terms: null })
  assert.equal(v.currentMonth, 15)
  assert.equal(v.next, null)
  assert.equal(v.extensionPct, 40)
  assert.equal(v.extensionIsDefault, false)
})

test('agreement: the autopay to-do shows only once approved and until it is set up', () => {
  const base = { flowTermsVersion: 3, flowTermsSnapshot: { acceptedAt: '2026-10-01T00:00:00.000Z' }, flowAutopayAuthorizedBy: 'Dana', flowAutopayMethod: 'ACH', flowAutopaySetupAt: null }
  assert.equal(flowAgreementView({ ...base, status: 'DRAFT' }).autopayTodo, false)
  const approved = flowAgreementView({ ...base, status: 'APPROVED' })
  assert.equal(approved.autopayTodo, true)
  assert.equal(approved.version, 3)
  assert.equal(approved.signer, 'Dana')
  assert.equal(approved.acceptedAt?.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.match(approved.autopayLabel, /ACH/)
  assert.equal(flowAgreementView({ ...base, status: 'ACTIVE', flowAutopaySetupAt: new Date() }).autopayTodo, false)
  assert.equal(flowAgreementView({ ...base, status: 'CANCELLED' }).autopayTodo, false)
})

test('schedule rows: dated from the start, step marked at 13, billed months flagged', () => {
  const s = flowScheduleRows(priced(), start, 2)
  assert.equal(s.feasible, true)
  assert.equal(s.rows.length, 24)
  assert.equal(s.rows[0].step, false)
  assert.equal(s.rows[12].step, true)
  assert.equal(s.rows.filter((r) => r.step).length, 1)
  assert.equal(s.rows[1].billed, true)
  assert.equal(s.rows[2].current, true)
  assert.equal(s.rows[23].date.toISOString().slice(0, 10), '2028-08-26')
})

test('schedule rows: an infeasible schedule shows none', () => {
  const bad = flowOrder([{ costBasis: 1000, quantity: 1, addedAtMonth: 40 }], { ...FLOW_CONFIG_DEFAULTS, termMonths: 24 })
  assert.equal(bad.feasible, false)
  assert.deepEqual(flowScheduleRows(bad, start, 0), { feasible: false, rows: [] })
})

test('economics: hardware rows join funding by line id, and the deal is the engine\'s', () => {
  const r = priced()
  const v = flowEconomicsView(lines, funding, r, { aprPct: 8, noteMonths: 60 })
  assert.equal(v.hardware.length, 2)
  assert.deepEqual(
    v.hardware.map((h) => [h.units, h.trueCost, h.leaseBalance, h.leasePayment, h.interestOverTerm, h.leases.map((l) => l.label)]),
    [[2, 8525, 6956.88, 141.73, 803.94, ['FCB REFI 2024']], [1, 895, 0, 0, 0, []]],
  )
  assert.equal(v.totals.trueCost, 9420)
  assert.equal(v.deal.hardware, 9420)
  assert.equal(v.deal.contract, r.quote.economics.contract)
  assert.equal(v.deal.financeGap, Math.round((v.deal.financeAllowance - v.deal.financeActual) * 100) / 100)
  assert.equal(v.deal.monthOneNet, Math.round((r.schedule.rows[0].rate - r.quote.cash.notePayment) * 100) / 100)
  assert.equal(v.deal.thinnestMonth, 13)
  assert.equal(v.deal.stillOwedAtTermEnd, r.quote.tail.balanceAtTermEnd)
  assert.equal(v.assumption, 'assumed 8% / 60 mo')
  assert.equal(v.assumedLines, 0)
})

test('economics: a line on a terms-missing lease is flagged assumed', () => {
  const assumed: OrderFunding = {
    ...funding,
    lines: [{ ...funding.lines[0], leases: [{ leaseId: 'l2', label: 'NO TERMS', assumed: true }] }, funding.lines[1]],
  }
  const v = flowEconomicsView(lines, assumed, priced(), { aprPct: 6.5, noteMonths: 48 })
  assert.equal(v.hardware[0].assumed, true)
  assert.equal(v.hardware[1].assumed, false)
  assert.equal(v.assumedLines, 1)
  assert.equal(v.assumption, 'assumed 6.5% / 48 mo')
})
