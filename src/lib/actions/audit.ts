'use server'

import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireAuth } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'CHECKOUT'
  | 'CHECKIN'
  | 'APPROVE'
  | 'REJECT'
  | 'IMPORT'
  | 'EXPORT'

export type AuditEntityType =
  | 'User'
  | 'Asset'
  | 'Checkout'
  | 'Reservation'
  | 'Client'
  | 'Invoice'
  | 'Payment'
  | 'Category'
  | 'Location'
  | 'Vendor'
  | 'PurchaseOrder'
  | 'MaintenanceRecord'
  | 'Lead'
  | 'InventoryAudit'
  | 'ScanList'
  | 'Settings'
  | 'System'

export type LogAuditParams = {
  action: AuditAction
  entityType: AuditEntityType
  entityId?: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  userId?: string
}

/**
 * Log an audit event
 */
export async function logAudit(params: LogAuditParams) {
  const { action, entityType, entityId, oldValues, newValues, userId } = params

  // Get IP and user agent from headers
  const headersList = await headers()
  const ipAddress = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
  const userAgent = headersList.get('user-agent') || undefined

  // Get current user if not provided
  let finalUserId = userId
  if (!finalUserId) {
    try {
      const authResult = await requireAuth()
      if (authResult.authorized && authResult.userId) {
        finalUserId = authResult.userId
      }
    } catch {
      // User not authenticated, that's fine for some operations
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: finalUserId,
      action,
      entityType,
      entityId,
      oldValues: oldValues ? JSON.parse(JSON.stringify(oldValues)) : undefined,
      newValues: newValues ? JSON.parse(JSON.stringify(newValues)) : undefined,
      ipAddress,
      userAgent,
    },
  })
}

export type AuditLogFilters = {
  action?: string
  entityType?: string
  userId?: string
  startDate?: Date
  endDate?: Date
  search?: string
}

/**
 * Get audit logs with filtering and pagination
 */
export async function getAuditLogs(
  filters: AuditLogFilters = {},
  page = 1,
  pageSize = 50
) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const { action, entityType, userId, startDate, endDate, search } = filters

  const where: Record<string, unknown> = {}

  if (action) {
    where.action = action
  }

  if (entityType) {
    where.entityType = entityType
  }

  if (userId) {
    where.userId = userId
  }

  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) {
      (where.createdAt as Record<string, unknown>).gte = startDate
    }
    if (endDate) {
      (where.createdAt as Record<string, unknown>).lte = endDate
    }
  }

  if (search) {
    where.OR = [
      { entityId: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs: serialize(logs),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}

/**
 * Get unique values for filters
 */
export async function getAuditLogFilterOptions() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const [actions, entityTypes, users] = await Promise.all([
    prisma.auditLog.findMany({
      select: { action: true },
      distinct: ['action'],
    }),
    prisma.auditLog.findMany({
      select: { entityType: true },
      distinct: ['entityType'],
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entityType),
    users: serialize(users),
  }
}

/**
 * Get audit log for a specific entity
 */
export async function getEntityAuditLog(entityType: string, entityId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) {
    throw new Error(authResult.error)
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(logs)
}
