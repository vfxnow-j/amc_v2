'use server'

import crypto from 'crypto'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { hashPassword, validatePassword } from '@/lib/auth'
import { requireAuth, requireAdmin, requireSuperAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { sendEmail } from '@/lib/email'
import { accountInviteEmail } from '@/lib/email/templates'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { logAudit } from './audit'
import type { UserRole } from '@/generated/prisma/client'

// ============================================
// TYPES
// ============================================

export type UserFormData = {
  email: string
  name: string
  password?: string
  role: UserRole
}

const SETUP_TOKEN_EXPIRY_HOURS = 72

// ============================================
// GET STAFF (lightweight, for dropdowns)
// ============================================

export async function getStaffUsers() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })
  return serialize(users)
}

// ============================================
// GET USERS
// ============================================

export async function getUsers(search?: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const users = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      image: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          checkoutsCreated: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Convert passwordHash to boolean flag
  return serialize(users.map(u => ({ ...u, passwordHash: !!u.passwordHash })))
}

// ============================================
// GET USER
// ============================================

export async function getUser(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      image: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Return boolean flag instead of the actual hash
  return serialize({ ...user, passwordHash: !!user.passwordHash })
}

// ============================================
// CREATE USER
// ============================================

export async function createUser(data: UserFormData) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Validate email
  if (!data.email || !data.email.includes('@')) {
    throw new Error('Valid email is required')
  }

  // Check if email already exists
  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  })

  if (existing) {
    throw new Error('Email already in use')
  }

  // Create user without password — they will set it via setup link
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      role: data.role,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  })

  // Generate a secure setup token
  const token = crypto.randomBytes(32).toString('hex')

  // Invalidate any existing setup tokens for this email
  await prisma.emailToken.updateMany({
    where: {
      identifier: user.email,
      type: 'ACCOUNT_SETUP',
      used: false,
    },
    data: { used: true },
  })

  // Create the setup token with 72-hour expiry
  await prisma.emailToken.create({
    data: {
      identifier: user.email,
      token,
      type: 'ACCOUNT_SETUP',
      expires: new Date(Date.now() + SETUP_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
    },
  })

  // Send the invite email
  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    STAFF: 'Staff',
    VIEWER: 'Viewer',
    FLOW_USER: 'Flow User',
  }
  const emailContent = accountInviteEmail(user.name, token, roleLabels[user.role] || user.role)
  const emailResult = await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  if (!emailResult.success) {
    console.error(`Failed to send invite email to ${user.email}:`, emailResult.error)
  }

  // Log audit event
  await logAudit({
    action: 'CREATE',
    entityType: 'User',
    entityId: user.id,
    newValues: { email: user.email, name: user.name, role: user.role, invited: true },
  })

  revalidatePath('/dashboard/settings/users')

  return serialize(user)
}

// ============================================
// RESEND INVITE
// ============================================

export async function resendInvite(userId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, passwordHash: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Only allow resend for users who haven't set up their account yet
  if (user.passwordHash) {
    throw new Error('User has already set up their account')
  }

  // Invalidate existing setup tokens
  await prisma.emailToken.updateMany({
    where: {
      identifier: user.email,
      type: 'ACCOUNT_SETUP',
      used: false,
    },
    data: { used: true },
  })

  // Generate a new token
  const token = crypto.randomBytes(32).toString('hex')

  await prisma.emailToken.create({
    data: {
      identifier: user.email,
      token,
      type: 'ACCOUNT_SETUP',
      expires: new Date(Date.now() + SETUP_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
    },
  })

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    STAFF: 'Staff',
    VIEWER: 'Viewer',
    FLOW_USER: 'Flow User',
  }
  const emailContent = accountInviteEmail(user.name, token, roleLabels[user.role] || user.role)
  await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  return { success: true }
}

// ============================================
// SETUP ACCOUNT (public, token-based)
// ============================================

