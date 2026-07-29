'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { auth } from '@/lib/auth'
import { serialize } from '@/lib/utils'
import { logAudit } from './audit'
import { checkoutByBarcode } from './reservations'
import { restoreUnit } from './assets'
import type { ScanResult } from './reservations'
import type { InventoryAuditScope, InventoryAuditStatus } from '@/lib/types'

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type CreateAuditData = {
  name: string
  scope: InventoryAuditScope
  categoryId?: string
  locationId?: string
  clientId?: string
  reservationIds?: string[]
  notes?: string
}

export type AuditFilters = {
  search?: string
  status?: InventoryAuditStatus
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export async function createInventoryAudit(data: CreateAuditData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const session = await auth()
  const userId = session!.user!.id!

  const audit = await prisma.inventoryAudit.create({
    data: {
      name: data.name,
      scope: data.scope,
      categoryId: data.scope === 'CATEGORY' ? data.categoryId : null,
      locationId: data.scope === 'LOCATION' ? data.locationId : null,
      clientId: data.scope === 'CLIENT_ORDER' ? data.clientId : null,
      reservationIds: data.scope === 'CLIENT_ORDER' ? (data.reservationIds ?? []) : [],
      notes: data.notes,
      createdById: userId,
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'InventoryAudit',
    entityId: audit.id,
    newValues: { name: audit.name, scope: audit.scope },
  })

  revalidatePath('/dashboard/audits')
  return serialize(audit)
}

export async function getInventoryAudits(filters: AuditFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const { search, status } = filters
  const where: Record<string, unknown> = {}

  if (status) where.status = status
  if (search) {
    where.name = { contains: search, mode: 'insensitive' }
  }

  const audits = await prisma.inventoryAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return serialize(audits)
}

export async function getInventoryAudit(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      client: { select: { id: true, name: true, companyName: true } },
    },
  })

  if (!audit) return null

  // For client/order audits, resolve the selected order numbers for display
  const reservations = audit.reservationIds.length > 0
    ? await prisma.reservation.findMany({
        where: { id: { in: audit.reservationIds } },
        select: { id: true, reservationNumber: true, projectName: true },
      })
    : []

  // Batch fetch asset unit details for all items (skip unknown items with no unit)
  const unitIds = audit.items
    .map(item => item.assetUnitId)
    .filter((id): id is string => id !== null)
  const units = unitIds.length > 0
    ? await prisma.assetUnit.findMany({
        where: { id: { in: unitIds } },
        include: {
          asset: { select: { id: true, name: true, manufacturer: true, model: true, categoryId: true } },
          location: { select: { id: true, name: true } },
        },
      })
    : []

  const unitMap = new Map(units.map(u => [u.id, u]))

  const enrichedItems = audit.items.map(item => ({
    ...item,
    assetUnit: item.assetUnitId ? unitMap.get(item.assetUnitId) ?? null : null,
  }))

  return serialize({ ...audit, items: enrichedItems, reservations })
}

// ------------------------------------------------------------------
// Client/order audit helpers
// ------------------------------------------------------------------

/**
 * Returns a client's orders (reservations) that currently have at least one
 * checked-out unit, for selection when creating a CLIENT_ORDER audit.
 */
export async function getAuditableReservationsForClient(clientId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!clientId) return []

  // Active/overdue checkouts grouped by reservation = units the client still holds
  const checkouts = await prisma.checkout.findMany({
    where: {
      clientId,
      status: { in: ['ACTIVE', 'OVERDUE'] },
      reservationId: { not: null },
    },
    select: { reservationId: true },
  })

  const counts = new Map<string, number>()
  for (const c of checkouts) {
    if (!c.reservationId) continue
    counts.set(c.reservationId, (counts.get(c.reservationId) ?? 0) + 1)
  }

  const reservationIds = [...counts.keys()]
  if (reservationIds.length === 0) return []

  const reservations = await prisma.reservation.findMany({
    where: { id: { in: reservationIds } },
    select: {
      id: true,
      reservationNumber: true,
      projectName: true,
      startDate: true,
      endDate: true,
      status: true,
    },
    orderBy: { startDate: 'desc' },
  })

  return serialize(
    reservations.map(r => ({ ...r, checkedOutCount: counts.get(r.id) ?? 0 }))
  )
}

