'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'

// ============================================
// SERVICE CATALOG
// ============================================

export type ServiceFormData = {
  name: string
  description?: string
  defaultRate: number
  unit?: string
}

export async function getServices(search?: string) {
  const services = await prisma.service.findMany({
    where: search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined,
    include: {
      _count: {
        select: { items: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return serialize(services)
}

export async function getService(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const service = await prisma.service.findUnique({ where: { id } })
  if (!service) throw new Error('Service not found')
  return serialize(service)
}

export async function createService(data: ServiceFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const service = await prisma.service.create({
    data: {
      name: data.name,
      description: data.description || null,
      defaultRate: data.defaultRate,
      unit: data.unit || 'Flat',
    },
  })

  revalidatePath('/dashboard/services')
  return serialize(service)
}

export async function updateService(id: string, data: Partial<ServiceFormData> & { active?: boolean }) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const service = await prisma.service.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description || null }),
      ...(data.defaultRate !== undefined && { defaultRate: data.defaultRate }),
      ...(data.unit !== undefined && { unit: data.unit }),
      ...(data.active !== undefined && { active: data.active }),
    },
  })

  revalidatePath('/dashboard/services')
  return serialize(service)
}

export async function deleteService(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const usageCount = await prisma.reservationItem.count({ where: { serviceId: id } })
  if (usageCount > 0) {
    throw new Error(`Cannot delete service — it is used in ${usageCount} order item(s)`)
  }

  await prisma.service.delete({ where: { id } })

  revalidatePath('/dashboard/services')
}

export async function searchServices(query: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  if (!query || query.length < 2) return []

  const services = await prisma.service.findMany({
    where: {
      active: true,
      name: { contains: query, mode: 'insensitive' },
    },
    orderBy: { name: 'asc' },
    take: 10,
  })

  return serialize(services)
}
