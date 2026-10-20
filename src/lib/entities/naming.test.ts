import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify, dbNameFor, ENTITY_DB_RE } from './naming'

test('slugify lowercases, hyphenates and trims', () => {
  assert.equal(slugify('  Acme Studios, LLC '), 'acme-studios-llc')
  assert.equal(slugify('Équinox 4'), 'equinox-4')
})

test('slugify rejects names with nothing usable', () => {
  assert.equal(slugify('!!!'), '')
})

test('dbNameFor makes a guarded database name', () => {
  assert.equal(dbNameFor('acme-studios-llc'), 'vfxnow_ent_acme_studios_llc')
  assert.match(dbNameFor('a'), ENTITY_DB_RE)
})

test('slugify caps length so the database name stays valid', () => {
  const slug = slugify('x'.repeat(100))
  assert.ok(slug.length <= 40)
  assert.match(dbNameFor(slug), ENTITY_DB_RE)
})