export async function setupAccount(
  token: string,
  newPassword: string,
  enableMfa: boolean
): Promise<{ success: boolean; error?: string }> {
  // Rate limit setup attempts
  const limit = checkRateLimit('account-setup', token.slice(0, 8), 5, 15 * 60 * 1000)
  if (!limit.allowed) {
    return { success: false, error: 'Too many attempts. Please try again later.' }
  }

  // Validate password strength
  const validation = validatePassword(newPassword)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join(' ') }
  }

  const passwordHash = await hashPassword(newPassword)

  // Atomic: consume token, set password
  const result = await prisma.$transaction(async (tx) => {
    const consumed = await tx.emailToken.updateMany({
      where: {
        token,
        type: 'ACCOUNT_SETUP',
        used: false,
        expires: { gt: new Date() },
      },
      data: { used: true },
    })

    if (consumed.count === 0) {
      return null
    }

    const tokenRecord = await tx.emailToken.findFirst({
      where: { token, type: 'ACCOUNT_SETUP' },
      select: { identifier: true },
    })

    if (!tokenRecord) return null

    const user = await tx.user.update({
      where: { email: tokenRecord.identifier },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mfaEnabled: enableMfa,
      },
      select: { id: true, email: true, name: true },
    })

    return user
  })

  if (!result) {
    return { success: false, error: 'Invalid or expired setup link. Please contact your administrator.' }
  }

  // If MFA was enabled, send the first OTP so they can verify at login
  // (no need here — they'll get prompted at first login)

  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: result.id,
    userId: result.id,
    newValues: { accountSetup: true, mfaEnabled: enableMfa },
  })

  return { success: true }
}

// ============================================
// VALIDATE SETUP TOKEN (public, for the setup page)
// ============================================

export async function validateSetupToken(
  token: string
): Promise<{ valid: boolean; name?: string; email?: string }> {
  const tokenRecord = await prisma.emailToken.findFirst({
    where: {
      token,
      type: 'ACCOUNT_SETUP',
      used: false,
      expires: { gt: new Date() },
    },
    select: { identifier: true },
  })

  if (!tokenRecord) {
    return { valid: false }
  }

  const user = await prisma.user.findUnique({
    where: { email: tokenRecord.identifier },
    select: { name: true, email: true, passwordHash: true },
  })

  if (!user) {
    return { valid: false }
  }

  // If user already has a password, the token shouldn't be usable
  if (user.passwordHash) {
    return { valid: false }
  }

  return { valid: true, name: user.name, email: user.email }
}

// ============================================
// UPDATE USER
// ============================================

export async function updateUser(id: string, data: Partial<UserFormData>) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Check user exists
  const existing = await prisma.user.findUnique({
    where: { id },
  })

  if (!existing) {
    throw new Error('User not found')
  }

  // Check email uniqueness if changing email
  if (data.email && data.email.toLowerCase() !== existing.email) {
    const emailExists = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    })

    if (emailExists) {
      throw new Error('Email already in use')
    }
  }

  // Only SUPER_ADMIN can change roles to/from ADMIN or SUPER_ADMIN
  if (data.role && data.role !== existing.role) {
    const involvesAdmin =
      data.role === 'ADMIN' || data.role === 'SUPER_ADMIN' ||
      existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN'
    if (involvesAdmin) {
      const superAdminCheck = await requireSuperAdmin()
      if (!superAdminCheck.authorized) {
        throw new Error('Only super admins can change admin-level roles')
      }
    }
  }

  // Build update data
  const updateData: {
    email?: string
    name?: string
    role?: UserRole
    passwordHash?: string
  } = {}

  if (data.email) {
    updateData.email = data.email.toLowerCase()
  }

  if (data.name) {
    updateData.name = data.name
  }

  if (data.role) {
    updateData.role = data.role
  }

  // Handle password change
  if (data.password) {
    const passwordValidation = validatePassword(data.password)
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join('. '))
    }

    updateData.passwordHash = await hashPassword(data.password)
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  })

  // Log audit event
  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValues: { email: existing.email, name: existing.name, role: existing.role },
    newValues: { email: user.email, name: user.name, role: user.role },
  })

  revalidatePath('/dashboard/settings/users')

  return serialize(user)
}

