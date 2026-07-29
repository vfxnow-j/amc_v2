'use server'

import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { sendMfaOtp } from './mfa'
import { validateTrustToken } from '@/lib/mfa-trust'

export type ValidateCredentialsResult = {
  success: boolean
  mfaRequired: boolean
  mfaMethods?: ('email' | 'totp')[]
  mfaDefault?: 'email' | 'totp'
  userId?: string
  error?: string
}

/**
 * Pre-validate credentials without signing in.
 * If MFA is enabled, checks for a valid trust token before sending OTP.
 * Rate-limited to 5 attempts per 15 minutes per email.
 */
export async function validateCredentials(
  email: string,
  password: string
): Promise<ValidateCredentialsResult> {
  try {
    if (!email || !password) {
      return { success: false, mfaRequired: false, error: 'Email and password are required.' }
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Rate limit: 5 attempts per 15 minutes per email
    const limit = checkRateLimit('login', normalizedEmail, 5, 15 * 60 * 1000)
    if (!limit.allowed) {
      return {
        success: false,
        mfaRequired: false,
        error: `Too many login attempts. Please try again in ${limit.retryAfterSeconds} seconds.`,
      }
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecret: true, mfaDefault: true, email: true },
    })

    if (!user || !user.passwordHash) {
      // Dummy bcrypt compare to prevent timing-based enumeration
      await bcrypt.compare(password, '$2a$12$x'.padEnd(60, '0'))
      return { success: false, mfaRequired: false, error: 'Invalid email or password.' }
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return { success: false, mfaRequired: false, error: 'Invalid email or password.' }
    }

    if (user.mfaEnabled) {
      // Check for valid trust token cookie
      const cookieStore = await cookies()
      const trustCookie = cookieStore.get('mfa_trust')

      if (trustCookie?.value) {
        const isTrusted = await validateTrustToken(trustCookie.value, user.id)
        if (isTrusted) {
          return { success: true, mfaRequired: false, userId: user.id }
        }
      }

      // Determine available MFA methods and user's default
      const mfaMethods: ('email' | 'totp')[] = ['email']
      if (user.mfaSecret) {
        mfaMethods.push('totp')
      }

      // Resolve default: use stored preference if the method is available, otherwise fall back
      let mfaDefault: 'email' | 'totp' = 'email'
      if (user.mfaDefault === 'totp' && user.mfaSecret) {
        mfaDefault = 'totp'
      }

      // Auto-send email OTP if the default method is email (user goes straight to code entry)
      if (mfaDefault === 'email') {
        await sendMfaOtp(user.email)
      }

      return { success: true, mfaRequired: true, mfaMethods, mfaDefault, userId: user.id }
    }

    return { success: true, mfaRequired: false, userId: user.id }
  } catch (error) {
    console.error('Credential validation error:', error)
    return { success: false, mfaRequired: false, error: 'An error occurred. Please try again.' }
  }
}
