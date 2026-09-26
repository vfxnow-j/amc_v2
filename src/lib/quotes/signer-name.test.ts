import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSignerName } from './signer-name'

test('a signer name is trimmed and accepted', () => {
  assert.deepEqual(validateSignerName('  Ada Client  '), { ok: true, name: 'Ada Client' })
  assert.deepEqual(validateSignerName('x'.repeat(200)), { ok: true, name: 'x'.repeat(200) })
})

test('an empty or whitespace-only name is refused', () => {
  assert.deepEqual(validateSignerName(''), { ok: false, error: 'Enter your full name to sign.' })
  assert.deepEqual(validateSignerName('   '), { ok: false, error: 'Enter your full name to sign.' })
})

test('a name over 200 characters is refused', () => {
  assert.deepEqual(validateSignerName('x'.repeat(201)), { ok: false, error: 'That name is too long.' })
})

test('non-string input from the browser is refused, not coerced', () => {
  for (const bad of [42, null, undefined, {}, ['Ada']]) {
    const r = validateSignerName(bad)
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`)
  }
})
