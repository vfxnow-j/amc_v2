import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryFlowLine, matchFlowLines, type FlowCarryExisting } from './line-carry'

const existing: FlowCarryExisting[] = [
  { id: 'l1', assetId: 'a1', costBasis: '1200.00', trueCost: '1000.00', flowAddedAtMonth: null },
  { id: 'l2', assetId: 'a2', costBasis: '800.00', trueCost: '800.00', flowAddedAtMonth: 7 },
  { id: 'l3', assetId: 'a1', costBasis: '1000.00', trueCost: '1000.00', flowAddedAtMonth: null },
]

test('rows match by line id first, then the next unmatched line on the same asset', () => {
  const m = matchFlowLines([{ assetId: 'a1' }, { id: 'l3', assetId: 'a1' }, { assetId: 'a2' }, { assetId: 'a9' }], existing)
  assert.equal(m.get(1)?.id, 'l3')
  assert.equal(m.get(0)?.id, 'l1')
  assert.equal(m.get(2)?.id, 'l2')
  assert.equal(m.has(3), false)
})

test('a row that swaps its line\'s asset is a new line', () => {
  const m = matchFlowLines([{ id: 'l2', assetId: 'a9' }], existing)
  assert.equal(m.size, 0)
})

test('an omitted basis and co-term month carry forward (a raised basis is not reset)', () => {
  const r = carryFlowLine({ assetId: 'a2' }, existing[1], null, false)
  assert.deepEqual(r, { ok: true, costBasis: 800, trueCost: 800, flowAddedAtMonth: 7 })
  const raised = carryFlowLine({ assetId: 'a1' }, existing[0], 1000, false)
  assert.ok(raised.ok && raised.costBasis === 1200)
})

test('open order: a sent basis is honoured, floored at true cost', () => {
  const up = carryFlowLine({ assetId: 'a1', costBasis: 1500 }, existing[0], null, false)
  assert.ok(up.ok && up.costBasis === 1500)
  const under = carryFlowLine({ assetId: 'a1', costBasis: 10 }, existing[0], null, false)
  assert.ok(under.ok && under.costBasis === 1000)
})

test('locked order: a changed basis or co-term month on an existing line is refused', () => {
  assert.deepEqual(carryFlowLine({ assetId: 'a1', costBasis: 1500 }, existing[0], null, true), { ok: false, changed: 'cost basis' })
  assert.deepEqual(carryFlowLine({ assetId: 'a2', flowAddedAtMonth: 3 }, existing[1], null, true), { ok: false, changed: 'co-term months' })
  assert.deepEqual(carryFlowLine({ assetId: 'a2', flowAddedAtMonth: null }, existing[1], null, true), { ok: false, changed: 'co-term months' })
})

test('locked order: omitted or unchanged values pass, and a new line is free', () => {
  assert.ok(carryFlowLine({ assetId: 'a1' }, existing[0], null, true).ok)
  assert.ok(carryFlowLine({ assetId: 'a1', costBasis: 1200.001, flowAddedAtMonth: null }, existing[0], null, true).ok)
  const fresh = carryFlowLine({ assetId: 'a5', costBasis: 900, flowAddedAtMonth: 4 }, undefined, null, true)
  assert.deepEqual(fresh, { ok: true, costBasis: 900, trueCost: null, flowAddedAtMonth: 4 })
})
