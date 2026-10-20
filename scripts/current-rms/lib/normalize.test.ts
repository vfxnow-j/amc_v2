import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBarcode, normalizePoNumber } from './normalize'

test('numeric barcodes compare as 6-digit zero-padded', () => {
  assert.equal(normalizeBarcode('481'), '000481')
  assert.equal(normalizeBarcode(' 000481 '), '000481')
  assert.equal(normalizeBarcode('0004853'), '004853')
  assert.equal(normalizeBarcode('100287'), '100287')
})

test('non-numeric barcodes are trimmed and upper-cased only', () => {
  assert.equal(normalizeBarcode('vfx0051 '), 'VFX0051')
  assert.equal(normalizeBarcode(''), '')
  assert.equal(normalizeBarcode(null), '')
})

test('PO numbers normalise to PO-000000', () => {
  assert.equal(normalizePoNumber('PO-000248'), 'PO-000248')
  assert.equal(normalizePoNumber('000247'), 'PO-000247')
  assert.equal(normalizePoNumber('252'), 'PO-000252')
  assert.equal(normalizePoNumber('0000000001'), 'PO-000001')
  assert.equal(normalizePoNumber('po 12'), 'PO-000012')
})

test('non-PO values are not links', () => {
  assert.equal(normalizePoNumber('AMAZON'), null)
  assert.equal(normalizePoNumber('N/A'), null)
  assert.equal(normalizePoNumber(''), null)
  assert.equal(normalizePoNumber(undefined), null)
})
