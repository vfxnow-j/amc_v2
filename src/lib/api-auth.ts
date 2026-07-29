import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { hasRole, isAdmin, canEdit } from '@/lib/auth'
import type { UserRole } from '@/generated/prisma/client'

export type ApiAuthResult = {
  authorized: boolean
  userId?: string
  role?: UserRole
  apiKeyId?: string
  error?: string
  status?: number
}

export async function validateApiKey(request: NextRequest): Promise<ApiAuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: 'Missing or invalid Authorization header', status: 401 }
  }

  const rawKey = authHeader.slice(7)

  if (!rawKey || rawKey.length < 10) {
    return { authorized: false, error: 'Invalid API key format', status: 401 }
  }

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  })

  if (!apiKey) {
    return { authorized: false, error: 'Invalid API key', status: 401 }
  }

  if (!apiKey.isActive) {
    return { authorized: false, error: 'API key is deactivated', status: 401 }
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { authorized: false, error: 'API key has expired', status: 401 }
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return {
    authorized: true,
    userId: apiKey.createdById,
    role: apiKey.role as UserRole,
    apiKeyId: apiKey.id,
  }
}

export function requireApiRole(auth: ApiAuthResult, requiredRole: UserRole): ApiAuthResult {
  if (!auth.authorized) return auth
  if (!auth.role || !hasRole(auth.role, requiredRole)) {
    return { authorized: false, error: 'Insufficient permissions', status: 403 }
  }
  return auth
}

export function requireApiAdmin(auth: ApiAuthResult): ApiAuthResult {
  if (!auth.authorized) return auth
  if (!auth.role || !isAdmin(auth.role)) {
    return { authorized: false, error: 'Admin access required', status: 403 }
  }
  return auth
}

export function requireApiEditor(auth: ApiAuthResult): ApiAuthResult {
  if (!auth.authorized) return auth
  if (!auth.role || !canEdit(auth.role)) {
    return { authorized: false, error: 'Edit access required', status: 403 }
  }
  return auth
}

export function apiError(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiSuccess<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json({ data }, { status })
}

export function apiPaginated<T>(data: T[], pagination: { page: number; limit: number; total: number }): NextResponse {
  return NextResponse.json({
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  })
}

export function parsePagination(request: NextRequest): { page: number; limit: number; offset: number } {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

export function parseSearchParams(request: NextRequest): URLSearchParams {
  return new URL(request.url).searchParams
}
