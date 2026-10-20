import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barcodeTokens, findSales, type Opp, type OppLine } from './sales'

const O = (id: number, o: Partial<Opp> = {}): Opp => ({ id, number: `000${id}`, subject: '', memberId: 7, starts: '2022-05-01', ends: null, state: 'Order', status: 'Completed', text: '', saleTotal: 900, ...o })
const L = (id: number, oppId: number, name: string, o: Partial<OppLine> = {}): OppLine => ({ id, oppId, name, description: '', txnType: 'Sale', lineType: 'Principal', qty: 1, price: 900, assets: [], ...o })
const units = [
  { stockId: 1, barcode: '005001', assetName: 'GeForce RTX 3080 Ti', itemName: 'PNY RTX 3080 Ti' },
  { stockId: 2, barcode: '005002', assetName: 'Lenovo ThinkStation P620 3975WX 32C', itemName: 'Lenovo P620' },
  { stockId: 3, barcode: '005003', assetName: 'GeForce RTX 3080 Ti', itemName: 'PNY RTX 3080 Ti' },
]
const amc = [...units.map((u) => ({ barcode: u.barcode, assetName: u.assetName, bucket: 'ACTIVE AVAILABLE' })), { barcode: '005166', assetName: 'Alienware m15', bucket: 'RETIRED Not in warehouse' }]

test('barcode tokens: AID/#/6-digit/VFX, not bare model numbers', () => {
  assert.deepEqual(barcodeTokens('1x Alienware m15 Sale (AID: 005166)'), ['005166'])
  assert.deepEqual(barcodeTokens('asset #4440 and VFX0051'), ['004440', 'VFX0051'])
  assert.deepEqual(barcodeTokens('RTX 4090 and 5950X build'), [])
})

test('staff-entered Sell takes buyer + price from the one sale order near the date naming the model', () => {
  const r = findSales({ sells: [{ stockId: 1, date: '2022-05-03', sourceType: 'Member', sourceId: 99, by: 'Felix Fissel' }], opps: [O(10)], lines: [L(100, 10, '3080Ti 12GB')], stockUnits: units, amc })
  const e = r.evidence.get('005001')!
  assert.equal(e.kind, 'sell_txn')
  assert.equal(e.buyerId, 7) // the order's client, not the staff member
  assert.equal(e.price, 900)
  assert.match(e.reasons[0], /entered by Felix Fissel/)
  assert.equal(r.holes.length, 0)
})

test('staff-entered Sell with several fitting orders assigns no buyer', () => {
  const r = findSales({ sells: [{ stockId: 1, date: '2022-05-03', sourceType: 'Member', sourceId: 99 }], opps: [O(10), O(11, { memberId: 8 })],
    lines: [L(100, 10, 'RTX 3080 Ti'), L(110, 11, 'RTX 3080 Ti')], stockUnits: units, amc })
  const e = r.evidence.get('005001')!
  assert.equal(e.buyerId, null)
  assert.equal(e.price, null)
  assert.match(e.reasons[1], /fits 2 sale orders/)
})

test('rental orders listing barcodes are not sales; cheap accessory lines are not buyouts', () => {
  const r = findSales({ sells: [], stockUnits: units, amc,
    opps: [O(20, { subject: '8x HP Z6 rental', text: '8x HP Z6 rental 005001', saleTotal: 0 }), O(21, { starts: '2022-06-01' }), O(22, { starts: '2022-01-01', saleTotal: 0 })],
    lines: [L(210, 21, 'P620 drive carrier', { price: 15 }), L(220, 22, 'Lenovo P620', { txnType: 'Rental', assets: [{ stockId: 2, status: 'Booked Out', qtySold: 0 }] })] })
  assert.equal(r.evidence.has('005001'), false)
  assert.equal(r.evidence.has('005002'), false)
})

test('buyout: unassetted sale line takes the unit from the client\'s open rental', () => {
  const r = findSales({
    sells: [], stockUnits: units, amc,
    opps: [O(10, { starts: '2022-06-01' }), O(11, { starts: '2022-01-01', ends: null })],
    lines: [L(100, 10, 'Lenovo P620 Buyout'), L(101, 11, 'Lenovo P620', { txnType: 'Rental', assets: [{ stockId: 2, status: 'Booked Out', qtySold: 0 }] })],
  })
  const e = r.evidence.get('005002')!
  assert.equal(e.kind, 'buyout')
  assert.equal(e.date, '2022-06-01')
  assert.match(e.reasons[0], /buyout/)
})

test('barcode in order text, and an unexplained line becomes a hole with candidates', () => {
  const r = findSales({ sells: [], stockUnits: units, amc,
    opps: [O(10, { subject: '1x Alienware m15 Sale (AID: 005166)', text: '1x Alienware m15 Sale (AID: 005166)' }), O(12)],
    lines: [L(100, 10, 'Alienware m15', { price: 800 }), L(120, 12, 'RTX 3080 Ti 12GB', { qty: 2 })] })
  assert.equal(r.evidence.get('005166')!.kind, 'text_mention')
  const h = r.holes.find((x) => x.line.id === 120)!
  assert.equal(h.unexplained, 2)
  assert.deepEqual(h.candidates.map((c) => c.slice(0, 6)).sort(), ['005001', '005003'])
})

test('a unit is attributed once; later evidence only corroborates', () => {
  const r = findSales({ sells: [{ stockId: 1, date: '2022-05-03', sourceType: 'Member', sourceId: 7 }], stockUnits: units, amc,
    opps: [O(10)], lines: [L(100, 10, 'RTX 3080 Ti', { assets: [{ stockId: 1, status: 'Completed', qtySold: 1 }] })] })
  const e = r.evidence.get('005001')!
  assert.equal(e.kind, 'sale_line_asset')
  assert.ok(e.reasons.some((x) => /Sell movement .* agrees/.test(x)))
})
