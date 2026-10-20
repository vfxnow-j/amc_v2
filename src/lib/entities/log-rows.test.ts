import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctsText, toLogRows } from '@/components/entities/inventory/log-rows'

const base = {
  quantity: 1, correctsId: null, finalToOwner: false, fromLocationId: null, toLocationId: null, actorUserId: 'u',
  recipient: null, destination: null, reference: null, carrier: null, tracking: null, notes: null,
  item: { name: 'Mac Studio' }, unit: { serial: 'S1', ownerTag: null }, unitId: 'x',
}

test('toLogRows carries correctsId and correctsText names the original or falls back', () => {
  const rows = toLogRows(
    [
      { ...base, id: 'm1', type: 'MOVE', occurredAt: new Date('2026-03-04T15:00:00Z') },
      { ...base, id: 'm2', type: 'MOVE', correctsId: 'm1', occurredAt: new Date('2026-03-05T15:00:00Z') },
      { ...base, id: 'm3', type: 'MOVE', correctsId: 'gone', occurredAt: new Date('2026-03-06T15:00:00Z') },
    ],
    new Map(), new Map(),
  )
  assert.equal(rows[0].correctsId, null)
  assert.equal(rows[1].correctsId, 'm1')
  const byId = new Map(rows.map((r) => [r.id, r]))
  assert.match(correctsText(byId.get('m1')), /^Corrects the move of Mac Studio · S1 on Mar 4, 2026/)
  assert.equal(correctsText(byId.get('gone')), 'Corrects an older entry')
})
