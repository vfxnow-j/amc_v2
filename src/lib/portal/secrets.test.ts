import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  decryptPortalSecret,
  encryptPortalSecret,
  generateWebhookSecret,
  portalSecretKeyConfigured,
  readPortalSecretKey,
} from './secrets'

function withKey(value: string | undefined, run: () => void) {
  const saved = process.env.PORTAL_SECRET_KEY
  try {
    if (value === undefined) delete process.env.PORTAL_SECRET_KEY
    else process.env.PORTAL_SECRET_KEY = value
    run()
  } finally {
    if (saved === undefined) delete process.env.PORTAL_SECRET_KEY
    else process.env.PORTAL_SECRET_KEY = saved
  }
}

const HEX_KEY = crypto.randomBytes(32).toString('hex')

test('PORTAL_SECRET_KEY must be 32 bytes as hex or base64', () => {
  const bytes = crypto.randomBytes(32)
  assert.ok(readPortalSecretKey(bytes.toString('hex')).key?.equals(bytes))
  assert.ok(readPortalSecretKey(bytes.toString('base64')).key?.equals(bytes))
  assert.ok(readPortalSecretKey(bytes.toString('base64url')).key?.equals(bytes))
  assert.match(readPortalSecretKey(undefined).problem ?? '', /not set/)
  for (const bad of [
    'test-key-that-is-long-enough', // a passphrase
    crypto.randomBytes(16).toString('hex'), // 16 bytes
    crypto.randomBytes(31).toString('base64'),
    crypto.randomBytes(33).toString('base64'),
    HEX_KEY.slice(0, 63) + 'g',
  ]) {
    const r = readPortalSecretKey(bad)
    assert.equal(r.key, null, bad)
    assert.match(r.problem ?? '', /32 random bytes/)
  }
})

test('webhook secrets round-trip under AES-256-GCM and refuse without a key', () => {
  withKey(undefined, () => {
    assert.equal(portalSecretKeyConfigured(), false)
    assert.throws(() => encryptPortalSecret('x', 'pc_1'), /PORTAL_SECRET_KEY/)
  })
  withKey('a-passphrase-is-not-a-key', () => {
    assert.equal(portalSecretKeyConfigured(), false)
    assert.throws(() => encryptPortalSecret('x', 'pc_1'), /32 random bytes/)
  })

  let stored = ''
  const secret = generateWebhookSecret()
  withKey(HEX_KEY, () => {
    assert.equal(portalSecretKeyConfigured(), true)
    stored = encryptPortalSecret(secret, 'pc_1')
    assert.match(stored, /^v2\./)
    assert.ok(!stored.includes(secret))
    assert.equal(decryptPortalSecret(stored, 'pc_1'), secret)
    assert.notEqual(encryptPortalSecret(secret, 'pc_1'), stored) // fresh IV

    const [v, iv, tag, ct] = stored.split('.')
    const tampered = [v, iv, tag, Buffer.from('tampered').toString('base64url') + ct].join('.')
    assert.throws(() => decryptPortalSecret(tampered, 'pc_1'))
  })
  withKey(crypto.randomBytes(32).toString('hex'), () => {
    assert.throws(() => decryptPortalSecret(stored, 'pc_1'))
  })
})

test('a secret is bound to its portal client and to a full-length tag', () => {
  withKey(HEX_KEY, () => {
    const stored = encryptPortalSecret('whsec_x', 'pc_1')
    // Copied onto another client's row, it does not decrypt.
    assert.throws(() => decryptPortalSecret(stored, 'pc_2'))
    assert.throws(() => encryptPortalSecret('whsec_x', ''))

    const [v, iv, tag, ct] = stored.split('.')
    const short = Buffer.from(tag, 'base64url').subarray(0, 12).toString('base64url')
    assert.throws(() => decryptPortalSecret([v, iv, short, ct].join('.'), 'pc_1'), /format/)
    assert.throws(() => decryptPortalSecret(['v1', iv, tag, ct].join('.'), 'pc_1'), /format/)
  })
})
