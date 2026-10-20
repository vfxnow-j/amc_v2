import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkPos, matchIdentity, type AmcUnit, type PoLine, type StockItem } from './link'

const S = (id: number, assetNumber: string, o: Partial<StockItem> = {}): StockItem => ({ id, itemId: 50, itemName: 'x', assetNumber, serial: '', store: 'VFXnow - LA', openingDate: '2020-11-20', firstMoveDate: null, poNumberRaw: '', state: 'held', ...o })
const U = (barcode: string, assetName: string, o: Partial<AmcUnit> = {}): AmcUnit => ({ barcode, serial: null, assetName, status: 'AVAILABLE', purchaseDate: '2020-11-20', purchasePrice: null, estimated: false, ...o })
const P = (id: number, poNumber: string, name: string, qty: number, price: number, o: Partial<PoLine> = {}): PoLine => ({ id, poId: Number(poNumber.slice(3)), poNumber, orderedAt: '2020-11-16', supplier: 'ASI', subject: 'components', name, qty, price, total: qty * price, serialisedProduct: false, itemId: 1, ...o })

test('identity: exact, then normalised barcode, then serial; leftovers are current-only', () => {
  const amc = [U('000481', 'A'), U('VFX0051', 'B', { serial: 'SN9' }), U('001000', 'C')]
  const { pairs, currentOnly } = matchIdentity([S(1, '481'), S(2, 'ZZZ', { serial: 'sn9' }), S(3, '001000'), S(4, '999999')], amc)
  assert.equal(pairs.get('000481')!.method, 'normalized barcode')
  assert.equal(pairs.get('VFX0051')!.method, 'serial')
  assert.equal(pairs.get('001000')!.method, 'barcode')
  assert.deepEqual(currentOnly.map((c) => c.stock.assetNumber), ['999999'])
})

test('PO # on the Current stock item links directly, even outside the window', () => {
  const { pairs } = matchIdentity([S(1, '000100', { poNumberRaw: '248', openingDate: '2023-01-01' })], [U('000100', 'Mac Studio M1 ULTRA 4TB')])
  const r = linkPos([P(10, 'PO-000248', 'Mac Studio M1 ULTRA 4TB 20c', 1, 3999)], pairs, 60)
  const u = r.units.get('000100')!
  assert.equal(u.poNumber, 'PO-000248')
  assert.equal(u.cost, 3999)
  assert.equal(u.grade, 'yellow')
  assert.match(u.reason, /PO # recorded on Current stock item/)
  assert.equal(u.kind, 'po_number')
})

test('complete build claims units in the window up to cpu qty and costs them', () => {
  const stock = [S(1, '000001'), S(2, '000002'), S(3, '000003', { openingDate: '2021-06-01' })]
  const amc = [U('000001', 'Threadripper 3960X'), U('000002', 'Threadripper 3960X'), U('000003', 'Threadripper 3960X')]
  const { pairs } = matchIdentity(stock, amc)
  const lines = [
    P(1, 'PO-000036', 'AMD Ryzen Threadripper 3960X', 2, 1320), P(2, 'PO-000036', 'MSI TRX40 Pro Motherboard', 2, 422),
    P(3, 'PO-000036', 'Crucial 16GB DDR4 ram modules', 8, 52), P(4, 'PO-000036', 'Fractal Define 7 Case', 2, 147),
    P(5, 'PO-000036', 'EVGA Power Supply 850W', 2, 192),
  ]
  const r = linkPos(lines, pairs, 60)
  assert.equal(r.units.get('000001')!.cost, 1320 + 422 + 4 * 52 + 147 + 192)
  assert.equal(r.units.get('000001')!.grade, 'yellow')
  assert.equal(r.units.has('000003'), false) // outside 60-day window
  assert.deepEqual(r.lines.get(1)!.barcodes, ['000001', '000002'])
})

test('unit sold before the PO date cannot come from that PO', () => {
  const { pairs } = matchIdentity([S(1, '000001', { firstMoveDate: '2020-10-01' })], [U('000001', 'Threadripper 3960X')])
  const r = linkPos([P(1, 'PO-000044', 'AMD Ryzen Threadripper 3960X', 1, 1517)], pairs, 60)
  assert.equal(r.units.has('000001'), false)
})

test('cpu-only PO is orange with the missing parts named', () => {
  const { pairs } = matchIdentity([S(1, '000001')], [U('000001', 'Threadripper 3990X')])
  const r = linkPos([P(1, 'PO-000035', 'AMD Threadripper 3990X', 1, 3750)], pairs, 60)
  const u = r.units.get('000001')!
  assert.equal(u.grade, 'orange')
  assert.match(u.reason, /missing board, ram, case, psu/)
  assert.equal(u.kind, 'build_partial')
  assert.equal(u.flags.missingParts, 4)
})

test('a unit that fits two POs is orange and names the other PO', () => {
  const { pairs } = matchIdentity([S(1, '000001')], [U('000001', 'Threadripper 3990X')])
  const r = linkPos([P(1, 'PO-000035', 'AMD Threadripper 3990X', 1, 3750), P(2, 'PO-000036', 'AMD Threadripper 3990X', 1, 3700, { orderedAt: '2020-11-10' })], pairs, 60)
  assert.match(r.units.get('000001')!.reason, /also fits PO-0000(35|36)/)
})

test('a $0 PO line gives no cost, not a $0 cost', () => {
  const { pairs } = matchIdentity([S(1, '000100')], [U('000100', 'RS3621xs+ 12-Bay')])
  const r = linkPos([P(1, 'PO-000027', 'Synology Rackstation RS3621xs+ (Diskless)', 1, 0, { serialisedProduct: true, itemId: 50 })], pairs, 60)
  assert.equal(r.units.get('000100')!.cost, null)
  assert.equal(r.units.get('000100')!.basis, 'line has no price in Current')
})
