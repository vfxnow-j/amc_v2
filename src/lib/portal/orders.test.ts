import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  customerStatus,
  orderableProblem,
  orderRequestHash,
  parseIdempotencyKey,
  parseOrderRequest,
  repriceProblem,
  reservationInputFromRate,
  type StoredRate,
} from './orders-core'
import { formatPortalOrderNumber, highestSequence } from './order-number'
import { decodeCursor, encodeCursor, parseLimit } from './paging'
import type { QuoteLine } from './quote'

const line = (over: Partial<QuoteLine> = {}): QuoteLine => ({
  offer_id: 'off_ws', solution: 'rental', term_months: null, qty: 2, unit_price: 400, line_total: 2400, one_time: 0,
  demand: 'normal', allowed: true, reason: null, ...over,
})

const rentalRate: StoredRate = {
  request: { window: { start: '2026-10-01T12:00:00.000Z', end: '2026-12-31T12:00:00.000Z' }, lines: [{ offer_id: 'off_ws', qty: 2, solution: 'rental', term_months: null }] },
  lines: {
    tier: 'standard',
    client: [line()],
    internal: [{
      offerId: 'off_ws', solution: 'rental', term: null, qty: 2, unitPrice: 400, lineTotal: 2400,
      components: [
        { assetId: 'a_ws', serviceId: null, name: 'Workstation', quantity: 1, rate: 400, pricingType: 'MONTHLY', isOneTime: false, periods: 3, subtotal: 2400 },
        { assetId: null, serviceId: 'svc', name: 'Setup', quantity: 1, rate: 150, pricingType: 'PROJECT', isOneTime: true, periods: 1, subtotal: 300 },
      ],
    }],
  },
}

test('an order body is exactly a rate: dates, lines and prices are refused', () => {
  const ok = parseOrderRequest({ rate_id: 'r1', account_id: 'acct-1', site_id: 'site-uuid', po_number: ' PO-7 ' })
  assert.deepEqual(ok, { ok: true, value: { rateId: 'r1', accountId: 'acct-1', siteId: 'site-uuid', poNumber: 'PO-7', notes: null } })
  for (const bad of [
    { rate_id: 'r1', account_id: 'a', site_id: 's', total: 1 },
    { rate_id: 'r1', account_id: 'a', site_id: 's', lines: [] },
    { rate_id: 'r1', account_id: 'a', site_id: 's', window: {} },
    { rate_id: { $ne: 1 }, account_id: 'a', site_id: 's' },
    { rate_id: 'r1', account_id: 'a' },
    { rate_id: 'r1', account_id: 'a', site_id: 's', po_number: 'x'.repeat(61) },
    [],
    null,
  ]) assert.equal(parseOrderRequest(bad).ok, false, JSON.stringify(bad))
})

test('idempotency keys and the request hash', () => {
  assert.equal(parseIdempotencyKey(' 3f2a-quote_9 '), '3f2a-quote_9')
  assert.equal(parseIdempotencyKey(null), null)
  assert.equal(parseIdempotencyKey('has space'), null)
  const a = { rateId: 'r', accountId: 'a', siteId: 's', poNumber: null, notes: null }
  assert.equal(orderRequestHash(a), orderRequestHash({ ...a }))
  assert.notEqual(orderRequestHash(a), orderRequestHash({ ...a, siteId: 't' }))
})

test('orderable: every line allowed, one solution, one Flow term', () => {
  assert.equal(orderableProblem(rentalRate), null)
  const refused = { ...rentalRate, lines: { ...rentalRate.lines, client: [line(), line({ allowed: false, reason: 'insufficient_capacity' })] } }
  assert.equal(orderableProblem(refused)?.code, 'conflict')
  const mixed = { ...rentalRate, lines: { ...rentalRate.lines, client: [line(), line({ solution: 'sale' })] } }
  assert.match(orderableProblem(mixed)!.message, /one solution/)
  const terms = { ...rentalRate, lines: { ...rentalRate.lines, client: [line({ solution: 'flow', term_months: 24 }), line({ solution: 'flow', term_months: 36 })] } }
  assert.match(orderableProblem(terms)!.message, /one term/)
})

