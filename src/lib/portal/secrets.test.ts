import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decryptPortalSecret, encryptPortalSecret, generateWebhookSecret, portalSecretKeyConfigured } from './secrets'

test('webhook secrets round-trip under AES-256-GCM and refuse without a key', () => {
  const saved = process.env.PORTAL_SECRET_KEY
  try {
    delete process.env.PORTAL_SECRET_KEY
    assert.equal(portalSecretKeyConfigured(), false)
    assert.throws(() => encryptPortalSecret('x'), /PORTAL_SECRET_KEY/)

    process.env.PORTAL_SECRET_KEY = 'test-key-that-is-long-enough'
    const secret = generateWebhookSecret()
    const stored = encryptPortalSecret(secret)
    assert.ok(!stored.includes(secret))
    assert.equal(decryptPortalSecret(stored), secret)
    assert.notEqual(encryptPortalSecret(secret), stored) // fresh IV

    const [v, iv, tag, ct] = stored.split('.')
    const tampered = [v, iv, tag, Buffer.from('tampered').toString('base64url') + ct].join('.')
    assert.throws(() => decryptPortalSecret(tampered))

    process.env.PORTAL_SECRET_KEY = 'a-different-key-entirely'
    assert.throws(() => decryptPortalSecret(stored))
  } finally {
    if (saved === undefined) delete process.env.PORTAL_SECRET_KEY
    else process.env.PORTAL_SECRET_KEY = saved
  }
})
