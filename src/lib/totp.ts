import crypto from 'crypto'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const APP_NAME = 'VFXNow AMC'

function getEncryptionKey(): Buffer {
  const hex = process.env.MFA_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('MFA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/** Encrypt a TOTP secret for database storage. Returns "iv:authTag:ciphertext" in hex. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/** Decrypt a stored TOTP secret. Input format: "iv:authTag:ciphertext" in hex. */
export function decryptSecret(stored: string): string {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}

/** Generate a new random TOTP secret (base32 encoded). */
export function generateTotpSecret(): string {
  return generateSecret()
}

/** Build an otpauth:// URI for QR code encoding. */
export function buildTotpKeyUri(email: string, secret: string): string {
  return generateURI({
    issuer: APP_NAME,
    label: email,
    secret,
  })
}

/** Generate a QR code data URI from an otpauth:// URI. */
export async function generateQrCodeDataUri(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    width: 256,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/** Verify a TOTP code against a plaintext secret. Allows +/- 1 time step (30s window). */
export function verifyTotpCode(code: string, secret: string): boolean {
  const result = verifySync({ token: code, secret })
  return result.valid
}
