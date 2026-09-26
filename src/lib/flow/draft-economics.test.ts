import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFlowDraftEconomics, type FlowDraftResolvedLine } from './draft-economics'
import { FLOW_DEFAULTS_FALLBACK, type FlowPricingDefaults } from './defaults'
import type { OrderFunding } from './funding'
import { flowOrder, FLOW_CONFIG_DEFAULTS } from '@/lib/pricing/flow-order'
import type { FlowBasis } from '@/lib/pricing/flow-basis'

/**
 * computeFlowDraftEconomics is the pure half of flowDraftEconomics (the builder's
 * staff-only Flow preview): given a term, knobs, lines and their already-loaded
 * bases/funding, it prices the draft with no Prisma and no clock. Each test builds
 * its own bases/funding by hand — no database — and checks the result against
 * flowOrder called directly (already covered by flow-order.test.ts), which serves
 * as ground truth for the wiring under test here.
 */

const TERM = 24

function basis(overrides: Partial<FlowBasis> = {}): FlowBasis {
  return {
    basis: 5000,
    costedUnits: 1,
    consideredUnits: 1,
    monthsInService: 0,
    undatedUnits: 0,
    incomplete: false,
    ...overrides,
  }
}

const NO_FUNDING: OrderFunding = {
  loans: [],
  lines: [{ itemId: 'draft-0', units: 1, balance: 0, payment: 0, interestOverTerm: 0, leases: [] }],
  assumedCount: 0,
}

const LEASED_FUNDING: OrderFunding = {
  loans: [{ balance: 2000, aprPct: 6, monthsLeft: 20, label: 'Lease-1' }],
  lines: [{
    itemId: 'draft-0',
    units: 1,
    balance: 2000,
    payment: 88.61,
    interestOverTerm: 234.5,
    leases: [{ leaseId: 'lease-1', label: 'Lease-1', assumed: false }],
  }],
  assumedCount: 0,
}

const ONE_LINE: FlowDraftResolvedLine[] = [{ assetId: 'A', quantity: 1, costBasis: null }]
const ONE_BASIS = { A: basis() }

test('owned-only draft: no lease balance, and month one is the schedule rate — no lease payment to subtract', () => {
  const result = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, NO_FUNDING, FLOW_DEFAULTS_FALLBACK)
  assert.ok(result)
  assert.equal(result!.leaseBalance, 0)

  const ground = flowOrder([{ costBasis: 5000, trueCost: 5000, quantity: 1 }], { ...FLOW_CONFIG_DEFAULTS, termMonths: TERM })
  assert.equal(result!.monthlyNet, ground.quote.cash.netByMonth[0])
  assert.equal(result!.hardware, ground.quote.economics.hardware)
})

test('a leased asset: leaseBalance and monthlyNet reflect the pool funding', () => {
  const owned = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, NO_FUNDING, FLOW_DEFAULTS_FALLBACK)
  const leased = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, LEASED_FUNDING, FLOW_DEFAULTS_FALLBACK)
  assert.ok(owned)
  assert.ok(leased)

  // The panel's lease balance is the funding's own line balances, summed.
  assert.equal(leased!.leaseBalance, 2000)
  assert.equal(leased!.assumedUnits, 0)

  // Ground truth: the same lines and config, priced with the real loan.
  const ground = flowOrder([{ costBasis: 5000, trueCost: 5000, quantity: 1 }], {
    ...FLOW_CONFIG_DEFAULTS,
    termMonths: TERM,
    funding: LEASED_FUNDING.loans,
  })
  assert.equal(leased!.monthlyNet, ground.quote.cash.netByMonth[0])
  // Owning outright leaves more month-one cash than paying down a lease on the gear.
  assert.ok(leased!.monthlyNet < owned!.monthlyNet)
})

test("funding never changes the client's price — only the cash panel moves", () => {
  const owned = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, NO_FUNDING, FLOW_DEFAULTS_FALLBACK)
  const leased = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, LEASED_FUNDING, FLOW_DEFAULTS_FALLBACK)
  assert.ok(owned)
  assert.ok(leased)

  // Hardware is read off the lines' true cost alone, never off funding.
  assert.equal(owned!.hardware, leased!.hardware)

  // The literal client-facing figures — contract value and the schedule's rate —
  // come from buildFlowSchedule/chain, which never sees config.funding at all.
  const items = [{ costBasis: 5000, trueCost: 5000, quantity: 1 }]
  const ownedOrder = flowOrder(items, { ...FLOW_CONFIG_DEFAULTS, termMonths: TERM, funding: null })
  const leasedOrder = flowOrder(items, { ...FLOW_CONFIG_DEFAULTS, termMonths: TERM, funding: LEASED_FUNDING.loans })
  assert.equal(ownedOrder.contractValue, leasedOrder.contractValue)
  assert.equal(ownedOrder.rateForMonth(1), leasedOrder.rateForMonth(1))
})

test('blank knobs resolve to the defaults passed in, not the engine fallback', () => {
  const customDefaults: FlowPricingDefaults = {
    marginPct: 55,
    financePct: 15,
    purchaseTaxPct: 5,
    taxExempt: false,
    recoverByMonth: 6,
    deprPct: 20,
    lifeMonths: 36,
    assumedAprPct: 9,
  }
  const result = computeFlowDraftEconomics(TERM, {}, ONE_LINE, ONE_BASIS, NO_FUNDING, customDefaults)
  assert.ok(result)

  const expectedConfig = {
    ...FLOW_CONFIG_DEFAULTS,
    termMonths: TERM,
    marginPct: customDefaults.marginPct,
    financePct: customDefaults.financePct,
    purchaseTaxPct: customDefaults.purchaseTaxPct,
    taxExempt: customDefaults.taxExempt,
    recoverByMonth: customDefaults.recoverByMonth,
    deprPct: customDefaults.deprPct,
    lifeMonths: customDefaults.lifeMonths,
  }
  const ground = flowOrder([{ costBasis: 5000, trueCost: 5000, quantity: 1 }], expectedConfig)
  assert.equal(result!.profit, ground.quote.economics.profit)
  assert.equal(result!.marginOnContract, ground.quote.economics.marginOnContract)
  assert.equal(result!.monthlyNet, ground.quote.cash.netByMonth[0])

  // A knob the draft DID set is never overridden by the defaults.
  const overridden = computeFlowDraftEconomics(TERM, { marginPct: 20 }, ONE_LINE, ONE_BASIS, NO_FUNDING, customDefaults)
  assert.ok(overridden)
  assert.notEqual(overridden!.profit, result!.profit)
})

test('a line whose landed cost is incomplete cannot be priced as Flow', () => {
  const result = computeFlowDraftEconomics(
    TERM, {}, ONE_LINE, { A: basis({ incomplete: true }) }, NO_FUNDING, FLOW_DEFAULTS_FALLBACK,
  )
  assert.equal(result, null)
})
