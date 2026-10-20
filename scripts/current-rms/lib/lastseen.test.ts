import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastSeen } from './lastseen'
import type { Opp, OppLine } from './sales'

const O = (id: number, starts: string, o: Partial<Opp> = {}): Opp => ({ id, number: `000${id}`, subject: '', memberId: id, starts, ends: null, state: 'Order', status: 'Completed', text: '', saleTotal: 0, ...o })
const R = (id: number, oppId: number, status: string, qtyReturned = 0): OppLine => ({ id, oppId, name: 'P620', description: '', txnType: 'Rental', lineType: 'Principal', qty: 1, price: 0, assets: [{ stockId: 1, status, qtySold: 0, qtyReturned }] })
const units = [{ stockId: 1, barcode: '006001', assetName: 'P620', itemName: 'P620' }]

test('latest rental wins; returned vs still booked out', () => {
  const s = lastSeen([R(1, 10, 'Completed', 1), R(2, 11, 'Booked Out')], [O(10, '2022-01-01'), O(11, '2023-05-01')], units).get('006001')!
  assert.equal(s.number, '00011')
  assert.equal(s.returned, false)
  assert.equal(s.orders, 2)
})

test('cancelled orders and sale lines are ignored', () => {
  const lines = [R(1, 10, 'Completed', 1), R(2, 11, 'Booked Out'), { ...R(3, 12, 'Completed'), txnType: 'Sale' }]
  const s = lastSeen(lines, [O(10, '2022-01-01'), O(11, '2023-05-01', { status: 'Cancelled' }), O(12, '2024-01-01')], units).get('006001')!
  assert.equal(s.number, '00010')
  assert.equal(s.returned, true)
})
