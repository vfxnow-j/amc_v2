import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitCost, groupLineFunding, orderAssumption } from './funding'
import { FLOW_LEASE_ASSUMPTION, type UnitFunding } from '@/lib/pricing/lease-funding'
import { interestOver } from '@/lib/pricing/flow'

const f = (unitId: string, leaseId: string, balance: number, payment: number, extra: Partial<UnitFunding> = {}): UnitFunding => ({
  unitId, leaseId, leaseLabel: `L-${leaseId}`, share: 0, balance, payment, monthsLeft: 30, aprPct: 5.55, assumed: false, ...extra,
})

test('unit cost is landed cost, and an uncosted unit is zero (as flow-basis excludes it)', () => {
  assert.equal(unitCost({ purchasePrice: 1000, landedCostAdjustment: 42.5 }), 1042.5)
  assert.equal(unitCost({ purchasePrice: '1000', landedCostAdjustment: '-10' }), 990)
  assert.equal(unitCost({ purchasePrice: null, landedCostAdjustment: 50 }), 0)
  assert.equal(unitCost({ purchasePrice: 0, landedCostAdjustment: 50 }), 0)
})

test('assigned units: their own funding, grouped by lease', () => {
  const funding = new Map([
    ['u1', f('u1', 'A', 1000, 40)],
    ['u2', f('u2', 'A', 500, 20)],
    ['u3', f('u3', 'B', 300, 10, { aprPct: 8, monthsLeft: 12, assumed: true })],
  ])
  const r = groupLineFunding(
    [{ itemId: 'i1', assetId: 'X', quantity: 3, assignedUnitIds: ['u1', 'u2', 'u9'] }],
    funding, new Map(), 24,
  )
  const line = r.lines[0]
  assert.equal(line.units, 3)
  assert.equal(line.balance, 1500)
  assert.equal(line.payment, 60)
  assert.deepEqual(line.leases, [{ leaseId: 'A', label: 'L-A', assumed: false }])
  const expected = interestOver(1000, 5.55, 30, 24) + interestOver(500, 5.55, 30, 24)
  assert.ok(Math.abs(line.interestOverTerm - Math.round(expected * 100) / 100) < 0.005)
  assert.deepEqual(r.loans, [{ balance: 1500, aprPct: 5.55, monthsLeft: 30, label: 'L-A' }])
  assert.equal(r.assumedCount, 0)
})

test('no units assigned: each line unit carries the average over the asset\'s held units', () => {
  const funding = new Map([
    ['h1', f('h1', 'A', 900, 30)],
    ['h2', f('h2', 'B', 300, 12, { aprPct: 8, monthsLeft: 40, assumed: true })],
    // h3 is held and owned outright: no funding, pulls the average down
  ])
  const held = new Map([['X', ['h1', 'h2', 'h3']]])
  const r = groupLineFunding([{ itemId: 'i1', assetId: 'X', quantity: 2, assignedUnitIds: [] }], funding, held, 24)
  const line = r.lines[0]
  assert.equal(line.units, 2)
  assert.equal(line.balance, 800) // (900 + 300) / 3 × 2
  assert.equal(line.payment, 28) // (30 + 12) / 3 × 2
  assert.equal(r.loans.length, 2)
  assert.deepEqual(r.loans.find((l) => l.label === 'L-A'), { balance: 600, aprPct: 5.55, monthsLeft: 30, label: 'L-A' })
  assert.deepEqual(r.loans.find((l) => l.label === 'L-B'), { balance: 200, aprPct: 8, monthsLeft: 40, label: 'L-B' })
  assert.equal(r.assumedCount, 1) // ceil(2 × 1/3)
  const expected = (interestOver(900, 5.55, 30, 24) + interestOver(300, 8, 40, 24)) / 3 * 2
  assert.ok(Math.abs(line.interestOverTerm - expected) < 0.01)
})

test('partly assigned: assigned units as themselves, the rest over the unassigned pool only', () => {
  // h1 leased $1,000, h2 owned outright. h1 is assigned, so the remaining unit
  // averages over h2 alone: the line carries h1's $1,000 once, not $1,500.
  const funding = new Map([['h1', f('h1', 'A', 1000, 40)]])
  const held = new Map([['X', ['h1', 'h2']]])
  const r = groupLineFunding([{ itemId: 'i1', assetId: 'X', quantity: 2, assignedUnitIds: ['h1'] }], funding, held, 24)
  assert.equal(r.lines[0].units, 2)
  assert.equal(r.lines[0].balance, 1000)
  assert.equal(r.lines[0].payment, 40)
  assert.deepEqual(r.loans, [{ balance: 1000, aprPct: 5.55, monthsLeft: 30, label: 'L-A' }])
})