export async function deleteInventoryAudit(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({ where: { id } })
  if (!audit) throw new Error('Audit not found')
  if (audit.status !== 'DRAFT') throw new Error('Only draft audits can be deleted')

  await prisma.inventoryAudit.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'InventoryAudit',
    entityId: id,
    oldValues: { name: audit.name },
  })

  revalidatePath('/dashboard/audits')
  return { success: true }
}

// ------------------------------------------------------------------
// Workflow: Start / Verify / Flag / Complete
// ------------------------------------------------------------------

export async function startInventoryAudit(auditId: string, assetIds?: string[]) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({ where: { id: auditId } })
  if (!audit) throw new Error('Audit not found')
  if (audit.status !== 'DRAFT') throw new Error('Audit has already been started')

  // Build unit query based on scope
  const unitWhere: Record<string, unknown> = { status: { not: 'RETIRED' } }

  switch (audit.scope) {
    case 'FULL':
      break // no additional filters
    case 'CATEGORY':
      if (!audit.categoryId) throw new Error('Category not set for category audit')
      unitWhere.asset = { categoryId: audit.categoryId }
      break
    case 'LOCATION':
      if (!audit.locationId) throw new Error('Location not set for location audit')
      unitWhere.locationId = audit.locationId
      break
    case 'PARTIAL':
      if (!assetIds || assetIds.length === 0) throw new Error('No assets selected for partial audit')
      unitWhere.assetId = { in: assetIds }
      break
    case 'CLIENT_ORDER':
      if (!audit.reservationIds || audit.reservationIds.length === 0)
        throw new Error('No orders selected for client/order audit')
      // Only units currently in the client's possession (active or overdue checkouts) on the selected orders
      unitWhere.checkouts = {
        some: {
          reservationId: { in: audit.reservationIds },
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
      }
      break
  }

  const units = await prisma.assetUnit.findMany({
    where: unitWhere,
    select: { id: true, locationId: true, status: true },
  })

  if (units.length === 0) throw new Error('No asset units match the audit scope')

  // Create audit items in a transaction
  await prisma.$transaction([
    prisma.auditItem.createMany({
      data: units.map(unit => ({
        auditId,
        assetUnitId: unit.id,
        expectedLocationId: unit.locationId,
        expectedStatus: unit.status,
      })),
    }),
    prisma.inventoryAudit.update({
      where: { id: auditId },
      data: {
        status: 'IN_PROGRESS',
        totalItems: units.length,
        startedAt: new Date(),
      },
    }),
  ])

  await logAudit({
    action: 'UPDATE',
    entityType: 'InventoryAudit',
    entityId: auditId,
    newValues: { status: 'IN_PROGRESS', totalItems: units.length },
  })

  revalidatePath('/dashboard/audits')
  revalidatePath('/dashboard/mobile')
  return { success: true, totalItems: units.length }
}

// Outcome of verifying a single scanned barcode against an audit
type VerifyOutcome =
  | 'VERIFIED'        // matched an expected item and marked verified
  | 'NOT_ON_ORDER'    // known asset unit, but not in the audit's scope — flagged
  | 'UNKNOWN'         // barcode not registered to any asset unit — captured for review
  | 'ALREADY_VERIFIED'
  | 'ALREADY_FLAGGED' // re-scan of an item already flagged Not on Order / Unknown

/**
 * Core verification used by single scans and scan-list cross-checks.
 * Mutates only audit tables — never orders, checkouts or asset units.
 */