test('re-price: gone stock is a conflict, a moved price a mismatch, the same price passes', () => {
  assert.equal(repriceProblem([line()], [line()]), null)
  assert.equal(repriceProblem([line()], [line({ allowed: false, reason: 'insufficient_capacity' })])?.code, 'conflict')
  assert.equal(repriceProblem([line()], [line({ allowed: false, reason: 'verification_required' })])?.code, 'conflict')
  assert.equal(repriceProblem([line()], [line({ line_total: 2400.5 })])?.code, 'rate_mismatch')
  assert.equal(repriceProblem([line()], [line({ line_total: 2400.004 })]), null)
})

test('a rental rate becomes a rental order with the snapshot rates, quantities scaled by the line', () => {
  const input = reservationInputFromRate(rentalRate, { clientId: 'c1', site: { label: 'Burbank', address: '1 Main' }, poNumber: 'PO-7', notes: null, orderRef: 'q-1' })
  assert.equal(input.reservationType, 'RENTAL')
  assert.equal(input.startDate.toISOString(), '2026-10-01T12:00:00.000Z')
  assert.equal(input.endDate.toISOString(), '2026-12-31T12:00:00.000Z')
  assert.deepEqual(input.items.map((i) => [i.assetId, i.serviceId, i.rate, i.pricingType, i.isOneTime, i.quantity]), [
    ['a_ws', null, 400, 'MONTHLY', false, 2],
    [null, 'svc', 150, 'PROJECT', true, 2],
  ])
  assert.equal(input.deliveryAddress, '1 Main')
  assert.match(input.internalNotes!, /client portal \(quote q-1\).*Burbank.*PO-7/)
})

test('a sale rate becomes a sale; a Flow rate carries its term, knobs and assets', () => {
  const sale = reservationInputFromRate(
    { ...rentalRate, lines: { ...rentalRate.lines, client: [line({ solution: 'sale' })] } },
    { clientId: 'c1', site: { label: 'S', address: null }, poNumber: null, notes: null, orderRef: 'q' },
  )
  assert.equal(sale.reservationType, 'SALE')
  const flowRate: StoredRate = {
    request: { window: { start: '2026-10-01T12:00:00.000Z', end: null }, lines: [{ offer_id: 'off_ws', qty: 3, solution: 'flow', term_months: 24 }] },
    lines: {
      tier: 'standard',
      client: [line({ solution: 'flow', term_months: 24, qty: 3 })],
      internal: [{ offerId: 'off_ws', solution: 'flow', term: 24, qty: 3, unitPrice: 300, lineTotal: 21600,
        flow: { knobs: { flowTermMonths: 24, flowMarginPct: 30, flowFinancePct: 8, flowStepPct: null }, lines: [{ assetId: 'a_ws', name: 'WS', costBasis: 6000, trueCost: 6000, quantity: 3 }], month1: 900, contractValue: 21600 } }],
    },
  }
  const flow = reservationInputFromRate(flowRate, { clientId: 'c1', site: { label: 'S', address: null }, poNumber: null, notes: null, orderRef: 'q' })
  assert.equal(flow.reservationType, 'FLOW')
  assert.equal(flow.flowTermMonths, 24)
  assert.equal(flow.flowMarginPct, 30)
  assert.equal(flow.flowStepPct, null)
  assert.deepEqual(flow.items.map((i) => [i.assetId, i.quantity, i.pricingType]), [['a_ws', 3, 'MONTHLY']])
})

test('customer statuses', () => {
  assert.equal(customerStatus('DRAFT'), 'pending_review')
  assert.equal(customerStatus('QUOTE_SENT'), 'pending_review')
  assert.equal(customerStatus('APPROVED'), 'approved')
  assert.equal(customerStatus('SHIPPED'), 'shipped')
  assert.equal(customerStatus('LOST'), 'cancelled')
})

test('PRT numbers: per year, never reusing one, ignoring other series', () => {
  assert.equal(formatPortalOrderNumber(2026, 7), 'PRT-2026-00007')
  assert.equal(highestSequence(['PRT-2026-00003', 'PRT-2026-00011', 'PRT-2025-00099', 'RES-2026-00500', 'PRT-2026-x'], 2026), 11)
  assert.equal(highestSequence([], 2026), 0)
})

test('cursors round-trip; junk is refused; limits', () => {
  const c = { at: new Date('2026-10-01T10:00:00.000Z'), id: 'res_1' }
  assert.deepEqual(decodeCursor(encodeCursor(c)), c)
  assert.equal(decodeCursor('not-a-cursor'), null)
  assert.equal(parseLimit(null), 50)
  assert.equal(parseLimit('200'), 200)
  assert.equal(parseLimit('0'), null)
  assert.equal(parseLimit('2e2'), null)
})