test('two lines sharing an asset: a unit assigned on one never feeds the other\'s average', () => {
  const funding = new Map([['h1', f('h1', 'A', 1000, 40)], ['h2', f('h2', 'A', 200, 8)], ['h3', f('h3', 'A', 100, 4)]])
  const held = new Map([['X', ['h1', 'h2', 'h3']]])
  const r = groupLineFunding([
    { itemId: 'a', assetId: 'X', quantity: 1, assignedUnitIds: ['h1'] },
    { itemId: 'b', assetId: 'X', quantity: 1, assignedUnitIds: [] },
  ], funding, held, 24)
  assert.equal(r.lines[0].balance, 1000)
  assert.equal(r.lines[1].balance, 150) // (200 + 100) / 2, h1 excluded
  assert.deepEqual(r.loans, [{ balance: 1150, aprPct: 5.55, monthsLeft: 30, label: 'L-A' }])
})

test('ordering more than the unassigned pool draws the pool\'s debt once, no more', () => {
  const funding = new Map([['h1', f('h1', 'A', 900, 30)], ['h2', f('h2', 'A', 600, 20)], ['h3', f('h3', 'B', 300, 10)]])
  const held = new Map([['X', ['h1', 'h2', 'h3']]])
  const r = groupLineFunding([{ itemId: 'i1', assetId: 'X', quantity: 5, assignedUnitIds: [] }], funding, held, 24)
  assert.equal(r.lines[0].units, 5)
  assert.equal(r.lines[0].balance, 1800) // the whole pool, not 5/3 of it (3000)
  assert.equal(r.lines[0].payment, 60)
  const total = r.loans.reduce((a, l) => a + l.balance, 0)
  assert.equal(total, 1800)
})

test('two lines of one asset totalling more than the pool together stay within it', () => {
  const funding = new Map([['h1', f('h1', 'A', 900, 30)], ['h2', f('h2', 'A', 600, 20)], ['h3', f('h3', 'B', 300, 10)]])
  const held = new Map([['X', ['h1', 'h2', 'h3']]])
  const r = groupLineFunding([
    { itemId: 'a', assetId: 'X', quantity: 2, assignedUnitIds: [] },
    { itemId: 'b', assetId: 'X', quantity: 2, assignedUnitIds: [] },
  ], funding, held, 24)
  assert.equal(r.lines[0].balance, 1200) // 2 of 3 pool units: 1800 × 2/3
  assert.equal(r.lines[1].balance, 600) // the last pool unit; its second unit is beyond the pool
  assert.ok(r.lines[0].balance + r.lines[1].balance <= 1800)
  assert.equal(r.loans.reduce((a, l) => a + l.balance, 0), 1800)
})

test('the same lease on two lines merges into one loan', () => {
  const funding = new Map([['u1', f('u1', 'A', 1000, 40)], ['u2', f('u2', 'A', 250.55, 10)]])
  const r = groupLineFunding([
    { itemId: 'i1', assetId: 'X', quantity: 1, assignedUnitIds: ['u1'] },
    { itemId: 'i2', assetId: 'Y', quantity: 1, assignedUnitIds: ['u2'] },
  ], funding, new Map(), 12)
  assert.deepEqual(r.loans, [{ balance: 1250.55, aprPct: 5.55, monthsLeft: 30, label: 'L-A' }])
})

test('owned outright, non-asset lines and no held units: no funding, no loans', () => {
  const r = groupLineFunding([
    { itemId: 'i1', assetId: 'X', quantity: 2, assignedUnitIds: [] },
    { itemId: 'i2', assetId: null, quantity: 1, assignedUnitIds: [] },
  ], new Map(), new Map(), 24)
  assert.deepEqual(r.loans, [])
  assert.equal(r.lines[0].balance, 0)
  assert.equal(r.lines[0].units, 2)
  assert.equal(r.lines[1].units, 1)
  assert.deepEqual(r.lines[1].leases, [])
})

test('a lease with nothing left to pay produces no loan', () => {
  const funding = new Map([['u1', f('u1', 'A', 0, 0, { monthsLeft: 0 })]])
  const r = groupLineFunding([{ itemId: 'i1', assetId: 'X', quantity: 1, assignedUnitIds: ['u1'] }], funding, new Map(), 24)
  assert.deepEqual(r.loans, [])
})

test('the order\'s assumption wins; otherwise the fallback', () => {
  assert.deepEqual(orderAssumption({ flowAssumedAprPct: '6.5', flowAssumedNoteMonths: 48 }), { aprPct: 6.5, noteMonths: 48 })
  assert.deepEqual(orderAssumption({ flowAssumedAprPct: null, flowAssumedNoteMonths: null }), FLOW_LEASE_ASSUMPTION)
  assert.deepEqual(orderAssumption({ flowAssumedAprPct: null, flowAssumedNoteMonths: 36 }, { aprPct: 7, noteMonths: 60 }), { aprPct: 7, noteMonths: 36 })
})
