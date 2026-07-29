'use server'

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { mfaOtpEmail, mfaEnabledEmail, mfaDisabledEmail } from '@/lib/email/templates'
import { requireAuth } from '@/lib/auth-utils'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { logAudit } from './audit'
import { revalidatePath } from 'next/cache'
import {
  generateTotpSecret,
  buildTotpKeyUri,
  generateQrCodeDataUri,
  encryptSecret,
  verifyTotpCode,
} from '@/lib/totp'

const OTP_EXPIRY_MINUTES = 10
const OTP_RATE_LIMIT_SECONDS = 60

function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Send an MFA OTP code to the given email address.
 * Rate-limited to one code per 60 seconds per email.
 * Always returns { success: true } to prevent user enumeration.
 */
export async function sendMfaOtp(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const normalizedEmail = email.toLowerCase().trim()

    // Find the user - but don't reveal if they exist
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    })

    if (!user) {
      // Return success to prevent enumeration
      return { success: true }
    }

    // Rate limit check: find most recent OTP for this user
    const recentToken = await prisma.emailToken.findFirst({
      where: {
        identifier: normalizedEmail,
        type: 'MFA_OTP',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (recentToken) {
      const secondsSinceLastToken = (Date.now() - recentToken.createdAt.getTime()) / 1000
      if (secondsSinceLastToken < OTP_RATE_LIMIT_SECONDS) {
        return { success: true } // Silently rate-limit
      }
    }

    // Invalidate existing unused OTPs for this user
    await prisma.emailToken.updateMany({
      where: {
        identifier: normalizedEmail,
        type: 'MFA_OTP',
        used: false,
      },
      data: { used: true },
    })

    // Generate new OTP
    const otp = generateOTP()
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    // Create new OTP token
    await prisma.emailToken.create({
      data: {
        identifier: normalizedEmail,
        token: otp,
        type: 'MFA_OTP',
        expires,
      },
    })

    // Send email
    const template = mfaOtpEmail(user.name, otp)
    await sendEmail({
      to: user.email,
      subject: template.subject,
      html: template.html,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to send MFA OTP:', error)
    // Still return success to prevent enumeration
    return { success: true }
  }
}

/**
 * Verify an MFA OTP code for the given email.
 * Rate-limited to 5 attempts per 10 minutes per email.
 * Uses atomic updateMany to prevent TOCTOU race conditions.
 */
export async function verifyMfaOtp(
  email: string,
  code: string
): Promise<{ valid: boolean }> {
  try {
    const normalizedEmail = email.toLowerCase().trim()

    // Rate limit: 5 OTP verification attempts per 10 minutes
    const limit = checkRateLimit('otp-verify', normalizedEmail, 5, 10 * 60 * 1000)
    if (!limit.allowed) {
      return { valid: false }
    }

    // Atomic: update matching unused token to used, check if any were updated
    const consumed = await prisma.emailToken.updateMany({
      where: {
        identifier: normalizedEmail,
        token: code,
        type: 'MFA_OTP',
        used: false,
        expires: { gt: new Date() },
      },
      data: { used: true },
    })

    return { valid: consumed.count > 0 }
  } catch (error) {
    console.error('Failed to verify MFA OTP:', error)
    return { valid: false }
  }
}

/**
 * Initiate MFA enrollment for the currently authenticated user.
 * Sends a test OTP to verify email delivery before enabling MFA.
 */
export async function initiateMfaEnrollment(): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, mfaEnabled: true },
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (user.mfaEnabled) {
    return { success: false, error: 'MFA is already enabled' }
  }

  // Send a test OTP
  return sendMfaOtp(user.email)
}

/**
 * Confirm MFA enrollment by verifying the test OTP.
 * Enables MFA on the user account.
 */
export async function confirmMfaEnrollment(
  code: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, name: true, mfaEnabled: true },
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (user.mfaEnabled) {
    return { success: false, error: 'MFA is already enabled' }
  }

  // Verify the OTP
  const verification = await verifyMfaOtp(user.email, code)
  if (!verification.valid) {
    return { success: false, error: 'Invalid or expired verification code' }
  }

  // Enable MFA
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true },
  })

  // Send confirmation email
  const template = mfaEnabledEmail(user.name)
  await sendEmail({
    to: user.email,
    subject: template.subject,
    html: template.html,
  })

  // Log audit
  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValues: { mfaEnabled: false },
    newValues: { mfaEnabled: true },
    userId: user.id,
  })

  revalidatePath('/dashboard/settings')
  revalidatePath('/dashboard/admin/users')

  return { success: true }
}