async function verifyBarcodeInternal(
  auditId: string,
  barcode: string,
  userId: string | undefined
): Promise<VerifyOutcome> {
  const code = barcode.trim()

  const assetUnit = await prisma.assetUnit.findUnique({
    where: { barcode: code },
    select: { id: true },
  })

  // (c) Barcode is not a registered asset at all — capture as Unknown for review
  if (!assetUnit) {
    const existingUnknown = await prisma.auditItem.findFirst({
      where: { auditId, assetUnitId: null, barcode: code },
      select: { id: true },
    })
    if (existingUnknown) return 'ALREADY_FLAGGED'

    await prisma.$transaction([
      prisma.auditItem.create({
        data: {
          auditId,
          assetUnitId: null,
          barcode: code,
          status: 'UNEXPECTED',
          issueType: 'UNKNOWN_BARCODE',
          scannedAt: new Date(),
          scannedById: userId,
        },
      }),
      prisma.inventoryAudit.update({
        where: { id: auditId },
        data: { unexpectedCount: { increment: 1 } },
      }),
    ])
    return 'UNKNOWN'
  }

  // If this barcode was previously captured as an Unknown placeholder (because the
  // asset did not exist yet) and has since been registered, drop the stale row so
  // it is replaced by a proper verified / not-on-order resolution below.
  const staleUnknown = await prisma.auditItem.findFirst({
    where: { auditId, assetUnitId: null, barcode: code },
    select: { id: true },
  })
  if (staleUnknown) {
    await prisma.$transaction([
      prisma.auditItem.delete({ where: { id: staleUnknown.id } }),
      prisma.inventoryAudit.update({
        where: { id: auditId },
        data: { unexpectedCount: { decrement: 1 } },
      }),
    ])
  }

  const auditItem = await prisma.auditItem.findUnique({
    where: { auditId_assetUnitId: { auditId, assetUnitId: assetUnit.id } },
  })

  // (b) Known unit but not part of this audit's scope — flag Not on Order
  if (!auditItem) {
    await prisma.$transaction([
      prisma.auditItem.create({
        data: {
          auditId,
          assetUnitId: assetUnit.id,
          barcode: code,
          status: 'UNEXPECTED',
          issueType: 'NOT_ON_ORDER',
          scannedAt: new Date(),
          scannedById: userId,
        },
      }),
      prisma.inventoryAudit.update({
        where: { id: auditId },
        data: { unexpectedCount: { increment: 1 } },
      }),
    ])
    return 'NOT_ON_ORDER'
  }

  if (auditItem.status === 'VERIFIED') return 'ALREADY_VERIFIED'
  if (auditItem.status === 'UNEXPECTED') return 'ALREADY_FLAGGED'

  // (a) Expected item — mark verified
  const wasIssue = auditItem.status === 'ISSUE'
  await prisma.$transaction([
    prisma.auditItem.update({
      where: { id: auditItem.id },
      data: { status: 'VERIFIED', scannedAt: new Date(), scannedById: userId },
    }),
    prisma.inventoryAudit.update({
      where: { id: auditId },
      data: {
        verifiedCount: { increment: 1 },
        ...(wasIssue ? { issueCount: { decrement: 1 } } : {}),
      },
    }),
  ])
  return 'VERIFIED'
}

