import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoInvoiceScope, firstCycleAutoInvoice, type AutoInvoiceItem } from './auto-invoice'
import { cycleInvoice, cycleTermsForOrder, toCycleLine } from './cycle-invoice'

const item = (over: Partial<AutoInvoiceItem> & { id: string }): AutoInvoiceItem => ({
  parentId: null, cloudProductId: null, packageId: null, package: null, asset: null,
  description: 'Line', assetId: null, rate: 0, quantity: 1, pricingType: 'MONTHLY',
  isOneTime: false, includedInParent: false, ...over,
})

// A recurring rental starting mid-period: a workstation with a GPU included in
// its price, a billed monitor nested under it, a line from the quote option the
// client didn't choose, a one-time imaging charge, $100 off once, and delivery.
const items: AutoInvoiceItem[] = [
  item({ id: 'ws', asset: { name: 'Workstation' }, assetId: 'a-ws', rate: 1000, packageId: 'p-chosen', package: { isActive: true } }),
  item({ id: 'gpu', parentId: 'ws', asset: { name: 'RTX 5090' }, assetId: 'a-gpu', rate: 450, includedInParent: true, packageId: 'p-chosen', package: { isActive: true } }),
  item({ id: 'mon', parentId: 'ws', asset: { name: 'Monitor' }, assetId: 'a-mon', rate: 200, quantity: 2 }),
  item({ id: 'alt', asset: { name: 'Other option' }, assetId: 'a-alt', rate: 5000, packageId: 'p-other', package: { isActive: false } }),
  item({ id: 'img', description: 'Imaging', rate: 300, isOneTime: true }),
  item({ id: 'cfg', parentId: 'ws', cloudProductId: 'cp', rate: 0 }),
]
const order = {
  discountType: 'FIXED', discountValue: 100, taxRate: 10, deliveryCost: 150, returnCost: 0,
  shippingMarginType: null, shippingMargin: 0, packages: [],
}
const share = 11 / 30

test('a recurring rental auto-invoice equals cycleInvoice on the first stretch', () => {
  const terms = cycleTermsForOrder(order)
  const { priced } = firstCycleAutoInvoice({ items, share, terms })

  // What the billing run / manual first invoice would price: the chosen scope.
  const expected = cycleInvoice({
    lines: items.filter((i) => i.id === 'ws' || i.id === 'gpu' || i.id === 'mon' || i.id === 'img').map(toCycleLine),
    share, first: true, terms,
  })
  assert.deepEqual(priced, expected)

  // And the figures themselves: 366.67 + 146.67 + 300 = 813.34, less 100 once,
  // 10% tax on 713.34, then delivery untaxed.
  assert.equal(priced.itemsSubtotal, 813.34)
  assert.equal(priced.discount, 100)
  assert.equal(priced.taxAmount, 71.33)
  assert.equal(priced.oneTimeCharges, 150)
  assert.equal(priced.subtotal, 863.34)
  assert.equal(priced.total, 934.67)
})

test('each billed line keeps its order line; discount and delivery have none', () => {
  const { lines } = firstCycleAutoInvoice({ items, share, terms: cycleTermsForOrder(order) })
  assert.deepEqual(lines.map((l) => [l.reservationItemId, l.parentReservationItemId]), [
    ['ws', null], ['mon', 'ws'], ['img', null], [null, null], [null, null],
  ])
  assert.equal(lines.find((l) => l.reservationItemId === 'gpu'), undefined)
  assert.equal(lines.find((l) => l.reservationItemId === 'alt'), undefined)
})

test('the one-time/sale scope skips included parts, unchosen options and cloud config rows', () => {
  assert.deepEqual(autoInvoiceScope(items).map((i) => i.id), ['ws', 'mon', 'img'])
})
