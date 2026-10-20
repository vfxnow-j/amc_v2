import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heldAt, snapshot } from './snapshot'

const u = (o: Record<string, string | number>) => ({ 'Barcode': 'x', 'Status': 'AVAILABLE', 'Disposition': '', 'Disposed On': '', 'Purchase Date': '2022-01-15', 'Total Cost': 6000, 'Salvage Value': '', 'Useful Life (months)': 60, 'Depreciation Method': 'Straight Line', ...o })

test('bought after the date → not held; disposed before → not held', () => {
  assert.equal(heldAt(u({ 'Purchase Date': '2024-03-01' }), '2023-12-31'), null)
  assert.equal(heldAt(u({ 'Status': 'SOLD', 'Disposition': 'Sold', 'Disposed On': '2023-06-01' }), '2023-12-31'), null)
  assert.equal(heldAt(u({ 'Status': 'SOLD', 'Disposition': 'Sold', 'Disposed On': '2024-06-01' }), '2023-12-31'), 'dated')
})

test('unknowns are kept and labelled', () => {
  assert.equal(heldAt(u({ 'Purchase Date': '2026-02-20' }), '2023-12-31'), 'acquired date unknown')
  assert.equal(heldAt(u({ 'Status': 'RETIRED', 'Disposition': 'Unspecified' }), '2023-12-31'), 'disposal undated')
  assert.equal(heldAt(u({ 'Purchase Date': '2026-02-07', 'Status': 'RETIRED' }), '2023-12-31'), 'both unknown')
})

test('book value as of the snapshot date', () => {
  const [r] = snapshot([u({})], '2023-12-31', new Map())
  // 2022-01-15 → 2023-12-31: straight line 6000/60 per month; roughly 23–24 months elapsed
  assert.ok(r.bookValue > 3500 && r.bookValue < 3800, String(r.bookValue))
  assert.equal(r.accumulated, 6000 - r.bookValue)
})
