'use server'

import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'

export async function recordStatusChange(params: {
  entityType: 'RESERVATION' | 'CHECKOUT' | 'INVOICE'
  entityId: string
  fromStatus: string | null
  toStatus: string
  changedById?: string
  notes?: string
}) {
  const record = await prisma.statusHistory.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      changedById: params.changedById || null,
      notes: params.notes || null,
    },
  })

  return serialize(record)
}

export async function getStatusHistory(entityType: string, entityId: string) {
  const history = await prisma.statusHistory.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'asc' },
    include: {
      changedBy: { select: { name: true } },
    },
  })

  return serialize(history)
}
