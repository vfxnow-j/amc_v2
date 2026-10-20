import { test } from 'node:test'
import assert from 'node:assert/strict'
import { band, combined, costScore, dateScore, identityScore, linkScore } from './confidence'

const noFlags = { countMismatch: false, rivals: 0, missingParts: 0, mixedModels: false }

test('identity', () => {
  assert.equal(identityScore('barcode', false), 100)
  assert.equal(identityScore('normalized barcode', false), 95)
  assert.equal(identityScore('serial', true), 70)
})

test('link: direct beats inferred; flags pull it down', () => {
  assert.equal(linkScore('po_number', noFlags), 95)
  assert.equal(linkScore('build_complete', { ...noFlags, countMismatch: true, rivals: 2 }), 55)
  assert.ok(linkScore('build_partial', noFlags) < linkScore('name_match', noFlags))
})

test('date: import stamp replaced by opening date is high; bulk day is low; real-vs-real is a coin flip', () => {
  const base = { agrees: false, source: 'opening' as const, link: null, bulkDay: false, amcIsStamp: false, amcIsInStockDate: false }
  assert.equal(dateScore({ ...base, agrees: true }), 100)
  assert.equal(dateScore({ ...base, amcIsStamp: true }), 85)
  assert.equal(dateScore({ ...base, bulkDay: true, amcIsStamp: true }), 40)
  assert.equal(dateScore(base), 50)
  assert.equal(dateScore({ ...base, source: 'po', link: 95, amcIsStamp: true }), 95)
  assert.equal(dateScore({ ...base, source: 'po', link: 90, amcIsInStockDate: true }), 80)
})

test('cost: filling a blank trusts the link; overwriting costs more confidence', () => {
  assert.equal(costScore({ agrees: false, amcBlank: true, link: 90, amcIsEstimate: false }), 90)
  assert.equal(costScore({ agrees: false, amcBlank: false, link: 90, amcIsEstimate: false }), 70)
  assert.equal(costScore({ agrees: false, amcBlank: false, link: 90, amcIsEstimate: true }), 85)
})

test('combined and bands', () => {
  assert.equal(combined(95, 80), 76)
  assert.equal(band(90), 'high')
  assert.equal(band(70), 'medium')
  assert.equal(band(40), 'low')
})
