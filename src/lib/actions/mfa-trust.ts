'use server'

import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-utils'
import {
  generateTrustToken,
  parseDeviceName,
  getTrustDurationDays,
  getUserTrustDevices,
  revokeTrustTokenById,
  revokeAllTrustTokens,
} from '@/lib/mfa-trust'
import { serialize } from '@/lib/utils'
import { revalidatePath } from 'next/cache'

/**
 * Create a trust token and set it as an httpOnly cookie.
 * Called after successful MFA verification when user opts to trust this device.
 */
export async function createAndSetMfaTrust(userId: string): Promise<{ success: boolean }> {
  const headerStore = await headers()
  const userAgent = headerStore.get('user-agent')
  const deviceName = parseDeviceName(userAgent)

  const durationDays = await getTrustDurationDays()
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)

  const { raw, hash } = generateTrustToken()

  await prisma.mfaTrustToken.create({
    data: {
      userId,
      tokenHash: hash,
      deviceName,
      expiresAt,
    },
  })

  const cookieStore = await cookies()
  cookieStore.set('mfa_trust', raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })

  return { success: true }
}

/**
 * Get trusted devices for the current user (settings UI).
 */
export async function getTrustedDevices() {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return []
  }

  const devices = await getUserTrustDevices(authResult.userId)
  return serialize(devices)
}

/**
 * Revoke a specific trust device.
 */
export async function revokeTrustDevice(
  tokenId: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const revoked = await revokeTrustTokenById(tokenId, authResult.userId)
  if (!revoked) {
    return { success: false, error: 'Device not found' }
  }

  revalidatePath('/dashboard/settings/profile')
  return { success: true }
}

/**
 * Revoke all trust devices for the current user.
 */
export async function revokeAllTrustDevices(): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  await revokeAllTrustTokens(authResult.userId)

  // Also clear the cookie on this device
  const cookieStore = await cookies()
  cookieStore.delete('mfa_trust')

  revalidatePath('/dashboard/settings/profile')
  return { success: true }
}
