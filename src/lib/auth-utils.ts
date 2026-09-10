import { auth, hasRole, isAdmin, isSuperAdmin, canEdit, isFlowUser } from './auth'
import type { UserRole } from '@/generated/prisma/client'

/**
 * A discriminated union rather than one object with optional fields: past the
 * `authorized` check the caller has a userId and a role, and the compiler knows
 * it. The optional-field version type-checked `authResult.userId` on the
 * unauthorized branch and handed `string | undefined` to every Prisma write
 * that records who did something.
 */
export type AuthResult =
  | { authorized: true; userId: string; role: UserRole; error?: undefined }
  | { authorized: false; userId?: undefined; role?: undefined; error: string }

/**
 * Check if the current user is authenticated
 */
export async function requireAuth(): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role: session.user.role,
  }
}

/**
 * Check if the current user has at least the required role
 */
export async function requireRole(requiredRole: UserRole): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  if (!hasRole(session.user.role, requiredRole)) {
    return { authorized: false, error: 'Insufficient permissions' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role: session.user.role,
  }
}

/**
 * Check if the current user is an admin
 */
export async function requireAdmin(): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  if (!isAdmin(session.user.role)) {
    return { authorized: false, error: 'Admin access required' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role: session.user.role,
  }
}

/**
 * Check if the current user is a super admin
 */
export async function requireSuperAdmin(): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  if (!isSuperAdmin(session.user.role)) {
    return { authorized: false, error: 'Super admin access required' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role: session.user.role,
  }
}

/**
 * Check if the current user can edit (Admin or Staff)
 */
export async function requireEditor(): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  if (!canEdit(session.user.role)) {
    return { authorized: false, error: 'Edit access required' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role: session.user.role,
  }
}

/**
 * Allow either an editor (STAFF+) or a FLOW_USER. Used by Flow server actions
 * where FLOW_USER is permitted to mutate within their scoped data set, while
 * VIEWER is still rejected.
 */
export async function requireFlowEditor(): Promise<AuthResult> {
  const session = await auth()

  if (!session?.user?.id) {
    return { authorized: false, error: 'Unauthorized' }
  }

  const role = session.user.role
  if (!canEdit(role) && !isFlowUser(role)) {
    return { authorized: false, error: 'Flow access required' }
  }

  return {
    authorized: true,
    userId: session.user.id,
    role,
  }
}
