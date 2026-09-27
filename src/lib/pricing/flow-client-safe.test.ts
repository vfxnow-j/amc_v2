import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowQuotePayload, FLOW_QUOTE_UNAVAILABLE } from './flow-client-payload'
import { flowQuoteForOrder } from './flow-quote-view'
import { renderFlowTerms, FLOW_TERMS_DEFAULTS } from './flow-terms'
import { checkFlowApproval } from '@/lib/flow/approval'
import { flowScheduleHash } from './flow-schedule-hash'

/**
 * A Flow order the way the database hands it over: stored knobs, internal
 * money on the order (assumed note, economics inputs), and lines on gear that
 * sits on a lease, each carrying its cost basis, true cost and lease funding.
 * None of that may reach the client's quote.
 */
const order = {
  id: 'ord_1',
  reservationNumber: 'FLW-2026-00099',
  reservationType: 'FLOW',
  status: 'QUOTE_SENT',
  quoteExpiresAt: '2026-10-26T12:00:00.000Z',
  client: { name: 'Ada Client', companyName: 'Studio Co', creditLimit: 50000, internalNotes: 'x' },
  projectName: 'Show 1',
  startDate: '2026-10-01T12:00:00.000Z',
  flowStartDate: '2026-10-01T12:00:00.000Z',
  endDate: '2028-10-01T12:00:00.000Z',
  deliveryMethod: 'DELIVERY',
  deliveryAddress: '1 Lot St',
  notes: 'Client-facing note',
  flowTermMonths: 24,
  flowMarginPct: 40,
  flowFinancePct: 10,
  flowPurchaseTaxPct: 9.75,
  flowTaxExempt: true,
  flowRecoverByMonth: 12,
  flowDeprPct: 30,
  flowLifeMonths: 60,
  flowStepPct: null,
  flowAssumedAprPct: 8,
  flowAssumedLoanBalance: 12000,
  flowAssumedNoteMonths: 36,
  flowContractValue: 30000,
  flowMonthlyPayment: 1400,
}

const leasedGear = [
  {
    id: 'line_1',
    description: 'RTX 6000 Ada workstation',
    quantity: 2,
    parentId: null,
    costBasis: 9000,
    trueCost: 8500,
    rate: 13500,
    subtotal: 27000,
    flowAddedAtMonth: null,
    leaseId: 'lease_1',
    lease: { id: 'lease_1', aprPct: 7.9, balance: 14000, residualValue: 1000, monthsLeft: 30 },
    asset: {
      name: 'Workstation',
      purchasePrice: 8200,
      landedCostAdjustment: 300,
      category: { name: 'Workstations' },
      units: [{ id: 'u1' }],
    },
  },
  {
    id: 'line_2',
    description: null,
    quantity: 1,
    parentId: null,
    costBasis: 1200,
    trueCost: 1100,
    rate: 1800,
    subtotal: 1800,
    flowAddedAtMonth: null,
    leaseId: 'lease_2',
    lease: { id: 'lease_2', aprPct: 6.5, balance: 900, residualValue: 0, monthsLeft: 12 },
    asset: { name: 'Monitor', purchasePrice: 1100, category: { name: 'Displays' } },
  },
]

const extras = { discountAmount: 500, taxRate: 9.5, deliveryCost: 150, returnCost: 150 }

const FORBIDDEN = /cost|basis|trueCost|margin|finance|profit|lease|residual|economics|tail|hardware/i

/** Every key, at any depth, whose name matches — with the path to it. */
function forbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN.test(k) ? [`${path}.${k}`] : []),
      ...forbiddenKeys(v, `${path}.${k}`),
    ])
  }
  return []
}

