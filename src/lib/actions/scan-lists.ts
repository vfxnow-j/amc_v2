'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { auth } from '@/lib/auth'
import { serialize } from '@/lib/utils'
import type { ScanResult } from './reservations'

export async function createScanList(data: { name: string; description?: string }) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const session = await auth()
  const userId = session!.user!.id!

  const list = await prisma.scanList.create({
    data: {
      name: data.name,
      description: data.description,
      createdById: userId,
    },
  })

  revalidatePath('/dashboard/scan-lists')
  revalidatePath('/dashboard/mobile')
  return serialize(list)
}

export async function addToListByBarcode(listId: string, barcode: string): Promise<ScanResult> {
  try {
    const authResult = await requireEditor()
    if (!authResult.authorized) return { success: false, error: authResult.error || 'Unauthorized' }

    const session = await auth()
    const userId = session?.user?.id

    // Dedup by (listId, barcode) — handles both known and unknown
    const existing = await prisma.scanListItem.findUnique({
      where: { listId_barcode: { listId, barcode } },
    })
    if (existing) {
      return { success: false, error: `${barcode} is already on this list` }
    }

    const assetUnit = await prisma.assetUnit.findUnique({
      where: { barcode },
      select: { id: true },
    })

    await prisma.scanListItem.create({
      data: {
        listId,
        assetUnitId: assetUnit?.id ?? null,
        barcode,
        scannedById: userId,
      },
    })

    revalidatePath('/dashboard/scan-lists')
    revalidatePath(`/dashboard/scan-lists/${listId}`)

    if (!assetUnit) {
      return { success: true, warning: 'Unknown barcode — saved as unregistered' }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add to list' }
  }
}

export async function getScanLists() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const lists = await prisma.scanList.findMany({
    include: {
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(lists)
}

export async function getScanList(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const list = await prisma.scanList.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { scannedAt: 'desc' },
      },
    },
  })

  if (!list) return null

  // Batch fetch asset unit details (skip items with no matching unit)
  const unitIds = list.items
    .map(item => item.assetUnitId)
    .filter((id): id is string => id !== null)
  const units = unitIds.length > 0
    ? await prisma.assetUnit.findMany({
        where: { id: { in: unitIds } },
        include: {
          asset: { select: { id: true, name: true, manufacturer: true, model: true } },
          location: { select: { id: true, name: true } },
        },
      })
    : []

  const unitMap = new Map(units.map(u => [u.id, u]))

  const enrichedItems = list.items.map(item => ({
    ...item,
    assetUnit: item.assetUnitId ? unitMap.get(item.assetUnitId) ?? null : null,
  }))

  return serialize({ ...list, items: enrichedItems })
}

export async function removeScanListItem(itemId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const item = await prisma.scanListItem.findUnique({ where: { id: itemId } })
  if (!item) throw new Error('Item not found')

  await prisma.scanListItem.delete({ where: { id: itemId } })

  revalidatePath('/dashboard/scan-lists')
  return { success: true }
}

export async function deleteScanList(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.scanList.delete({ where: { id } })

  revalidatePath('/dashboard/scan-lists')
  revalidatePath('/dashboard/mobile')
  return { success: true }
}