/**
 * Disable MFA for the currently authenticated user.
 * Requires the current password for verification.
 */
export async function disableMfa(
  password: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, name: true, passwordHash: true, mfaEnabled: true },
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (!user.mfaEnabled) {
    return { success: false, error: 'MFA is not enabled' }
  }

  if (!user.passwordHash) {
    return { success: false, error: 'Cannot verify password for OAuth accounts' }
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) {
    return { success: false, error: 'Invalid password' }
  }

  // Disable MFA and revoke all trust tokens
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null },
  })

  await prisma.mfaTrustToken.deleteMany({
    where: { userId: user.id },
  })

  // Send notification email
  const template = mfaDisabledEmail(user.name)
  await sendEmail({
    to: user.email,
    subject: template.subject,
    html: template.html,
  })

  // Log audit
  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValues: { mfaEnabled: true },
    newValues: { mfaEnabled: false },
    userId: user.id,
  })

  revalidatePath('/dashboard/settings')
  revalidatePath('/dashboard/admin/users')

  return { success: true }
}

// ============================================
// TOTP AUTHENTICATOR APP
// ============================================

/**
 * Start TOTP enrollment: generate a secret and QR code for the user to scan.
 * Requires email MFA to already be enabled.
 */
export async function initiateTotpEnrollment(): Promise<{
  success: boolean
  qrCodeDataUri?: string
  secret?: string
  error?: string
}> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, mfaEnabled: true, mfaSecret: true },
  })

  if (!user) return { success: false, error: 'User not found' }
  if (!user.mfaEnabled) return { success: false, error: 'Email MFA must be enabled first' }
  if (user.mfaSecret) return { success: false, error: 'Authenticator app is already configured' }

  const secret = generateTotpSecret()
  const keyUri = buildTotpKeyUri(user.email, secret)
  const qrCodeDataUri = await generateQrCodeDataUri(keyUri)

  return { success: true, qrCodeDataUri, secret }
}

/**
 * Confirm TOTP enrollment by verifying a code from the authenticator app.
 * Encrypts the secret and stores it on the user record.
 */
export async function confirmTotpEnrollment(
  secret: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, name: true, mfaEnabled: true, mfaSecret: true },
  })

  if (!user) return { success: false, error: 'User not found' }
  if (!user.mfaEnabled) return { success: false, error: 'Email MFA must be enabled first' }
  if (user.mfaSecret) return { success: false, error: 'Authenticator app is already configured' }

  if (!verifyTotpCode(code, secret)) {
    return { success: false, error: 'Invalid verification code. Please try again.' }
  }

  const encryptedSecret = encryptSecret(secret)
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: encryptedSecret },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValues: { totpAuthenticator: 'disabled' },
    newValues: { totpAuthenticator: 'enabled' },
    userId: user.id,
  })

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Remove the TOTP authenticator app from the user account.
 * Requires password confirmation. Email MFA remains active.
 */
export async function removeTotpAuthenticator(
  password: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, email: true, name: true, passwordHash: true, mfaSecret: true },
  })

  if (!user) return { success: false, error: 'User not found' }
  if (!user.mfaSecret) return { success: false, error: 'Authenticator app is not configured' }
  if (!user.passwordHash) return { success: false, error: 'Cannot verify password' }

  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) return { success: false, error: 'Invalid password' }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: null, mfaDefault: 'email' },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValues: { totpAuthenticator: 'enabled' },
    newValues: { totpAuthenticator: 'disabled' },
    userId: user.id,
  })

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Set the user's default MFA method for login.
 * Only allows setting 'totp' if an authenticator app is configured.
 */
export async function setMfaDefault(
  method: 'email' | 'totp'
): Promise<{ success: boolean; error?: string }> {
  const authResult = await requireAuth()
  if (!authResult.authorized || !authResult.userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { id: true, mfaEnabled: true, mfaSecret: true },
  })

  if (!user) return { success: false, error: 'User not found' }
  if (!user.mfaEnabled) return { success: false, error: 'MFA is not enabled' }
  if (method === 'totp' && !user.mfaSecret) {
    return { success: false, error: 'Authenticator app is not configured' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaDefault: method },
  })

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Cleanup expired and used tokens.
 * Intended to be called from a cron job or scheduled task.
 */
export async function cleanupExpiredTokens(): Promise<{ deleted: number }> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = await prisma.emailToken.deleteMany({
    where: {
      OR: [
        // Delete expired tokens
        { expires: { lt: new Date() } },
        // Delete used tokens older than 24 hours
        {
          used: true,
          createdAt: { lt: twentyFourHoursAgo },
        },
      ],
    },
  })

  return { deleted: result.count }
}