function build() {
  const { quote, problem } = flowQuoteForOrder(order, leasedGear, extras)
  assert.equal(problem, undefined)
  const terms = renderFlowTerms(FLOW_TERMS_DEFAULTS, {
    termMonths: 24,
    startDate: order.flowStartDate,
    endDate: order.endDate,
    quote,
  })
  return { quote, terms, payload: flowQuotePayload({ order, lines: leasedGear, extras, terms, issuedAt: '2026-09-26T00:00:00.000Z', tokenExpiresAt: null }) }
}

test('the Flow client quote and its terms carry no internal key at any depth', () => {
  const { quote, terms } = build()
  assert.ok(quote.feasible)
  assert.deepEqual(forbiddenKeys(quote), [])
  assert.deepEqual(forbiddenKeys(terms), [])
})

test('the whole payload the quote page is sent carries no internal key at any depth', () => {
  const { payload } = build()
  assert.ok(!('error' in payload))
  assert.deepEqual(forbiddenKeys(payload), [])
})

test('the gear list is names and quantities, with no line rate or amount', () => {
  const { payload } = build()
  assert.ok(!('error' in payload))
  const items = payload.flowGear.flatMap((g) => g.items)
  assert.deepEqual(items.map((i) => [i.name, i.quantity]), [['Workstation', 2], ['Monitor', 1]])
  for (const item of items) {
    assert.ok(!('rate' in item) && !('subtotal' in item) && !('amount' in item))
  }
  assert.deepEqual(payload.itemsByCategory, [])
  assert.equal(payload.packages, undefined)
  assert.equal(payload.paymentLine, null)
})

test('nothing from the lease, the client record or the order internals rides along as a value', () => {
  const text = JSON.stringify(build().payload)
  for (const internal of ['lease_1', 'lease_2', 'creditLimit', 'internalNotes', 'purchasePrice', 'flowAssumed', 'u1']) {
    assert.ok(!text.includes(internal), `leaked ${internal}`)
  }
})

test('the payload totals are the schedule totals', () => {
  const { payload, quote } = build()
  assert.ok(!('error' in payload))
  assert.equal(payload.total, quote.totals.total)
  assert.equal(payload.subtotal, quote.totals.contract)
  assert.equal(payload.flow.rows.length, 24)
})

test('an order that cannot be priced, or has no terms, is not quoted', () => {
  const noTerm = flowQuotePayload({ order: { ...order, flowTermMonths: null }, lines: leasedGear, extras, terms: null, issuedAt: null, tokenExpiresAt: null })
  assert.deepEqual(noTerm, { error: FLOW_QUOTE_UNAVAILABLE })
  const unpriced = flowQuotePayload({
    order, lines: leasedGear.map((l) => ({ ...l, costBasis: null })), extras, terms: build().terms, issuedAt: null, tokenExpiresAt: null,
  })
  assert.deepEqual(unpriced, { error: FLOW_QUOTE_UNAVAILABLE })
  const { quote } = build()
  const noTerms = flowQuotePayload({ order, lines: leasedGear, extras, terms: null, issuedAt: null, tokenExpiresAt: null })
  assert.ok(quote.feasible)
  assert.deepEqual(noTerms, { error: FLOW_QUOTE_UNAVAILABLE })
})

