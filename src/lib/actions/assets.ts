'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { generateBarcode } from '@/lib/utils/barcode'
import { serialize } from '@/lib/utils'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'
import type { AssetStatus, DepreciationMethod, DepreciationCategory, OwnershipType, CoverageType } from '@/lib/types'

export type AssetFormData = {
  name: string
  description?: string
  categoryId: string
  manufacturer?: string
  model?: string
  vendorId?: string
  purchaseDate: Date
  purchasePrice?: number
  warrantyExpiry?: Date
  depreciationMethod?: DepreciationMethod
  depreciationCategory?: DepreciationCategory
  usefulLifeMonths?: number
  // Nullable so an edit can clear a previously-set value (undefined = leave unchanged)
  salvageValue?: number | null
  specs?: Record<string, unknown>
  notes?: string
  imageUrl?: string
  // Rates — nullable so an edit can clear them
  dailyRate?: number | null
  weeklyRate?: number | null
  monthlyRate?: number | null
  salePrice?: number | null
  // Purchase type
  ownershipType?: OwnershipType
  // Loan details
  loanName?: string
  fundingBusiness?: string
  loanAmount?: number
  amortizationEndDate?: Date
  // For new assets: initial number of units to create
  initialQuantity?: number
  // For new assets: pre-assigned barcode for the first unit (e.g. from scan list)
  initialBarcode?: string
}

export type AssetFilters = {
  search?: string
  status?: AssetStatus
  categoryId?: string
  locationId?: string
  vendorId?: string
}

