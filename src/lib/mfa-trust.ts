import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

const DEFAULT_TRUST_DURATION_DAYS = 30

/**
 * Generate a trust token: returns raw token (for cookie) and hash (for DB).
 */
export function generateTrustToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

/**
 * Validate a raw trust token for a given user.
 * Returns true if valid, false otherwise. Updates lastUsedAt atomically.
 */
export async function validateTrustToken(rawToken: string, userId: string): Promise<boolean> {
  if (!rawToken || !userId) return false

  const hash = crypto.createHash('sha256').update(rawToken).digest('hex')

  const token = await prisma.mfaTrustToken.findUnique({
    where: { tokenHash: hash },
  })

  if (!token) return false
  if (token.userId !== userId) return false
  if (token.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.mfaTrustToken.delete({ where: { id: token.id } }).catch(() => {})
    return false
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.mfaTrustToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return true
}

/**
 * Revoke all trust tokens for a user.
 */
export async function revokeAllTrustTokens(userId: string): Promise<void> {
  await prisma.mfaTrustToken.deleteMany({
    where: { userId },
  })
}

/**
 * Revoke a specific trust token by ID.
 */
export async function revokeTrustTokenById(tokenId: string, userId: string): Promise<boolean> {
  const result = await prisma.mfaTrustToken.deleteMany({
    where: { id: tokenId, userId },
  })
  return result.count > 0
}

/**
 * Get all active trust tokens for a user (for settings UI).
 */
export async function getUserTrustDevices(userId: string) {
  return prisma.mfaTrustToken.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      deviceName: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  })
}

/**
 * Parse a user-agent string into a human-readable device name.
 */
export function parseDeviceName(userAgent: string | null): string {
  if (!userAgent) return 'Unknown Device'

  let browser = 'Unknown Browser'
  let os = 'Unknown OS'

  // Browser detection
  if (userAgent.includes('Firefox/')) browser = 'Firefox'
  else if (userAgent.includes('Edg/')) browser = 'Edge'
  else if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) browser = 'Chrome'
  else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) browser = 'Safari'
  else if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) browser = 'Opera'

  // OS detection
  if (userAgent.includes('Windows')) os = 'Windows'
  else if (userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')) os = 'macOS'
  else if (userAgent.includes('Linux') && !userAgent.includes('Android')) os = 'Linux'
  else if (userAgent.includes('Android')) os = 'Android'
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS'

  return `${browser} on ${os}`
}

/**
 * Get the configured trust duration in days from settings.
 */
export async function getTrustDurationDays(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: 'mfa_trust_duration_days' },
  })

  if (setting?.value && typeof setting.value === 'number') {
    return setting.value
  }

  // Check if it's stored as a JSON number
  if (setting?.value != null) {
    const val = Number(setting.value)
    if (!isNaN(val) && val > 0) return val
  }

  return DEFAULT_TRUST_DURATION_DAYS
}

/**
 * Clean up expired trust tokens.
 */
export async function cleanupExpiredTrustTokens(): Promise<number> {
  const result = await prisma.mfaTrustToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
