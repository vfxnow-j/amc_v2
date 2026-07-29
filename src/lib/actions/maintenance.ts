'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { serialize } from '@/lib/utils'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import type { MaintenanceStatus, MaintenanceType } from '@/lib/types'

export type MaintenanceFormData = {
  assetUnitId: string
  type: MaintenanceType
  description: string
  scheduledDate?: Date
  performedBy?: string
  vendorId?: string
  laborCost?: number
  partsCost?: number
  partsUsed?: string
  fromCheckoutId?: string
  damageDescription?: string
  returnToInventory?: boolean
}

export type MaintenanceFilters = {
  search?: string
  status?: MaintenanceStatus
  type?: MaintenanceType
  assetUnitId?: string
}

export async function getMaintenanceRecords(filters: MaintenanceFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Auto-reconcile: create records for units in MAINTENANCE with no active maintenance record
  await reconcileOrphanMaintenanceUnits()

  const { search, status, type, assetUnitId } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { assetUnit: { asset: { name: { contains: search, mode: 'insensitive' } } } },
      { assetUnit: { barcode: { contains: search, mode: 'insensitive' } } },
      { performedBy: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (status) {
    where.status = status
  }

  if (type) {
    where.type = type
  }

  if (assetUnitId) {
    where.assetUnitId = assetUnitId
  }

  const records = await prisma.maintenanceRecord.findMany({
    where,
    include: {
      assetUnit: {
        select: {
          id: true,
          barcode: true,
          asset: {
            select: {
              id: true,
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(records)
}

/**
 * Find units with status=MAINTENANCE that have no SCHEDULED/IN_PROGRESS maintenance record
 * and create a record for them so they appear on the maintenance page.
 */
async function reconcileOrphanMaintenanceUnits() {
  try {
    const orphanUnits = await prisma.assetUnit.findMany({
      where: {
        status: 'MAINTENANCE',
        maintenanceRecords: {
          none: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        },
      },
      select: { id: true },
    })

    if (orphanUnits.length === 0) return

    await prisma.maintenanceRecord.createMany({
      data: orphanUnits.map((u) => ({
        assetUnitId: u.id,
        type: 'INSPECTION' as const,
        status: 'SCHEDULED' as const,
        description: 'Unit flagged for maintenance — pending review',
      })),
    })
  } catch (error) {
    console.error('Failed to reconcile orphan maintenance units:', error)
  }
}

export async function getMaintenanceRecord(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const record = await prisma.maintenanceRecord.findUnique({
    where: { id },
    include: {
      assetUnit: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
          location: true,
        },
      },
    },
  })

  return serialize(record)
}

export async function createMaintenanceRecord(data: MaintenanceFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const laborCost = data.laborCost || 0
  const partsCost = data.partsCost || 0
  const totalCost = laborCost + partsCost

  const record = await prisma.$transaction(async (tx) => {
    const maintenance = await tx.maintenanceRecord.create({
      data: {
        assetUnitId: data.assetUnitId,
        type: data.type,
        status: 'SCHEDULED',
        description: data.description,
        scheduledDate: data.scheduledDate,
        performedBy: data.performedBy,
        vendorId: data.vendorId,
        laborCost: laborCost || null,
        partsCost: partsCost || null,
        totalCost: totalCost || null,
        partsUsed: data.partsUsed,
        fromCheckoutId: data.fromCheckoutId,
        damageDescription: data.damageDescription,
        returnToInventory: data.returnToInventory ?? true,
      },
      include: {
        assetUnit: { include: { asset: true } },
      },
    })

    // Update unit status to MAINTENANCE
    await tx.assetUnit.update({
      where: { id: data.assetUnitId },
      data: { status: 'MAINTENANCE' },
    })

    return maintenance
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(record)
}

export async function updateMaintenanceRecord(id: string, data: Partial<MaintenanceFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  let totalCost = null
  if (data.laborCost !== undefined || data.partsCost !== undefined) {
    const existingRecord = await prisma.maintenanceRecord.findUnique({
      where: { id },
      select: { laborCost: true, partsCost: true },
    })
    const laborCost = data.laborCost ?? (existingRecord?.laborCost ? Number(existingRecord.laborCost) : 0)
    const partsCost = data.partsCost ?? (existingRecord?.partsCost ? Number(existingRecord.partsCost) : 0)
    totalCost = laborCost + partsCost
  }

  const record = await prisma.maintenanceRecord.update({
    where: { id },
    data: {
      type: data.type,
      description: data.description,
      scheduledDate: data.scheduledDate,
      performedBy: data.performedBy,
      vendorId: data.vendorId,
      laborCost: data.laborCost,
      partsCost: data.partsCost,
      totalCost,
      partsUsed: data.partsUsed,
      damageDescription: data.damageDescription,
      returnToInventory: data.returnToInventory,
    },
    include: {
      assetUnit: { include: { asset: true } },
    },
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)

  return serialize(record)
}

export async function startMaintenance(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const record = await prisma.maintenanceRecord.update({
    where: { id },
    data: {
      status: 'IN_PROGRESS',
      startDate: new Date(),
    },
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)

  return serialize(record)
}

export async function completeMaintenance(
  id: string,
  data: {
    workPerformed: string
    partsUsed?: string
    laborCost?: number
    partsCost?: number
  }
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const laborCost = data.laborCost || 0
  const partsCost = data.partsCost || 0
  const totalCost = laborCost + partsCost

  const record = await prisma.$transaction(async (tx) => {
    const maintenance = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completionDate: new Date(),
        workPerformed: data.workPerformed,
        partsUsed: data.partsUsed,
        laborCost,
        partsCost,
        totalCost,
        returnDate: new Date(),
      },
      include: {
        assetUnit: true,
      },
    })

    // Return unit to inventory if configured
    if (maintenance.returnToInventory) {
      await tx.assetUnit.update({
        where: { id: maintenance.assetUnitId },
        data: { status: 'AVAILABLE' },
      })
    }

    return maintenance
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(record)
}

export async function cancelMaintenance(id: string, reason?: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const record = await prisma.$transaction(async (tx) => {
    const maintenance = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        description: reason
          ? `${(await tx.maintenanceRecord.findUnique({ where: { id } }))?.description}\n\nCancellation reason: ${reason}`
          : undefined,
      },
      include: {
        assetUnit: true,
      },
    })

    // Return unit to available status
    await tx.assetUnit.update({
      where: { id: maintenance.assetUnitId },
      data: { status: 'AVAILABLE' },
    })

    return maintenance
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)
  revalidatePath('/dashboard/assets')

  return serialize(record)
}

export async function removeFromMaintenance(
  id: string,
  targetStatus: 'AVAILABLE' | 'RETIRED',
  notes?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id } })
    if (!existing) throw new Error('Maintenance record not found')

    const statusLabel = targetStatus === 'AVAILABLE' ? 'inventory' : 'retirement'
    const noteText = notes
      ? `\n\nRemoved from maintenance → ${statusLabel}: ${notes}`
      : `\n\nRemoved from maintenance → ${statusLabel}`

    const maintenance = await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completionDate: new Date(),
        workPerformed: `Removed from maintenance to ${statusLabel}${notes ? ': ' + notes : ''}`,
        description: existing.description + noteText,
        returnToInventory: targetStatus === 'AVAILABLE',
      },
      include: { assetUnit: true },
    })

    await tx.assetUnit.update({
      where: { id: maintenance.assetUnitId },
      data: { status: targetStatus },
    })

    return maintenance
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(record)
}

export async function addMaintenanceNotes(id: string, notes: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.maintenanceRecord.findUnique({ where: { id } })
  if (!existing) throw new Error('Maintenance record not found')

  const timestamp = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const updatedDescription = existing.description
    ? `${existing.description}\n\n[${timestamp}] ${notes}`
    : `[${timestamp}] ${notes}`

  const record = await prisma.maintenanceRecord.update({
    where: { id },
    data: { description: updatedDescription },
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath(`/dashboard/maintenance/${id}`)

  return serialize(record)
}

export async function getMaintenanceStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [total, scheduled, inProgress, completed] = await Promise.all([
    prisma.maintenanceRecord.count(),
    prisma.maintenanceRecord.count({ where: { status: 'SCHEDULED' } }),
    prisma.maintenanceRecord.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.maintenanceRecord.count({ where: { status: 'COMPLETED' } }),
  ])

  const costStats = await prisma.maintenanceRecord.aggregate({
    where: { status: 'COMPLETED' },
    _sum: {
      totalCost: true,
    },
  })

  return {
    total,
    scheduled,
    inProgress,
    completed,
    totalCost: Number(costStats._sum.totalCost || 0),
  }
}

export async function getAssetsForMaintenance() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.assetUnit.findMany({
    where: {
      status: { in: ['AVAILABLE', 'MAINTENANCE'] },
    },
    select: {
      id: true,
      barcode: true,
      asset: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: { asset: { name: 'asc' } },
  })
}

export async function createMaintenanceFromCheckin(
  checkoutId: string,
  damageNotes: string,
  assetUnitId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  return createMaintenanceRecord({
    assetUnitId,
    type: 'DAMAGE_REPAIR',
    description: `Damage repair from check-in`,
    damageDescription: damageNotes,
    fromCheckoutId: checkoutId,
  })
}

/**
 * Get the count and details of units in MAINTENANCE for a given asset type.
 * Used by reservation/sale add-item flows to warn users.
 */
export async function getMaintenanceUnitsForAsset(assetId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const units = await prisma.assetUnit.findMany({
    where: { assetId, status: 'MAINTENANCE' },
    select: { id: true, barcode: true },
    orderBy: { barcode: 'asc' },
  })

  return serialize(units)
}

/**
 * Release units from maintenance for a given asset type, making them available for orders.
 * Completes any active maintenance records and sets unit status to AVAILABLE.
 */
export async function releaseMaintenanceUnitsForAsset(assetId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const result = await prisma.$transaction(async (tx) => {
    const units = await tx.assetUnit.findMany({
      where: { assetId, status: 'MAINTENANCE' },
      select: { id: true },
    })
    if (units.length === 0) return 0

    const unitIds = units.map((u) => u.id)

    // Complete all active maintenance records for these units
    await tx.maintenanceRecord.updateMany({
      where: {
        assetUnitId: { in: unitIds },
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      data: {
        status: 'COMPLETED',
        completionDate: new Date(),
        workPerformed: 'Released from maintenance for rental/sale order',
      },
    })

    // Set all units to AVAILABLE
    await tx.assetUnit.updateMany({
      where: { id: { in: unitIds } },
      data: { status: 'AVAILABLE' },
    })

    return units.length
  })

  revalidatePath('/dashboard/maintenance')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return result
}