export async function getAssets(filters: AssetFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, categoryId, locationId, vendorId } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { manufacturer: { contains: search, mode: 'insensitive' } },
      { model: { contains: search, mode: 'insensitive' } },
      { units: { some: { barcode: { contains: search, mode: 'insensitive' } } } },
      { units: { some: { serialNumber: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  if (status) {
    // Filter product types that have at least one unit with this status
    where.units = { ...where.units, some: { ...where.units?.some, status } }
  }

  if (locationId) {
    // Filter assets that have at least one unit at this location
    where.units = { ...where.units, some: { ...where.units?.some, locationId } }
  }

  if (categoryId) {
    where.categoryId = categoryId
  }

  if (vendorId) {
    where.vendorId = vendorId
  }

  const [assets, reservedItems] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        category: true,
        vendor: true,
        _count: { select: { units: true } },
        units: {
          select: { id: true, barcode: true, serialNumber: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Get quantities committed to confirmed/active reservations
    prisma.reservationItem.findMany({
      where: {
        reservation: {
          status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
        },
      },
      select: { assetId: true, quantity: true, checkedOutCount: true },
    }),
  ])

  // Sum reserved-but-not-yet-checked-out quantities per asset
  const reservedByAsset = new Map<string, number>()
  for (const item of reservedItems) {
    if (!item.assetId) continue
    const pendingQty = item.quantity - item.checkedOutCount
    if (pendingQty > 0) {
      reservedByAsset.set(item.assetId, (reservedByAsset.get(item.assetId) || 0) + pendingQty)
    }
  }

  // Add unit status aggregation
  const searchLower = search?.toLowerCase()
  const result = assets.map((asset) => {
    const unitsByStatus = asset.units.reduce(
      (acc, unit) => {
        acc[unit.status] = (acc[unit.status] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    const rawAvailable = unitsByStatus['AVAILABLE'] || 0
    const reservedCount = reservedByAsset.get(asset.id) || 0

    // When searching, include units that match the query (by barcode or serial)
    const matchedUnits = searchLower
      ? asset.units
          .filter(
            (u) =>
              u.barcode.toLowerCase().includes(searchLower) ||
              (u.serialNumber && u.serialNumber.toLowerCase().includes(searchLower))
          )
          .map((u) => ({ id: u.id, barcode: u.barcode, serialNumber: u.serialNumber, status: u.status }))
      : []

    // Active (non-retired, non-sold) unit count for context
    const activeUnitCount = (unitsByStatus['AVAILABLE'] || 0)
      + (unitsByStatus['CHECKED_OUT'] || 0)
      + (unitsByStatus['MAINTENANCE'] || 0)
      + (unitsByStatus['RESERVED'] || 0)

    return {
      ...asset,
      units: undefined,
      unitCount: asset._count.units,
      availableCount: rawAvailable,
      freeCount: Math.max(0, rawAvailable - reservedCount),
      reservedCount,
      checkedOutCount: unitsByStatus['CHECKED_OUT'] || 0,
      maintenanceCount: unitsByStatus['MAINTENANCE'] || 0,
      retiredCount: unitsByStatus['RETIRED'] || 0,
      soldCount: unitsByStatus['SOLD'] || 0,
      activeUnitCount,
      matchedUnits,
    }
  })

  return serialize(result)
}

export async function getAsset(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      vendor: true,
      units: {
        include: {
          location: true,
          vendor: true,
          checkouts: {
            include: {
              client: true,
            },
            orderBy: { checkoutDate: 'desc' },
          },
          maintenanceRecords: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  return serialize(asset)
}

export async function createAsset(data: AssetFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const initialQuantity = data.initialQuantity || 1

  const asset = await prisma.$transaction(async (tx) => {
    // Create the product type
    const newAsset = await tx.asset.create({
      data: {
        name: data.name,
        description: data.description,
        categoryId: data.categoryId,
        manufacturer: data.manufacturer,
        model: data.model,
        vendorId: data.vendorId || null,
        depreciationMethod: data.depreciationMethod || 'STRAIGHT_LINE',
        depreciationCategory: data.depreciationCategory || null,
        usefulLifeMonths: data.usefulLifeMonths || 36,
        salvageValue: data.salvageValue,
        specs: data.specs as object,
        notes: data.notes,
        imageUrl: data.imageUrl,
        dailyRate: data.dailyRate,
        weeklyRate: data.weeklyRate,
        monthlyRate: data.monthlyRate,
        salePrice: data.salePrice,
        totalQuantity: initialQuantity,
      },
    })

    // Create initial units (copy asset's vendorId as default)
    const firstUnitBarcode = data.initialBarcode?.trim() || generateBarcode()
    for (let i = 0; i < initialQuantity; i++) {
      await tx.assetUnit.create({
        data: {
          assetId: newAsset.id,
          barcode: i === 0 ? firstUnitBarcode : generateBarcode(),
          vendorId: data.vendorId || null,
          ownershipType: data.ownershipType || 'CASH',
          purchaseDate: data.purchaseDate,
          purchasePrice: data.purchasePrice,
          warrantyExpiry: data.warrantyExpiry,
          loanName: data.ownershipType === 'LOAN' ? data.loanName : null,
          fundingBusiness: data.ownershipType === 'LOAN' ? data.fundingBusiness : null,
          loanAmount: data.ownershipType === 'LOAN' ? data.loanAmount : null,
          amortizationEndDate: data.ownershipType === 'LOAN' ? data.amortizationEndDate : null,
        },
      })
    }

    // If a scan-list barcode was assigned, link any unresolved scan list items to the new unit
    if (data.initialBarcode?.trim()) {
      const newUnit = await tx.assetUnit.findUnique({
        where: { barcode: firstUnitBarcode },
        select: { id: true },
      })
      if (newUnit) {
        await tx.scanListItem.updateMany({
          where: { barcode: firstUnitBarcode, assetUnitId: null },
          data: { assetUnitId: newUnit.id },
        })
      }
    }

    return tx.asset.findUnique({
      where: { id: newAsset.id },
      include: {
        category: true,
        vendor: true,
        units: true,
      },
    })
  })

  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')
  if (data.initialBarcode?.trim()) {
    revalidatePath('/dashboard/scan-lists')
  }

  return serialize(asset)
}

export async function updateAsset(id: string, data: Partial<AssetFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const asset = await prisma.asset.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      categoryId: data.categoryId,
      manufacturer: data.manufacturer,
      model: data.model,
      vendorId: data.vendorId || null,
      depreciationMethod: data.depreciationMethod,
      depreciationCategory: data.depreciationCategory !== undefined ? (data.depreciationCategory || null) : undefined,
      usefulLifeMonths: data.usefulLifeMonths,
      salvageValue: data.salvageValue,
      specs: data.specs as object,
      notes: data.notes,
      imageUrl: data.imageUrl,
      dailyRate: data.dailyRate,
      weeklyRate: data.weeklyRate,
      monthlyRate: data.monthlyRate,
      salePrice: data.salePrice,
    },
    include: {
      category: true,
      vendor: true,
    },
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${id}`)
  revalidatePath('/dashboard')

  return serialize(asset)
}

export async function deleteAsset(id: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.asset.delete({
    where: { id },
  })

  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')
}

// ============================================
// ASSET UNIT CRUD
// ============================================

export type ServiceCoverageFormData = {
  id?: string
  type: CoverageType
  name: string
  provider?: string
  startDate: Date
  endDate: Date
  cost?: number
  notes?: string
}

export type AssetUnitFormData = {
  assetId: string
  barcode?: string
  serialNumber?: string
  status?: AssetStatus
  locationId?: string
  vendorId?: string
  condition?: string
  notes?: string
  ownershipType?: OwnershipType
  purchaseDate: Date
  purchasePrice?: number
  warrantyExpiry?: Date
  // Loan details
  loanName?: string
  fundingBusiness?: string
  loanAmount?: number
  amortizationEndDate?: Date
  // Service coverages
  serviceCoverages?: ServiceCoverageFormData[]
}

export async function createAssetUnit(data: AssetUnitFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.$transaction(async (tx) => {
    const isLoan = data.ownershipType === 'LOAN'
    const newUnit = await tx.assetUnit.create({
      data: {
        assetId: data.assetId,
        barcode: data.barcode || generateBarcode(),
        serialNumber: data.serialNumber || null,
        status: data.status || 'AVAILABLE',
        locationId: data.locationId || null,
        vendorId: data.vendorId || null,
        condition: data.condition,
        notes: data.notes,
        ownershipType: data.ownershipType || 'CASH',
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        warrantyExpiry: data.warrantyExpiry,
        loanName: isLoan ? data.loanName : null,
        fundingBusiness: isLoan ? data.fundingBusiness : null,
        loanAmount: isLoan ? data.loanAmount : null,
        amortizationEndDate: isLoan ? data.amortizationEndDate : null,
      },
      include: { asset: true, location: true },
    })

    // Insert service coverages
    if (data.serviceCoverages && data.serviceCoverages.length > 0) {
      await tx.serviceCoverage.createMany({
        data: data.serviceCoverages.map((sc) => ({
          unitId: newUnit.id,
          type: sc.type,
          name: sc.name,
          provider: sc.provider || null,
          startDate: sc.startDate,
          endDate: sc.endDate,
          cost: sc.cost ?? null,
          notes: sc.notes || null,
        })),
      })
    }

    // Update totalQuantity
    await tx.asset.update({
      where: { id: data.assetId },
      data: { totalQuantity: { increment: 1 } },
    })

    return newUnit
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${data.assetId}`)

  return serialize(unit)
}

export async function updateAssetUnit(id: string, data: Partial<AssetUnitFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const isLoan = data.ownershipType === 'LOAN'
  const unit = await prisma.$transaction(async (tx) => {
    const updated = await tx.assetUnit.update({
      where: { id },
      data: {
        barcode: data.barcode,
        serialNumber: data.serialNumber,
        status: data.status,
        locationId: data.locationId || null,
        ...(data.vendorId !== undefined ? { vendorId: data.vendorId || null } : {}),
        condition: data.condition,
        notes: data.notes,
        ownershipType: data.ownershipType,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        warrantyExpiry: data.warrantyExpiry,
        ...(data.ownershipType !== undefined ? {
          loanName: isLoan ? data.loanName : null,
          fundingBusiness: isLoan ? data.fundingBusiness : null,
          loanAmount: isLoan ? data.loanAmount : null,
          amortizationEndDate: isLoan ? data.amortizationEndDate : null,
        } : {}),
      },
      include: { asset: true, location: true },
    })

    // Replace service coverages if provided
    if (data.serviceCoverages !== undefined) {
      await tx.serviceCoverage.deleteMany({ where: { unitId: id } })
      if (data.serviceCoverages.length > 0) {
        await tx.serviceCoverage.createMany({
          data: data.serviceCoverages.map((sc) => ({
            unitId: id,
            type: sc.type,
            name: sc.name,
            provider: sc.provider || null,
            startDate: sc.startDate,
            endDate: sc.endDate,
            cost: sc.cost ?? null,
            notes: sc.notes || null,
          })),
        })
      }
    }

    return updated
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${unit.assetId}`)

  return serialize(unit)
}

export async function markUnitAsSold(id: string, data: {
  soldAt?: Date | null
  soldPrice?: number | null
  soldNotes?: string | null
}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.assetUnit.findUnique({
    where: { id },
    select: { id: true, status: true, barcode: true, asset: { select: { id: true, name: true } } },
  })
  if (!unit) throw new Error('Unit not found')
  if (unit.status !== 'RETIRED') {
    throw new Error(`Unit must be RETIRED to mark as sold (current status: ${unit.status})`)
  }

  await prisma.assetUnit.update({
    where: { id },
    data: {
      status: 'SOLD',
      retirementReason: 'SOLD',
      soldAt: data.soldAt ?? new Date(),
      soldPrice: data.soldPrice ?? undefined,
      soldNotes: data.soldNotes ?? undefined,
    },
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${unit.asset.id}`)
  revalidatePath(`/dashboard/assets/${unit.asset.id}/units/${id}`)

  return { success: true, barcode: unit.barcode }
}

export async function deleteAssetUnit(id: string, password: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (!password) throw new Error('Password is required')

  // Verify the caller's password
  const { verifyPassword } = await import('@/lib/auth')
  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { passwordHash: true },
  })
  if (!user?.passwordHash) throw new Error('Cannot verify password')

  const isValid = await verifyPassword(password, user.passwordHash)
  if (!isValid) throw new Error('Invalid password')

  const unit = await prisma.$transaction(async (tx) => {
    // Remove related records that reference this unit
    await tx.reservationItemUnit.deleteMany({ where: { assetUnitId: id } })
    await tx.checkout.deleteMany({ where: { assetUnitId: id } })
    await tx.maintenanceRecord.deleteMany({ where: { assetUnitId: id } })
    await tx.assetTransfer.deleteMany({ where: { assetUnitId: id } })
    await tx.auditItem.deleteMany({ where: { assetUnitId: id } })
    await tx.scanListItem.deleteMany({ where: { assetUnitId: id } })

    // Disconnect from any leases (implicit many-to-many)
    const unitWithLeases = await tx.assetUnit.findUnique({
      where: { id },
      select: { leaseId: true },
    })
    if (unitWithLeases?.leaseId) {
      await tx.assetUnit.update({
        where: { id },
        data: { leaseId: null },
      })
    }

    const deleted = await tx.assetUnit.delete({
      where: { id },
      include: { asset: { select: { name: true } } },
    })

    // Update totalQuantity
    await tx.asset.update({
      where: { id: deleted.assetId },
      data: { totalQuantity: { decrement: 1 } },
    })

    return deleted
  })

  // Audit log
  const { logAudit } = await import('@/lib/actions/audit')
  await logAudit({
    action: 'DELETE',
    entityType: 'Asset',
    entityId: id,
    oldValues: { barcode: unit.barcode, assetName: unit.asset.name, serialNumber: unit.serialNumber },
    userId: authResult.userId,
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${unit.assetId}`)

  return serialize(unit)
}

export async function getAssetUnit(idOrBarcode: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.assetUnit.findFirst({
    where: {
      OR: [
        { id: idOrBarcode },
        { barcode: idOrBarcode },
      ],
    },
    include: {
      asset: {
        include: { category: true },
      },
      location: true,
    },
  })

  return serialize(unit)
}

export async function getAssetUnitDetail(unitId: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.assetUnit.findUnique({
    where: { id: unitId },
    include: {
      asset: { include: { category: true } },
      location: true,
      vendor: true,
      checkouts: {
        orderBy: { checkoutDate: 'desc' },
        include: {
          reservation: { select: { id: true, reservationNumber: true } },
          client: { select: { id: true, name: true, companyName: true } },
        },
        take: 50,
      },
      maintenanceRecords: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      serviceCoverages: {
        orderBy: { endDate: 'asc' },
      },
    },
  })

  if (!unit) return null
  return serialize(unit)
}

export async function getCategories() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.assetCategory.findMany({
    orderBy: { name: 'asc' },
  })
}

export async function getLocations() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.location.findMany({
    orderBy: { name: 'asc' },
  })
}

export async function getVendors() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  return prisma.vendor.findMany({
    orderBy: { name: 'asc' },
  })
}

export type BulkUpdateData = {
  categoryId?: string
  vendorId?: string
  dailyRate?: number
  weeklyRate?: number
  monthlyRate?: number
}

export async function bulkUpdateAssets(assetIds: string[], data: BulkUpdateData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (assetIds.length === 0) throw new Error('No assets selected')

  // Only include fields that were explicitly provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {}
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId
  if (data.vendorId !== undefined) updateData.vendorId = data.vendorId
  if (data.dailyRate !== undefined) updateData.dailyRate = data.dailyRate
  if (data.weeklyRate !== undefined) updateData.weeklyRate = data.weeklyRate
  if (data.monthlyRate !== undefined) updateData.monthlyRate = data.monthlyRate

  if (Object.keys(updateData).length === 0) {
    throw new Error('No fields to update')
  }

  const result = await prisma.asset.updateMany({
    where: { id: { in: assetIds } },
    data: updateData,
  })

  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return { updated: result.count }
}

export async function getAssetStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [active, available, checkedOut, maintenance, retired] = await Promise.all([
    prisma.assetUnit.count({ where: { status: { not: 'RETIRED' } } }),
    prisma.assetUnit.count({ where: { status: 'AVAILABLE' } }),
    prisma.assetUnit.count({ where: { status: 'CHECKED_OUT' } }),
    prisma.assetUnit.count({ where: { status: 'MAINTENANCE' } }),
    prisma.assetUnit.count({ where: { status: 'RETIRED' } }),
  ])

  return {
    total: active,
    active,
    available,
    checkedOut,
    maintenance,
    retired,
  }
}

export async function getRetiredUnits(search?: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { status: { in: ['RETIRED', 'SOLD'] } }

  if (search) {
    where.OR = [
      { barcode: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { asset: { name: { contains: search, mode: 'insensitive' } } },
      { asset: { manufacturer: { contains: search, mode: 'insensitive' } } },
      { asset: { model: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const units = await prisma.assetUnit.findMany({
    where,
    include: {
      asset: {
        select: { id: true, name: true, manufacturer: true, model: true, category: { select: { name: true } } },
      },
      location: { select: { name: true } },
    },
    orderBy: { retiredAt: 'desc' },
  })

  return serialize(units)
}

export async function restoreUnit(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const unit = await prisma.assetUnit.findUnique({
    where: { id },
    select: { id: true, status: true, barcode: true, assetId: true },
  })
  if (!unit) throw new Error('Unit not found')
  if (unit.status !== 'RETIRED' && unit.status !== 'SOLD') {
    throw new Error(`Unit must be RETIRED or SOLD to restore (current status: ${unit.status})`)
  }

  await prisma.assetUnit.update({
    where: { id },
    data: {
      status: 'AVAILABLE',
      retiredAt: null,
      retirementReason: null,
      retiredTo: null,
      soldAt: null,
      soldPrice: null,
      soldNotes: null,
      soldViaReservation: null,
    },
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${unit.assetId}`)
  revalidatePath('/dashboard/assets/retired')

  return { success: true, barcode: unit.barcode }
}

export async function searchAssetsForMerge(query: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (!query || query.length < 2) return []

  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { manufacturer: { contains: query, mode: 'insensitive' } },
        { model: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      model: true,
      totalQuantity: true,
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
    take: 20,
  })

  return serialize(assets)
}

export async function checkDuplicateAssets(name: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (!name || name.length < 3) return []

  const duplicates = await prisma.asset.findMany({
    where: {
      name: { contains: name, mode: 'insensitive' },
    },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      model: true,
      totalQuantity: true,
      category: { select: { name: true } },
    },
    take: 5,
  })

  return serialize(duplicates)
}

export async function mergeAssets(sourceId: string, targetId: string) {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (sourceId === targetId) throw new Error('Cannot merge an asset into itself')

  const result = await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.asset.findUnique({
        where: { id: sourceId },
        include: { _count: { select: { units: true, reservationItems: true, invoiceItems: true, poItems: true } } },
      }),
      tx.asset.findUnique({ where: { id: targetId } }),
    ])
    if (!source) throw new Error('Source asset not found')
    if (!target) throw new Error('Target asset not found')

    // 1. Move all AssetUnits from source to target
    await tx.assetUnit.updateMany({
      where: { assetId: sourceId },
      data: { assetId: targetId },
    })

    // 2. Move ReservationItems — handle unique constraint
    const sourceResItems = await tx.reservationItem.findMany({
      where: { assetId: sourceId },
    })
    for (const item of sourceResItems) {
      // Composite unique includes a nullable column (parentId) — use findFirst
      // so we can match against NULL parent (top-level items).
      const existing = await tx.reservationItem.findFirst({
        where: {
          reservationId: item.reservationId,
          assetId: targetId,
          packageId: item.packageId!,
          parentId: item.parentId,
        },
      })
      if (existing) {
        await tx.reservationItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + item.quantity,
            subtotal: Number(existing.subtotal) + Number(item.subtotal),
            checkedOutCount: existing.checkedOutCount + item.checkedOutCount,
            checkedInCount: existing.checkedInCount + item.checkedInCount,
          },
        })
        await tx.reservationItemUnit.updateMany({
          where: { reservationItemId: item.id },
          data: { reservationItemId: existing.id },
        })
        await tx.reservationItem.delete({ where: { id: item.id } })
      } else {
        await tx.reservationItem.update({
          where: { id: item.id },
          data: { assetId: targetId },
        })
      }
    }

    // 3. Move InvoiceItems
    await tx.invoiceItem.updateMany({
      where: { assetId: sourceId },
      data: { assetId: targetId },
    })

    // 4. Move POItems
    await tx.pOItem.updateMany({
      where: { assetId: sourceId },
      data: { assetId: targetId },
    })

    // 5. Recalculate target totalQuantity
    const unitCount = await tx.assetUnit.count({ where: { assetId: targetId } })
    await tx.asset.update({
      where: { id: targetId },
      data: { totalQuantity: unitCount },
    })

    // 6. Delete source asset
    await tx.asset.delete({ where: { id: sourceId } })

    return {
      sourceName: source.name,
      targetName: target.name,
      movedUnits: source._count.units,
      movedReservationItems: source._count.reservationItems,
      movedInvoiceItems: source._count.invoiceItems,
      movedPoItems: source._count.poItems,
    }
  })

  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${targetId}`)
  revalidatePath('/dashboard')

  return serialize(result)
}
