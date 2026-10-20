import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertEntityDatabase } from '../db-guard'

const url = (db: string) => `postgresql://u:p@127.0.0.1:5432/${db}`

test('accepts entity databases', () => {
  assert.equal(assertEntityDatabase(url('vfxnow_ent_acme')), url('vfxnow_ent_acme'))
})

test('refuses the main database, v1, and anything else', () => {
  for (const db of ['vfxnow_amc_v2', 'vfxnow_amc', 'postgres', 'vfxnow_ent_', 'vfxnow_ent_Acme', 'vfxnow_ent_a-b']) {
    assert.throws(() => assertEntityDatabase(url(db)), /Refusing/, db)
  }
})

test('refuses a missing or malformed url', () => {
  assert.throws(() => assertEntityDatabase(undefined), /not set/)
  assert.throws(() => assertEntityDatabase('nonsense'), /not a valid/)
})
