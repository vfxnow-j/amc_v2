'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import type { CloudProductCategory } from '@/generated/prisma/enums'

type CloudProductFormData = {
  category: CloudProductCategory
  name: string
  description?: string | null
  costHourly?: number
  costDaily?: number
  costWeekly?: number
  costMonthly?: number
  sellHourly?: number | null
  sellDaily?: number | null
  sellWeekly?: number | null
  sellMonthly?: number | null
  marginPercent?: number
  active?: boolean
  sortOrder?: number
}

export async function getCloudProducts(params?: { category?: CloudProductCategory; includeInactive?: boolean }) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const products = await prisma.cloudProduct.findMany({
    where: {
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })

  return serialize(products)
}

export async function getCloudProduct(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const product = await prisma.cloudProduct.findUnique({ where: { id } })
  return product ? serialize(product) : null
}

export async function createCloudProduct(data: CloudProductFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const product = await prisma.cloudProduct.create({
    data: {
      category: data.category,
      name: data.name.trim(),
      description: data.description || null,
      costHourly: data.costHourly ?? 0,
      costDaily: data.costDaily ?? 0,
      costWeekly: data.costWeekly ?? 0,
      costMonthly: data.costMonthly ?? 0,
      sellHourly: data.sellHourly ?? null,
      sellDaily: data.sellDaily ?? null,
      sellWeekly: data.sellWeekly ?? null,
      sellMonthly: data.sellMonthly ?? null,
      marginPercent: data.marginPercent ?? 25,
      active: data.active ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  })

  revalidatePath('/dashboard/pricing/cloud')
  revalidatePath('/dashboard/pricing')
  return serialize(product)
}

export async function updateCloudProduct(id: string, data: Partial<CloudProductFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const product = await prisma.cloudProduct.update({
    where: { id },
    data: {
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.costHourly !== undefined ? { costHourly: data.costHourly } : {}),
      ...(data.costDaily !== undefined ? { costDaily: data.costDaily } : {}),
      ...(data.costWeekly !== undefined ? { costWeekly: data.costWeekly } : {}),
      ...(data.costMonthly !== undefined ? { costMonthly: data.costMonthly } : {}),
      ...(data.sellHourly !== undefined ? { sellHourly: data.sellHourly } : {}),
      ...(data.sellDaily !== undefined ? { sellDaily: data.sellDaily } : {}),
      ...(data.sellWeekly !== undefined ? { sellWeekly: data.sellWeekly } : {}),
      ...(data.sellMonthly !== undefined ? { sellMonthly: data.sellMonthly } : {}),
      ...(data.marginPercent !== undefined ? { marginPercent: data.marginPercent } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  })

  revalidatePath('/dashboard/pricing/cloud')
  revalidatePath('/dashboard/pricing')
  revalidatePath(`/dashboard/pricing/cloud/${id}`)
  return serialize(product)
}

export async function deleteCloudProduct(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  // Soft-delete by deactivating if referenced elsewhere; hard delete otherwise
  const refs = await prisma.reservationItem.count({ where: { cloudProductId: id } })
  if (refs > 0) {
    await prisma.cloudProduct.update({ where: { id }, data: { active: false } })
    revalidatePath('/dashboard/pricing/cloud')
  revalidatePath('/dashboard/pricing')
    return { success: true, softDeleted: true }
  }

  await prisma.cloudProduct.delete({ where: { id } })
  revalidatePath('/dashboard/pricing/cloud')
  revalidatePath('/dashboard/pricing')
  return { success: true, softDeleted: false }
}

