import crypto from 'node:crypto'

/**
 * Webhook signing secrets, encrypted at rest with AES-256-GCM under the env
 * key PORTAL_SECRET_KEY. The secret has to be recoverable (HMAC needs the
 * plaintext), so it is encrypted rather than hashed. Without the key there is
 * no secret: the admin action refuses to create one, and says so.
 *
 * Stored form: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 */

function key(): Buffer | null {
  const raw = process.env.PORTAL_SECRET_KEY
  if (!raw || raw.length < 16) return null
  // Any passphrase of 16+ chars works; SHA-256 makes it exactly 32 bytes.
  return crypto.createHash('sha256').update(raw).digest()
}

export function portalSecretKeyConfigured(): boolean {
  return key() !== null
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`
}

export function encryptPortalSecret(plaintext: string): string {
  const k = key()
  if (!k) throw new Error('PORTAL_SECRET_KEY is not set')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptPortalSecret(stored: string): string {
  const k = key()
  if (!k) throw new Error('PORTAL_SECRET_KEY is not set')
  const [version, iv, tag, ciphertext] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unrecognised secret format')
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
