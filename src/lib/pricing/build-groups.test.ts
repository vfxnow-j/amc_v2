import test from 'node:test'
import assert from 'node:assert/strict'
import {
  arrangeBuildGroups,
  groupIdsOf,
  groupRollup,
  isCheckoutLine,
  perMachineQty,
  rescaledPartQuantity,
  specLabel,
  storedPartQuantity,
  supportsBuilds,
} from './build-groups'
import { computeReservationFinancials } from './financials'

test('parts are stored multiplied by the machine count and read back per machine', () => {
  assert.equal(storedPartQuantity(4, 2), 8)
  assert.equal(storedPartQuantity(0, 0), 1)
  assert.equal(perMachineQty({ quantity: 8 }, { quantity: 2 }), 4)
  // an uneven part was edited by hand: shown as stored, not rounded
  assert.equal(perMachineQty({ quantity: 7 }, { quantity: 2 }), 7)
})

test('changing the machine count rescales the parts in proportion', () => {
  assert.equal(rescaledPartQuantity(8, 2, 3), 12)
  assert.equal(rescaledPartQuantity(2, 2, 1), 1)
  assert.equal(rescaledPartQuantity(1, 4, 1), 1) // never below one
})

test('group rollup does not double count', () => {
  // 2 machines; parts per machine: 4 x $100 + 1 x $500 = $900 -> stored amounts 800 + 1000
  assert.deepEqual(groupRollup([800, 1000], 2), { amount: 1800, rate: 900 })
})

test('checkout lines: stock only, not headings, services, manual lines or ordinary components', () => {
  const items = [
    { id: 'g', isGroup: true },
    { id: 'a', parentId: 'g', assetId: 'x' },
    { id: 'm', parentId: 'g', assetId: null },
    { id: 's', assetId: 'y', serviceId: 'svc' },
    { id: 'ws', assetId: 'z' },
    { id: 'ram', parentId: 'ws', assetId: 'r' },
  ]
  const ids = groupIdsOf(items)
  assert.deepEqual(items.map((i) => isCheckoutLine(i, ids)), [false, true, false, false, true, false])
})

test('arrange: orders without groups are untouched', () => {
  const items = [{ id: 'a' }, { id: 'b', parentId: 'a' }]
  const out = arrangeBuildGroups(items, [10, 5])
  assert.deepEqual(out.map((l) => [l.item.id, l.amount, l.isGroup, l.isGroupPart]), [['a', 10, false, false], ['b', 5, false, false]])
})

test('arrange: parts follow their group, group shows the rolled-up total, nothing counted twice', () => {
  // parts were added after the second group, so storage order interleaves
  const items = [
    { id: 'g1', isGroup: true, quantity: 2 },
    { id: 'g2', isGroup: true, quantity: 1 },
    { id: 'x' },
    { id: 'p1', parentId: 'g1' },
    { id: 'p2', parentId: 'g2' },
    { id: 'p3', parentId: 'g1' },
  ]
  const amounts = [0, 0, 7, 800, 300, 1000]
  const out = arrangeBuildGroups(items, amounts)
  assert.deepEqual(out.map((l) => l.item.id), ['g1', 'p1', 'p3', 'g2', 'p2', 'x'])
  assert.deepEqual(out.map((l) => l.amount), [1800, 800, 1000, 300, 300, 7])
  assert.equal(out[0].rate, 900)
  assert.equal(out[1].category, 'Custom Builds')
  // the order total is summed from the raw amounts, which never include the display rollup
  assert.equal(amounts.reduce((a, b) => a + b, 0), 2107)
})

test('arrange: hidden part prices are zeroed but the group keeps its total', () => {
  const items = [
    { id: 'g', isGroup: true, quantity: 2 },
    { id: 'a', parentId: 'g', quantity: 8 },
    { id: 'b', parentId: 'g', quantity: 2 },
  ]
  const out = arrangeBuildGroups(items, [0, 800, 1000], { hidePartPrices: true })
  assert.deepEqual(out.map((l) => [l.amount, l.rate]), [[1800, 900], [0, 0], [0, 0]])
  assert.deepEqual(out.map((l) => l.perMachineQty), [undefined, 4, 1])
  assert.equal(specLabel('32GB DDR5', 4), '4× 32GB DDR5')
  assert.equal(specLabel('CPU', 1), 'CPU')
})

test('movedWithin swaps a step, stops at the ends and ignores strangers', async () => {
  const { movedWithin } = await import('./build-groups')
  assert.deepEqual(movedWithin(['a', 'b', 'c'], 'b', 'up'), ['b', 'a', 'c'])
  assert.deepEqual(movedWithin(['a', 'b', 'c'], 'b', 'down'), ['a', 'c', 'b'])
  assert.equal(movedWithin(['a', 'b', 'c'], 'a', 'up'), null)
  assert.equal(movedWithin(['a', 'b', 'c'], 'c', 'down'), null)
  assert.equal(movedWithin(['a', 'b'], 'z', 'up'), null)
})

test('build structure is editable on a draft or a revision only', async () => {
  const { buildStructureEditable, BUILD_EDITABLE_STATUSES, BUILD_LOCKED_MESSAGE } = await import('./build-groups')
  assert.deepEqual(BUILD_EDITABLE_STATUSES, ['DRAFT', 'REVISION'])
  assert.equal(buildStructureEditable('DRAFT'), true)
  assert.equal(buildStructureEditable('REVISION'), true)
  for (const s of ['QUOTE_SENT', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'LOST']) {
    assert.equal(buildStructureEditable(s), false, s)
  }
  assert.match(BUILD_LOCKED_MESSAGE, /Request a revision/)
})

test('a client change request or a staff revision lands in REVISION, which reopens editing', async () => {
  const { buildStructureEditable } = await import('./build-groups')
  // Sent quote locked -> revision (either path) unlocked -> re-sent locked again.
  assert.deepEqual(['QUOTE_SENT', 'REVISION', 'QUOTE_SENT'].map(buildStructureEditable), [false, true, false])
})

test('sales and rentals take builds; the other order types do not', () => {
  assert.equal(supportsBuilds('SALE'), true)
  assert.equal(supportsBuilds('RENTAL'), true)
  for (const t of ['RENT_TO_OWN', 'CLOUD', 'FLOW', null, undefined]) assert.equal(supportsBuilds(t), false)
})

test('a rental build prices its parts over the term and the group adds nothing', () => {
  const order = { startDate: '2026-11-01', endDate: '2026-11-08' } // 8 billable days, end date inclusive
  const group = { id: 'g', isGroup: true, rate: 0, quantity: 4, pricingType: 'PROJECT', isOneTime: true }
  const gpu = { id: 'a', parentId: 'g', rate: 10, quantity: 8, pricingType: 'DAILY', isOneTime: false } // 2 per node
  const setup = { id: 'b', parentId: 'g', rate: 50, quantity: 4, pricingType: 'PROJECT', isOneTime: true }
  const fin = computeReservationFinancials({ order, items: [group, gpu, setup] })
  assert.deepEqual(fin.itemAmounts, [0, 640, 200])
  assert.equal(fin.itemsSubtotal, 840)
  const lines = arrangeBuildGroups([group, gpu, setup], fin.itemAmounts)
  assert.equal(lines[0].amount, 840)
  assert.equal(lines[0].rate, 210) // one node over the whole term
})
