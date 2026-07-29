'use server'

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { hashPassword, validatePassword } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { passwordResetEmail } from '@/lib/email/templates'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { logAudit } from './audit'

const RESET_EXPIRY_HOURS = 1
const RESET_RATE_LIMIT_SECONDS = 120

/**
 * Request a password reset email.
 * Always returns success to prevent email enumeration.
 */
export async function requestPasswordReset(
  email: string
): Promise<{ success: boolean }> {
  const normalizedEmail = email.toLowerCase().trim()

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true },
  })

  // If no user found, return success to prevent enumeration
  if (!user) {
    return { success: true }
  }

  // Rate limit: check if a reset was requested in the last 120 seconds
  const rateLimitCutoff = new Date(
    Date.now() - RESET_RATE_LIMIT_SECONDS * 1000
  )
  const recentToken = await prisma.emailToken.findFirst({
    where: {
      identifier: normalizedEmail,
      type: 'PASSWORD_RESET',
      createdAt: { gt: rateLimitCutoff },
    },
  })

  if (recentToken) {
    // Silently return success to prevent timing attacks
    return { success: true }
  }

  // Invalidate all previous unused reset tokens for this email
  await prisma.emailToken.updateMany({
    where: {
      identifier: normalizedEmail,
      type: 'PASSWORD_RESET',
      used: false,
    },
    data: { used: true },
  })

  // Generate a secure random token
  const token = crypto.randomBytes(32).toString('hex')

  // Create the reset token with 1-hour expiry
  await prisma.emailToken.create({
    data: {
      identifier: normalizedEmail,
      token,
      type: 'PASSWORD_RESET',
      expires: new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000),
    },
  })

  // Send the password reset email
  const emailContent = passwordResetEmail(user.name || 'there', token)
  await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  return { success: true }
}

/**
 * Reset a user's password using a valid reset token.
 * Rate-limited to 5 attempts per 15 minutes per token prefix.
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Rate limit reset attempts (use first 8 chars of token as key)
  const limit = checkRateLimit('password-reset', token.slice(0, 8), 5, 15 * 60 * 1000)
  if (!limit.allowed) {
    return { success: false, error: 'Too many attempts. Please try again later.' }
  }

  // Validate password strength before DB work
  const validation = validatePassword(newPassword)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join(' ') }
  }

  // Hash the new password
  const passwordHash = await hashPassword(newPassword)

  // Atomic: find token, update user, mark token used — all inside transaction
  const result = await prisma.$transaction(async (tx) => {
    // Atomically consume the token
    const consumed = await tx.emailToken.updateMany({
      where: {
        token,
        type: 'PASSWORD_RESET',
        used: false,
        expires: { gt: new Date() },
      },
      data: { used: true },
    })

    if (consumed.count === 0) {
      return null
    }

    // Get the token record to find the email
    const tokenRecord = await tx.emailToken.findFirst({
      where: { token, type: 'PASSWORD_RESET' },
      select: { identifier: true },
    })

    if (!tokenRecord) return null

    // Update the user's password
    const user = await tx.user.update({
      where: { email: tokenRecord.identifier },
      data: { passwordHash, passwordChangedAt: new Date() },
      select: { id: true },
    })

    return { userId: user.id }
  })

  if (!result) {
    return { success: false, error: 'Invalid or expired reset link.' }
  }

  // Log the password reset audit event
  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: result.userId,
    userId: result.userId,
    newValues: { passwordReset: true },
  })

  return { success: true }
}
