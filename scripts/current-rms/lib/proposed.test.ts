import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposeRow, recomputeTotals, resection } from './proposed'

const row = {
  'Asset Name': 'EMC Isilon X410 72TB', 'Barcode': '001104', 'Status': 'AVAILABLE', 'Purchase Date': '2026-02-20', 'Purchase Price': '',
  'Landed Cost Adj.': '', 'Total Cost': '', 'Salvage Value': '', 'Depreciable Base': '', 'Useful Life (months)': 60,
  'Depreciation Method': 'Straight Line', 'Current Book Value': 0, 'Book Value As Of': '2026-09-18', 'Accumulated Depreciation': 0,
  'Sale Price': '', 'Gain / Loss': '', 'Lifetime Revenue': 0, 'Maintenance Cost': 0,
}

test('no proposal → row unchanged', () => {
  const r = proposeRow(row, undefined, null)
  assert.deepEqual(r.row, row)
  assert.deepEqual(r.changed, [])
  assert.equal(r.pct, null)
})

test('old date + filled cost → fully depreciated, changes listed, pct = weakest field', () => {
  const r = proposeRow(row, { date: '2019-02-13', datePct: 85, cost: 2500, costPct: 70 }, null)
  assert.equal(r.row['Purchase Date'], '2019-02-13')
  assert.equal(r.row['Purchase Price'], 2500)
  assert.equal(r.row['Total Cost'], 2500)
  assert.equal(r.row['Current Book Value'], 0) // 60-month life long past
  assert.equal(r.row['Accumulated Depreciation'], 2500)
  assert.equal(r.pct, 70)
  assert.deepEqual(r.changed.slice(0, 2), ['Purchase Date', 'Purchase Price'])
  assert.match(r.changes[1], /blank → \$2,500.00 \(70%\)/)
})

test('a real received date keeps the depreciation start', () => {
  const recent = { ...row, 'Purchase Price': 6000, 'Total Cost': 6000 }
  const moved = proposeRow(recent, { date: '2019-01-01', datePct: 60, cost: null, costPct: null }, '2026-03-01')
  assert.ok(Number(moved.row['Current Book Value']) > 5000) // still depreciating from 2026-03
})

test('totals rebuilt over unit rows', () => {
  const t = recomputeTotals([
    { 'Asset Name': 'a', 'Purchase Price': 100, 'Total Cost': 100, 'Salvage Value': 0, 'Lifetime Revenue': 10, 'Maintenance Cost': 4 },
    { 'Asset Name': 'b', 'Purchase Price': 50, 'Total Cost': 50, 'Salvage Value': 0, 'Lifetime Revenue': 0, 'Maintenance Cost': 0 },
    { 'Asset Name': '--- TOTALS (2 active units) ---', 'Purchase Price': 0, 'Total Cost': 0 },
  ])
  assert.equal(t[2]['Purchase Price'], 150)
  assert.equal(t[2]['Depreciable Base'], 150)
  assert.equal(t[2]['Net Profit'], 6)
})

test('a Current sale moves an active unit to SOLD, valued at the sale date, with gain/loss', () => {
  const live = { ...row, 'Purchase Date': '2021-01-10', 'Purchase Price': 6000, 'Total Cost': 6000, 'Disposition': '', 'Disposed On': '', 'Disposed To': '' }
  const r = proposeRow(live, undefined, null, { markSold: true, date: '2023-01-10', buyer: 'Pixomondo', price: 2500, pct: 90, pricePct: 75, label: 'Current Sell movement' })
  assert.equal(r.row['Status'], 'SOLD')
  assert.equal(r.row['Disposition'], 'Sold')
  assert.equal(r.row['Disposed On'], '2023-01-10')
  assert.equal(r.row['Book Value As Of'], '2023-01-10')
  const book = Number(r.row['Current Book Value'])
  assert.ok(book > 3500 && book < 3700, String(book)) // ~24 of 60 months gone
  assert.equal(r.row['Gain / Loss'], Math.round((2500 - book) * 100) / 100)
  assert.equal(r.pct, 75)
})

test('resection moves sold rows out of the active section and fixes counts + totals', () => {
  const a = { 'Asset Name': 'A', 'Barcode': '1', 'Status': 'AVAILABLE', 'Disposition': '', 'Purchase Price': 100, 'Total Cost': 100 }
  const b = { 'Asset Name': 'B', 'Barcode': '2', 'Status': 'SOLD', 'Disposition': 'Sold', 'Purchase Price': 50, 'Total Cost': 50, 'Sale Price': 20 }
  const out = resection([a, b, { 'Asset Name': '--- TOTALS (2 active units) ---', 'Barcode': '' }])
  assert.equal(out[1]['Asset Name'], '--- TOTALS (1 active units) ---')
  assert.equal(out[1]['Purchase Price'], 100)
  assert.match(String(out[3]['Asset Name']), /SOLD \/ RETIRED \(1 units/)
  assert.equal(out.at(-1)!['Sale Price'], 20)
})
