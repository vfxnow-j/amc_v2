import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineTitle } from './line-title'

test('asset line with its own description: name as title, description beneath', () => {
  assert.deepEqual(
    lineTitle({ asset: { name: 'Lenovo P620' }, description: '64GB RAM, 2TB NVMe, RTX A6000' }),
    { title: 'Lenovo P620', spec: '64GB RAM, 2TB NVMe, RTX A6000' },
  )
})

test('description equal to the asset name is not repeated', () => {
  assert.deepEqual(lineTitle({ asset: { name: 'Lenovo P620' }, description: 'Lenovo P620' }), { title: 'Lenovo P620' })
})

test('whitespace-only or missing description gives no spec', () => {
  assert.deepEqual(lineTitle({ asset: { name: 'Mac Studio' }, description: '   ' }), { title: 'Mac Studio' })
  assert.deepEqual(lineTitle({ asset: { name: 'Mac Studio' }, description: null }), { title: 'Mac Studio' })
})

test('ad-hoc line (no asset) uses its description as the title', () => {
  assert.deepEqual(lineTitle({ asset: null, description: 'Rush delivery' }), { title: 'Rush delivery' })
})

test('nothing at all falls back to "Ad-hoc item"', () => {
  assert.deepEqual(lineTitle({ asset: null, description: '' }), { title: 'Ad-hoc item' })
})