test('approving a Flow quote requires ACH or card autopay, checked on the server', () => {
  const base = { signerName: 'Ada Client', activePackageId: null }
  assert.deepEqual(checkFlowApproval({ ...base }), {
    ok: false, error: 'Autopay authorization (ACH or card) is required to approve a Flow subscription.',
  })
  for (const bad of ['', 'ach', 'CASH', 'CHECK', 1, null, {}, ['ACH']]) {
    const r = checkFlowApproval({ ...base, autopayMethod: bad })
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(checkFlowApproval({ ...base, autopayMethod: 'ACH' }), { ok: true, signerName: 'Ada Client', autopayMethod: 'ACH' })
  assert.deepEqual(checkFlowApproval({ ...base, autopayMethod: 'CARD' }), { ok: true, signerName: 'Ada Client', autopayMethod: 'CARD' })
})

test('a Flow quote is approved as quoted: no quantity or option changes', () => {
  const ok = { signerName: 'Ada', autopayMethod: 'ACH', activePackageId: 'pkg_a' }
  assert.equal(checkFlowApproval({ ...ok, quantityChanges: [{ itemId: 'line_1', newQuantity: 3 }] }).ok, false)
  assert.equal(checkFlowApproval({ ...ok, quantityChanges: 'x' }).ok, false)
  assert.equal(checkFlowApproval({ ...ok, selectedPackageId: 'pkg_b' }).ok, false)
  assert.equal(checkFlowApproval({ ...ok, quantityChanges: [], selectedPackageId: 'pkg_a' }).ok, true)
  assert.equal(checkFlowApproval({ ...ok, quantityChanges: undefined, selectedPackageId: undefined }).ok, true)
})

test('the signer is named, and the name is trimmed', () => {
  assert.equal(checkFlowApproval({ signerName: '   ', autopayMethod: 'ACH' }).ok, false)
  assert.equal(checkFlowApproval({ signerName: 42, autopayMethod: 'ACH' }).ok, false)
  assert.equal(checkFlowApproval({ signerName: 'x'.repeat(201), autopayMethod: 'ACH' }).ok, false)
  assert.equal(checkFlowApproval({ signerName: 'x'.repeat(200), autopayMethod: 'ACH' }).ok, true)
  const r = checkFlowApproval({ signerName: '  Ada Client ', autopayMethod: 'CARD' })
  assert.ok(r.ok && r.signerName === 'Ada Client')
})

test('a Flow approval is refused when the terms moved on after the client saw them', () => {
  const base = { signerName: 'Ada Client', autopayMethod: 'ACH' as const }
  // No currentTermsVersion supplied (an older caller, or a test that isn't
  // exercising this rule) — the check is skipped, not failed closed.
  assert.equal(checkFlowApproval({ ...base }).ok, true)

  // The version the client's page displayed still matches what the server
  // would render now — approval proceeds.
  const matched = checkFlowApproval({ ...base, displayedTermsVersion: 3, currentTermsVersion: 3 })
  assert.equal(matched.ok, true)

  // Staff edited the terms between the client opening the quote and signing —
  // the version has moved on. Refused with a message that tells them to reload.
  const stale = checkFlowApproval({ ...base, displayedTermsVersion: 2, currentTermsVersion: 3 })
  assert.deepEqual(stale, {
    ok: false,
    error: 'These terms were updated — please reload the quote to review them.',
  })

  // Never trust the shape of what the browser sent: only a real integer counts
  // as a version the client could have actually seen.
  for (const bad of ['3', 3.5, null, undefined, {}, [3]]) {
    const r = checkFlowApproval({ ...base, displayedTermsVersion: bad, currentTermsVersion: 3 })
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)} as a version`)
  }
})

test('the payload carries the fingerprint of the schedule it shows', () => {
  const { payload, quote, terms } = build()
  assert.ok(!('error' in payload))
  assert.equal(payload.flowScheduleHash, flowScheduleHash(quote, terms.extension))
  assert.match(payload.flowScheduleHash, /^[0-9a-f]{64}$/)
})

test("a cloud host's hidden config rows are not listed in the gear", () => {
  const withCloud = [
    ...leasedGear,
    { ...leasedGear[1], id: 'cfg_1', parentId: 'line_1', cloudProductId: 'cp_1', description: 'Hidden vCPU row' },
    { ...leasedGear[1], id: 'part_1', parentId: 'line_1', cloudProductId: null, description: 'Visible component' },
  ]
  const { terms } = build()
  const payload = flowQuotePayload({ order, lines: withCloud, extras, terms, issuedAt: null, tokenExpiresAt: null })
  assert.ok(!('error' in payload))
  const ids = payload.flowGear.flatMap((g) => g.items.map((i) => i.id))
  assert.ok(!ids.includes('cfg_1'))
  assert.ok(ids.includes('part_1'))
})