export async function verifyAuditItemByBarcode(auditId: string, barcode: string): Promise<ScanResult> {
  try {
    const authResult = await requireEditor()
    if (!authResult.authorized) return { success: false, error: authResult.error || 'Unauthorized' }

    const session = await auth()
    const userId = session?.user?.id

    const code = barcode.trim()
    if (!code) return { success: false, error: 'Empty barcode' }

    const outcome = await verifyBarcodeInternal(auditId, code, userId)
    switch (outcome) {
      case 'VERIFIED':
        return { success: true }
      case 'NOT_ON_ORDER':
        return { success: true, warning: `${code} is not on the order — flagged Not on Order` }
      case 'UNKNOWN':
        return { success: true, warning: `${code} is not a registered asset — flagged Unknown` }
      case 'ALREADY_VERIFIED':
        return { success: false, error: `${code} has already been verified` }
      case 'ALREADY_FLAGGED':
        return { success: false, error: `${code} is already flagged for review` }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Verification failed' }
  }
}

/**
 * Bind a flagged "Not on Order" item to one of the audit's orders. This is the
 * one audit action that intentionally modifies an order: it checks the unit out
 * onto the selected reservation, then marks the audit item verified.
 *
 * If the scanned unit is RETIRED, pass reactivate=true to bring it back into
 * service (status → AVAILABLE, retirement cleared) before assigning it to the order.
 */
export async function addAuditItemToOrder(
  auditItemId: string,
  reservationId: string,
  reactivate = false
): Promise<ScanResult> {
  try {
    const authResult = await requireEditor()
    if (!authResult.authorized) return { success: false, error: authResult.error || 'Unauthorized' }

    const item = await prisma.auditItem.findUnique({
      where: { id: auditItemId },
      select: { id: true, auditId: true, assetUnitId: true, status: true },
    })
    if (!item) return { success: false, error: 'Audit item not found' }
    if (item.status !== 'UNEXPECTED') {
      return { success: false, error: 'Only Not-on-Order items can be added to an order' }
    }
    if (!item.assetUnitId) {
      return { success: false, error: 'Unknown items must be created as an asset before they can be added to an order' }
    }

    const audit = await prisma.inventoryAudit.findUnique({
      where: { id: item.auditId },
      select: { reservationIds: true, status: true },
    })
    if (!audit) return { success: false, error: 'Audit not found' }
    if (audit.status !== 'IN_PROGRESS') return { success: false, error: 'Audit is not in progress' }
    if (!audit.reservationIds.includes(reservationId)) {
      return { success: false, error: 'Selected order is not part of this audit' }
    }

    const unit = await prisma.assetUnit.findUnique({
      where: { id: item.assetUnitId },
      select: { barcode: true, status: true },
    })
    if (!unit) return { success: false, error: 'Asset unit not found' }

    // Retired item: it must be reactivated before it can go back onto an order
    let reactivated = false
    if (unit.status === 'RETIRED') {
      if (!reactivate) {
        return { success: false, error: 'RETIRED: this item is retired — confirm reactivation to add it to the order' }
      }
      await restoreUnit(item.assetUnitId) // status → AVAILABLE, retirement cleared
      reactivated = true
    }

    // Bind the unit to the order (creates/extends the reservation item and checks it out)
    const result = await checkoutByBarcode(reservationId, unit.barcode)
    if (!result.success) return result

    // Now legitimately on the order — convert the flagged item to a verified expected item
    await prisma.$transaction([
      prisma.auditItem.update({
        where: { id: item.id },
        data: { status: 'VERIFIED', issueType: null, issueNotes: null },
      }),
      prisma.inventoryAudit.update({
        where: { id: item.auditId },
        data: {
          unexpectedCount: { decrement: 1 },
          verifiedCount: { increment: 1 },
          totalItems: { increment: 1 },
        },
      }),
    ])

    await logAudit({
      action: 'UPDATE',
      entityType: 'InventoryAudit',
      entityId: item.auditId,
      newValues: { addedToOrder: reservationId, assetUnitId: item.assetUnitId, reactivated },
    })

    revalidatePath(`/dashboard/audits/${item.auditId}`)
    revalidatePath(`/dashboard/reservations/${reservationId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add to order' }
  }
}

/**
 * Cross-check an existing scan list against the audit: every barcode on the list
 * is verified against the audit's expected items in one pass, returning a summary.
 */
export async function auditFromScanList(auditId: string, scanListId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({
    where: { id: auditId },
    select: { status: true },
  })
  if (!audit) throw new Error('Audit not found')
  if (audit.status !== 'IN_PROGRESS') {
    throw new Error('Audit must be in progress to cross-check a scan list')
  }

  const session = await auth()
  const userId = session?.user?.id

  const items = await prisma.scanListItem.findMany({
    where: { listId: scanListId },
    select: { barcode: true },
  })

  const summary = {
    total: items.length,
    verified: 0,
    notOnOrder: 0,
    unknown: 0,
    alreadyAccounted: 0,
  }

  for (const it of items) {
    const outcome = await verifyBarcodeInternal(auditId, it.barcode, userId)
    switch (outcome) {
      case 'VERIFIED': summary.verified++; break
      case 'NOT_ON_ORDER': summary.notOnOrder++; break
      case 'UNKNOWN': summary.unknown++; break
      case 'ALREADY_VERIFIED':
      case 'ALREADY_FLAGGED': summary.alreadyAccounted++; break
    }
  }

  await logAudit({
    action: 'UPDATE',
    entityType: 'InventoryAudit',
    entityId: auditId,
    newValues: { crossCheckedScanList: scanListId, ...summary },
  })

  revalidatePath(`/dashboard/audits/${auditId}`)
  return summary
}

export async function flagAuditItem(
  auditItemId: string,
  issueType: string,
  issueNotes?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const item = await prisma.auditItem.findUnique({
    where: { id: auditItemId },
    select: { id: true, auditId: true, status: true },
  })
  if (!item) throw new Error('Audit item not found')

  const session = await auth()
  const userId = session?.user?.id

  const wasPending = item.status === 'PENDING'
  const wasVerified = item.status === 'VERIFIED'

  await prisma.$transaction([
    prisma.auditItem.update({
      where: { id: auditItemId },
      data: {
        status: 'ISSUE',
        issueType,
        issueNotes,
        scannedAt: new Date(),
        scannedById: userId,
      },
    }),
    prisma.inventoryAudit.update({
      where: { id: item.auditId },
      data: {
        issueCount: { increment: 1 },
        ...(wasVerified ? { verifiedCount: { decrement: 1 } } : {}),
      },
    }),
  ])

  revalidatePath(`/dashboard/audits/${item.auditId}`)
  return { success: true }
}

export async function completeInventoryAudit(auditId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({ where: { id: auditId } })
  if (!audit) throw new Error('Audit not found')
  if (audit.status !== 'IN_PROGRESS') throw new Error('Audit is not in progress')

  // Count remaining pending items and mark them MISSING
  const pendingCount = await prisma.auditItem.count({
    where: { auditId, status: 'PENDING' },
  })

  await prisma.$transaction([
    prisma.auditItem.updateMany({
      where: { auditId, status: 'PENDING' },
      data: { status: 'MISSING' },
    }),
    prisma.inventoryAudit.update({
      where: { id: auditId },
      data: {
        status: 'COMPLETED',
        missingCount: pendingCount,
        completedAt: new Date(),
      },
    }),
  ])

  await logAudit({
    action: 'UPDATE',
    entityType: 'InventoryAudit',
    entityId: auditId,
    newValues: { status: 'COMPLETED', missingCount: pendingCount },
  })

  revalidatePath('/dashboard/audits')
  revalidatePath('/dashboard/mobile')
  return { success: true }
}

// ------------------------------------------------------------------
// Lightweight progress query for mobile
// ------------------------------------------------------------------

export async function getInventoryAuditProgress(auditId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const audit = await prisma.inventoryAudit.findUnique({
    where: { id: auditId },
    select: {
      totalItems: true,
      verifiedCount: true,
      issueCount: true,
      missingCount: true,
      unexpectedCount: true,
    },
  })

  if (!audit) return null
  return {
    total: audit.totalItems,
    verified: audit.verifiedCount,
    issues: audit.issueCount,
    missing: audit.missingCount,
    unexpected: audit.unexpectedCount,
    pending: audit.totalItems - audit.verifiedCount - audit.issueCount - audit.missingCount,
  }
}
