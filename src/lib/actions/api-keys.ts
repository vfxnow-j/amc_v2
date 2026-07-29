'use server'

import crypto from 'crypto'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import type { UserRole } from '@/generated/prisma/client'

export type CreateApiKeyData = {
  name: string
  role: UserRole
  expiresAt?: Date | string
}

export async function createApiKey(data: CreateApiKeyData) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const randomPart = crypto.randomBytes(20).toString('hex')
  const rawKey = `vfx_${randomPart}`
  const prefix = rawKey.slice(0, 12)
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

  const apiKey = await prisma.apiKey.create({
    data: {
      name: data.name,
      keyHash,
      prefix,
      role: data.role,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      createdById: authResult.userId!,
    },
  })

  revalidatePath('/dashboard/settings/api-keys')

  return {
    ...serialize(apiKey),
    rawKey,
  }
}

export async function getApiKeys() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const keys = await prisma.apiKey.findMany({
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(keys)
}

export async function getApiKey(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const key = await prisma.apiKey.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })

  return serialize(key)
}

export async function updateApiKey(id: string, data: {
  name?: string
  role?: UserRole
  isActive?: boolean
  expiresAt?: Date | string | null
}) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const key = await prisma.apiKey.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }),
    },
  })

  revalidatePath('/dashboard/settings/api-keys')
  return serialize(key)
}

export async function revokeApiKey(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  })

  revalidatePath('/dashboard/settings/api-keys')
}

export async function deleteApiKey(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.apiKey.delete({ where: { id } })

  revalidatePath('/dashboard/settings/api-keys')
}

export async function regenerateApiKey(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const oldKey = await prisma.apiKey.findUnique({ where: { id } })
  if (!oldKey) throw new Error('API key not found')

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  })

  return createApiKey({
    name: oldKey.name,
    role: oldKey.role as UserRole,
    expiresAt: oldKey.expiresAt || undefined,
  })
}
