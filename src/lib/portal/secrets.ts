import crypto from 'node:crypto'

/**
 * Webhook signing secrets, encrypted at rest with AES-256-GCM under the env
 * key PORTAL_SECRET_KEY. The secret has to be recoverable (HMAC needs the
 * plaintext), so it is encrypted rather than hashed. Without a valid key there
 * is no secret: the admin action refuses to create one, and says why.
 *
 * PORTAL_SECRET_KEY is 32 random bytes, written as 64 hex characters or as
 * base64 (`openssl rand -hex 32`). Anything else — a passphrase, a short key —
 * is refused rather than stretched.
 *
 * Each ciphertext is bound to its PortalClient id as GCM additional data, so a
 * stored secret copied onto another client's row does not decrypt.
 *
 * Stored form: `v2.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 */

const VERSION = 'v2'
const TAG_LENGTH = 16

export const PORTAL_SECRET_KEY_FORMAT =
  'PORTAL_SECRET_KEY must be 32 random bytes, written as 64 hex characters or as base64 (e.g. `openssl rand -hex 32`).'

/** The 32-byte key, or why there isn't one. */
export function readPortalSecretKey(
  raw: string | undefined = process.env.PORTAL_SECRET_KEY,
): { key: Buffer; problem: null } | { key: null; problem: string } {
  const value = raw?.trim()
  if (!value) return { key: null, problem: 'PORTAL_SECRET_KEY is not set.' }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return { key: Buffer.from(value, 'hex'), problem: null }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (bytes.length === 32) return { key: bytes, problem: null }
  }
  return { key: null, problem: `PORTAL_SECRET_KEY is set but not usable. ${PORTAL_SECRET_KEY_FORMAT}` }
}

function key(): Buffer {
  const result = readPortalSecretKey()
  if (!result.key) throw new Error(result.problem)
  return result.key
}

export function portalSecretKeyConfigured(): boolean {
  return readPortalSecretKey().key !== null
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`
}

function aad(portalClientId: string): Buffer {
  if (!portalClientId) throw new Error('A webhook secret must be bound to a portal client id')
  return Buffer.from(`portal-client:${portalClientId}`, 'utf8')
}

export function encryptPortalSecret(plaintext: string, portalClientId: string): string {
  const k = key()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: TAG_LENGTH })
  cipher.setAAD(aad(portalClientId))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptPortalSecret(stored: string, portalClientId: string): string {
  const k = key()
  const [version, iv, tag, ciphertext, ...rest] = stored.split('.')
  if (version !== VERSION || !iv || !tag || !ciphertext || rest.length) throw new Error('Unrecognised secret format')
  const tagBytes = Buffer.from(tag, 'base64url')
  // A short tag would make forgery cheaper; GCM would otherwise accept it.
  if (tagBytes.length !== TAG_LENGTH) throw new Error('Unrecognised secret format')
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'), {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAAD(aad(portalClientId))
  decipher.setAuthTag(tagBytes)
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