// ============================================
// DELETE USER
// ============================================

export async function deleteUser(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  // Prevent self-deletion
  if (authResult.userId === id) {
    throw new Error('Cannot delete your own account')
  }

  // Check user exists
  const existing = await prisma.user.findUnique({
    where: { id },
  })

  if (!existing) {
    throw new Error('User not found')
  }

  // Only SUPER_ADMIN can delete ADMIN or SUPER_ADMIN users
  if (existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN') {
    const superAdminCheck = await requireSuperAdmin()
    if (!superAdminCheck.authorized) {
      throw new Error('Only super admins can remove admin accounts')
    }
  }

  await prisma.$transaction(async (tx) => {
    // Reassign non-nullable FK references to the admin performing the deletion
    const adminId = authResult.userId!

    // Checkouts created by this user → reassign to admin
    await tx.checkout.updateMany({
      where: { createdById: id },
      data: { createdById: adminId },
    })

    // Checkout approvals → reassign to admin
    await tx.checkoutApproval.updateMany({
      where: { approverId: id },
      data: { approverId: adminId },
    })

    // API keys created by this user → reassign to admin
    await tx.apiKey.updateMany({
      where: { createdById: id },
      data: { createdById: adminId },
    })

    // Flow task comments → reassign to admin
    await tx.flowTaskComment.updateMany({
      where: { authorId: id },
      data: { authorId: adminId },
    })

    // Inventory audits created by this user → reassign to admin
    await tx.inventoryAudit.updateMany({
      where: { createdById: id },
      data: { createdById: adminId },
    })

    // Nullify optional FK references
    await tx.checkout.updateMany({
      where: { checkedInById: id },
      data: { checkedInById: null },
    })
    await tx.reservation.updateMany({
      where: { preparedById: id },
      data: { preparedById: null },
    })
    await tx.lead.updateMany({
      where: { assignedToId: id },
      data: { assignedToId: null },
    })
    await tx.auditLog.updateMany({
      where: { userId: id },
      data: { userId: null },
    })
    await tx.statusHistory.updateMany({
      where: { changedById: id },
      data: { changedById: null },
    })
    await tx.flowTask.updateMany({
      where: { createdById: id },
      data: { createdById: null },
    })
    await tx.leadActivity.updateMany({
      where: { createdById: id },
      data: { createdById: null },
    })
    await tx.reservation.updateMany({
      where: { createdById: id },
      data: { createdById: null },
    })

    // Now delete the user (cascading relations like sessions, accounts, tokens, trust tokens, notifications will auto-delete)
    await tx.user.delete({ where: { id } })
  })

  // Log audit event
  await logAudit({
    action: 'DELETE',
    entityType: 'User',
    entityId: id,
    oldValues: { email: existing.email, name: existing.name, role: existing.role },
  })

  revalidatePath('/dashboard/settings/users')

  return { success: true }
}

// ============================================
// CHANGE PASSWORD (for user profile)
// ============================================

export async function changePassword(
  currentPassword: string,
  newPassword: string
) {
  const { auth } = await import('@/lib/auth')
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })

  if (!user?.passwordHash) {
    throw new Error('Password not set')
  }

  // Verify current password
  const { verifyPassword } = await import('@/lib/auth')
  const isValid = await verifyPassword(currentPassword, user.passwordHash)

  if (!isValid) {
    throw new Error('Current password is incorrect')
  }

  // Validate new password
  const passwordValidation = validatePassword(newPassword)
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.errors.join('. '))
  }

  // Update password and revoke trust tokens
  const passwordHash = await hashPassword(newPassword)

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  })

  // Revoke all MFA trust tokens on password change
  await prisma.mfaTrustToken.deleteMany({
    where: { userId: session.user.id },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'User',
    entityId: session.user.id,
    userId: session.user.id,
    newValues: { passwordChanged: true },
  })

  return { success: true }
}
