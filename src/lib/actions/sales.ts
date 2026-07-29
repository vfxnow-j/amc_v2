'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { calculatePeriods } from '@/lib/actions/reservations'
import { computeItemSubtotal } from '@/lib/pricing/periods'

/**
 * Resolve the active package id for a reservation, if any.
 * Used to scope total recalculation to a single package so alternate
 * quote packages don't inflate the order subtotal/total.
 */
async function getActivePackageId(reservationId: string): Promise<string | null> {
  const pkg = await prisma.package.findFirst({
    where: { reservationId, isActive: true },
    select: { id: true },
  })
  return pkg?.id ?? null
}

/**
 * Fetch items belonging to the active package of a reservation.
 * Falls back to all items if the reservation has no packages (legacy).
 */
async function getActivePackageItems(reservationId: string) {
  const activePackageId = await getActivePackageId(reservationId)
  return prisma.reservationItem.findMany({
    where: { reservationId, ...(activePackageId ? { packageId: activePackageId } : {}) },
  })
}

export type SaleFilters = {
  search?: string
  status?: string
  clientId?: string
  reservationType?: 'SALE' | 'CLOUD'
}

/**
 * List sales (reservations with reservationType = 'SALE').
 */
export async function getSales(filters: SaleFilters = {}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const where: any = filters.reservationType
    ? { reservationType: filters.reservationType }
    : { reservationType: { in: ['SALE', 'CLOUD'] } }

  if (filters.search) {
    where.OR = [
      { reservationNumber: { contains: filters.search, mode: 'insensitive' } },
      { projectName: { contains: filters.search, mode: 'insensitive' } },
      { client: { name: { contains: filters.search, mode: 'insensitive' } } },
      { client: { companyName: { contains: filters.search, mode: 'insensitive' } } },
    ]
  }

  if (filters.status) {
    where.status = filters.status
  }

  if (filters.clientId) {
    where.clientId = filters.clientId
  }

  const sales = await prisma.reservation.findMany({
    where,
    include: {
      client: true,
      items: {
        include: {
          asset: { include: { category: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return serialize(sales)
}

/**
 * Get pipeline metrics for sale orders, grouped by status buckets.
 */
export async function getSalesPipelineMetrics(reservationType?: 'SALE' | 'CLOUD') {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const typeFilter: any = reservationType
    ? { reservationType }
    : { reservationType: { in: ['SALE', 'CLOUD'] } }

  const results = await prisma.reservation.groupBy({
    by: ['status'],
    where: typeFilter,
    _sum: { total: true },
    _count: true,
  })

  const buckets: Record<string, { count: number; total: number }> = {}
  for (const row of results) {
    buckets[row.status] = {
      count: row._count,
      total: row._sum.total ? Number(row._sum.total) : 0,
    }
  }

  const get = (statuses: string[]) => {
    let count = 0, total = 0
    for (const s of statuses) {
      if (buckets[s]) { count += buckets[s].count; total += buckets[s].total }
    }
    return { count, total }
  }

  return {
    draft: get(['DRAFT']),
    quoted: get(['QUOTE_SENT', 'REVISION']),
    active: get(['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE']),
    completed: get(['COMPLETED']),
  }
}

/**
 * Get a single sale by ID.
 */
export async function getSale(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const sale = await prisma.reservation.findUnique({
    where: { id },
    include: {
      client: true,
      packages: {
        include: {
          items: {
            include: {
              asset: { include: { category: true } },
              units: { include: { assetUnit: true } },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      items: {
        include: {
          asset: { include: { category: true } },
          units: {
            include: {
              assetUnit: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      invoices: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!sale || (sale.reservationType !== 'SALE' && sale.reservationType !== 'CLOUD')) return null

  return serialize(sale)
}

/**
 * Complete a sale — mark all associated asset units as SOLD.
 */
export async function completeSale(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const sale = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          include: {
            asset: true,
            units: {
              include: { assetUnit: true },
            },
          },
        },
      },
    })

    if (!reservation) throw new Error('Sale not found')
    if (reservation.reservationType !== 'SALE') throw new Error('This is not a sale order')
    if (!['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
      throw new Error('Sale must be approved or active to complete')
    }

    // For each item, prefer pre-allocated units (RESERVED), then auto-pick AVAILABLE.
    // Skips ad-hoc items and cloud component children (parent carries the asset).
    for (const item of reservation.items) {
      if (!item.assetId) continue
      if (item.parentId) continue // cloud component breakdown rows

      const assignedUnitIds = item.units.map((u) => u.assetUnitId)
      const unitsNeeded = item.quantity - assignedUnitIds.length

      if (unitsNeeded > 0) {
        // Auto-pick remaining AVAILABLE units to fill the line
        const availableUnits = await tx.assetUnit.findMany({
          where: {
            assetId: item.assetId,
            status: 'AVAILABLE',
            id: { notIn: assignedUnitIds },
          },
          take: unitsNeeded,
        })

        if (availableUnits.length < unitsNeeded) {
          throw new Error(
            `Not enough available units for "${item.asset?.name}": need ${unitsNeeded} more, only ${availableUnits.length} available. Allocate specific units on the order line first.`
          )
        }

        for (const unit of availableUnits) {
          await tx.reservationItemUnit.upsert({
            where: {
              reservationItemId_assetUnitId: {
                reservationItemId: item.id,
                assetUnitId: unit.id,
              },
            },
            create: {
              reservationItemId: item.id,
              assetUnitId: unit.id,
              checkedOutAt: new Date(),
            },
            update: {
              checkedOutAt: new Date(),
              checkedInAt: null,
            },
          })
          assignedUnitIds.push(unit.id)
        }
      } else {
        // Mark pre-allocated junctions as checked out (sold)
        for (const u of item.units) {
          await tx.reservationItemUnit.update({
            where: { id: u.id },
            data: { checkedOutAt: u.checkedOutAt || new Date() },
          })
        }
      }

      // Mark every unit attached to this line as SOLD
      const salePrice = Number(item.rate)
      for (const unitId of assignedUnitIds) {
        await tx.assetUnit.update({
          where: { id: unitId },
          data: {
            status: 'SOLD',
            soldAt: new Date(),
            soldViaReservation: reservationId,
            soldPrice: salePrice,
            soldNotes: `Sold via ${reservation.reservationNumber} to client`,
          },
        })
      }

      // Update the asset's total quantity
      const remainingCount = await tx.assetUnit.count({
        where: {
          assetId: item.assetId,
          status: { notIn: ['SOLD', 'RETIRED'] },
        },
      })
      await tx.asset.update({
        where: { id: item.assetId },
        data: { totalQuantity: remainingCount },
      })
    }

    // Complete the reservation
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
      include: { client: true, items: true },
    })

    return updated
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservationId,
      fromStatus: 'APPROVED',
      toStatus: 'COMPLETED',
      changedById: authResult.userId!,
      notes: 'Sale completed — items marked as sold',
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/sales')
  revalidatePath(`/dashboard/sales/${reservationId}`)
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(sale)
}

/**
 * Convert a rental reservation to a sale (buyout).
 * Uses asset sale prices, calculates rental credit from paid invoices.
 */
export async function convertReservationToSale(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const { generateReservationNumber } = await import('./reservations')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          include: { asset: true },
        },
        invoices: {
          where: {
            status: { in: ['PAID', 'PARTIAL'] },
          },
          select: { amountPaid: true },
        },
      },
    })

    if (!reservation) throw new Error('Reservation not found')
    if (reservation.reservationType === 'SALE') {
      throw new Error('This is already a sale order')
    }

    const allowedStatuses = ['DRAFT', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE']
    if (!allowedStatuses.includes(reservation.status)) {
      throw new Error(
        `Cannot convert a ${reservation.status.toLowerCase()} reservation to a sale`
      )
    }

    // Generate SALE number
    const saleNumber = await generateReservationNumber('SALE')

    // Update item rates to asset sale prices and recalculate subtotals
    let newSubtotal = 0
    for (const item of reservation.items) {
      if (item.assetId && item.asset) {
        const salePrice = Number(item.asset.salePrice) || Number(item.rate)
        const itemSubtotal = salePrice * item.quantity
        newSubtotal += itemSubtotal
        await tx.reservationItem.update({
          where: { id: item.id },
          data: {
            rate: salePrice,
            pricingType: 'PROJECT',
            isOneTime: true,
            subtotal: itemSubtotal,
          },
        })
      } else {
        // Ad-hoc items: keep rate, make one-time
        const itemSubtotal = Number(item.rate) * item.quantity
        newSubtotal += itemSubtotal
        await tx.reservationItem.update({
          where: { id: item.id },
          data: {
            pricingType: 'PROJECT',
            isOneTime: true,
            subtotal: itemSubtotal,
          },
        })
      }
    }

    // Calculate total rental payments from paid invoices
    const totalPaid = reservation.invoices.reduce(
      (sum, inv) => sum + Number(inv.amountPaid),
      0
    )

    // Default: 100% of payments credited toward the sale
    const creditPercent = 100
    const creditAmount = totalPaid * (creditPercent / 100)

    // Recalculate totals with credit
    let discountAmount = 0
    const discountType = reservation.discountType
    const discountValue = Number(reservation.discountValue) || 0
    if (discountType === 'PERCENTAGE' && discountValue > 0) {
      discountAmount = newSubtotal * (discountValue / 100)
    } else if (discountType === 'FIXED' && discountValue > 0) {
      discountAmount = Math.min(discountValue, newSubtotal)
    }
    const afterDiscount = newSubtotal - discountAmount
    const afterCredit = afterDiscount - creditAmount
    const taxRate = Number(reservation.taxRate) || 0
    const taxAmount = afterCredit * (taxRate / 100)
    const deliveryCost = Number(reservation.deliveryCost) || 0
    const returnCost = Number(reservation.returnCost) || 0
    const total = afterCredit + taxAmount + deliveryCost + returnCost

    const oldNumber = reservation.reservationNumber

    // Update the reservation
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        reservationType: 'SALE',
        reservationNumber: saleNumber,
        billingCycleType: 'ONE_TIME',
        isRecurring: false,
        nextBillingDate: null,
        subtotal: newSubtotal,
        discountAmount,
        taxAmount,
        total,
        rentalCreditPercent: creditPercent,
        rentalCreditAmount: creditAmount,
        convertedFromNumber: oldNumber,
      },
    })

    return { reservation: updated, oldNumber }
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservationId,
      fromStatus: 'RENTAL',
      toStatus: 'SALE',
      changedById: authResult.userId!,
      notes: `Converted from rental (${result.oldNumber}) to sale (${result.reservation.reservationNumber})`,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  revalidatePath('/dashboard/sales')
  revalidatePath(`/dashboard/sales/${reservationId}`)
  revalidatePath('/dashboard')

  return serialize(result.reservation)
}

/**
 * Update the buyout rental credit percentage on a converted sale.
 * Recalculates credit amount from invoices and updates totals.
 */
export async function updateBuyoutCredit(reservationId: string, creditPercent: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (creditPercent < 0 || creditPercent > 100) {
    throw new Error('Credit percentage must be between 0 and 100')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        invoices: {
          where: {
            status: { in: ['PAID', 'PARTIAL'] },
          },
          select: { amountPaid: true },
        },
      },
    })

    if (!reservation) throw new Error('Sale not found')
    if (reservation.reservationType !== 'SALE') throw new Error('Not a sale order')
    if (!reservation.convertedFromNumber) throw new Error('Not a converted sale')

    // Recalculate credit from paid invoices
    const totalPaid = reservation.invoices.reduce(
      (sum, inv) => sum + Number(inv.amountPaid),
      0
    )
    const creditAmount = totalPaid * (creditPercent / 100)

    // Recalculate totals
    const subtotal = Number(reservation.subtotal)
    let discountAmount = 0
    const discountType = reservation.discountType
    const discountValue = Number(reservation.discountValue) || 0
    if (discountType === 'PERCENTAGE' && discountValue > 0) {
      discountAmount = subtotal * (discountValue / 100)
    } else if (discountType === 'FIXED' && discountValue > 0) {
      discountAmount = Math.min(discountValue, subtotal)
    }
    const afterDiscount = subtotal - discountAmount
    const afterCredit = afterDiscount - creditAmount
    const taxRate = Number(reservation.taxRate) || 0
    const taxAmount = afterCredit * (taxRate / 100)
    const deliveryCost = Number(reservation.deliveryCost) || 0
    const returnCost = Number(reservation.returnCost) || 0
    const total = afterCredit + taxAmount + deliveryCost + returnCost

    return tx.reservation.update({
      where: { id: reservationId },
      data: {
        rentalCreditPercent: creditPercent,
        rentalCreditAmount: creditAmount,
        discountAmount,
        taxAmount,
        total,
      },
    })
  })

  revalidatePath('/dashboard/sales')
  revalidatePath(`/dashboard/sales/${reservationId}`)

  return serialize(updated)
}

/**
 * Convert a subset of items from a rental reservation to a new sale.
 * If all items are selected, delegates to convertReservationToSale() instead.
 */
export async function convertPartialReservationToSale(
  reservationId: string,
  selectedItemIds: string[],
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!selectedItemIds.length) throw new Error('No items selected')

  const { generateReservationNumber } = await import('./reservations')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      items: { include: { asset: true } },
      invoices: {
        where: { status: { in: ['PAID', 'PARTIAL'] } },
        select: { amountPaid: true },
      },
    },
  })

  if (!reservation) throw new Error('Reservation not found')
  if (reservation.reservationType !== 'RENTAL') throw new Error('Only rental reservations can be converted')
  if (!['DRAFT', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'].includes(reservation.status)) {
    throw new Error(`Cannot convert a ${reservation.status.toLowerCase()} reservation`)
  }

  // Validate all selected items belong to this reservation
  const reservationItemIds = new Set(reservation.items.map((i) => i.id))
  for (const id of selectedItemIds) {
    if (!reservationItemIds.has(id)) throw new Error(`Item ${id} does not belong to this reservation`)
  }

  // If ALL items selected, delegate to the full conversion
  if (selectedItemIds.length === reservation.items.length) {
    return convertReservationToSale(reservationId)
  }

  const result = await prisma.$transaction(async (tx) => {
    // Generate a new SALE number
    const saleNumber = await generateReservationNumber('SALE')

    // Calculate rental credit from paid invoices
    const totalPaid = reservation.invoices.reduce(
      (sum, inv) => sum + Number(inv.amountPaid), 0
    )
    const creditPercent = 100
    const creditAmount = totalPaid * (creditPercent / 100)

    // Create the new SALE reservation with default package
    const saleReservation = await tx.reservation.create({
      data: {
        reservationNumber: saleNumber,
        clientId: reservation.clientId,
        reservationType: 'SALE',
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        status: reservation.status === 'ACTIVE' ? 'APPROVED' : reservation.status,
        billingCycleType: 'ONE_TIME',
        taxRate: reservation.taxRate,
        projectName: reservation.projectName,
        projectCode: reservation.projectCode,
        notes: reservation.notes,
        convertedFromNumber: reservation.reservationNumber,
        rentalCreditPercent: creditPercent,
        rentalCreditAmount: creditAmount,
        subtotal: 0,
        discountAmount: 0,
        taxAmount: 0,
        total: 0,
        createdById: reservation.createdById,
        packages: {
          create: { name: 'Default', isActive: true, sortOrder: 0 },
        },
      },
      include: { packages: true },
    })
    const salePkgId = saleReservation.packages[0].id

    // Move selected items to the new sale
    let saleSubtotal = 0
    for (const itemId of selectedItemIds) {
      const item = reservation.items.find((i) => i.id === itemId)!
      const salePrice = item.asset?.salePrice ? Number(item.asset.salePrice) : Number(item.rate)
      const itemSubtotal = salePrice * item.quantity
      saleSubtotal += itemSubtotal

      await tx.reservationItem.update({
        where: { id: itemId },
        data: {
          reservationId: saleReservation.id,
          packageId: salePkgId,
          rate: salePrice,
          pricingType: 'PROJECT',
          isOneTime: true,
          subtotal: itemSubtotal,
        },
      })
    }

    // Recalculate sale totals
    const afterCredit = saleSubtotal - creditAmount
    const taxRate = Number(reservation.taxRate) || 0
    const taxAmount = Math.max(0, afterCredit) * (taxRate / 100)
    const saleTotal = Math.max(0, afterCredit) + taxAmount

    await tx.reservation.update({
      where: { id: saleReservation.id },
      data: {
        subtotal: saleSubtotal,
        taxAmount,
        total: saleTotal,
      },
    })

    // Recalculate original reservation totals (remaining items)
    const remainingItems = await tx.reservationItem.findMany({
      where: { reservationId: reservation.id },
    })
    const remainingSubtotal = remainingItems.reduce(
      (sum, item) => sum + Number(item.subtotal), 0
    )
    let discountAmount = 0
    const discountType = reservation.discountType
    const discountValue = Number(reservation.discountValue) || 0
    if (discountType === 'PERCENTAGE' && discountValue > 0) {
      discountAmount = remainingSubtotal * (discountValue / 100)
    } else if (discountType === 'FIXED' && discountValue > 0) {
      discountAmount = Math.min(discountValue, remainingSubtotal)
    }
    const afterDiscount = remainingSubtotal - discountAmount
    const origTaxRate = Number(reservation.taxRate) || 0
    const origTaxAmount = afterDiscount * (origTaxRate / 100)
    const deliveryCost = Number(reservation.deliveryCost) || 0
    const returnCost = Number(reservation.returnCost) || 0
    const origTotal = afterDiscount + origTaxAmount + deliveryCost + returnCost

    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        subtotal: remainingSubtotal,
        discountAmount,
        taxAmount: origTaxAmount,
        total: origTotal,
      },
    })

    return saleReservation
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: result.id,
      fromStatus: null,
      toStatus: result.status,
      changedById: authResult.userId!,
      notes: `Partial conversion: ${selectedItemIds.length} item(s) from ${reservation.reservationNumber} to ${result.reservationNumber}`,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  revalidatePath('/dashboard/sales')
  revalidatePath(`/dashboard/sales/${result.id}`)
  revalidatePath('/dashboard')

  return serialize(result)
}

/**
 * Convert a sale order back to a rental reservation.
 * Only allowed for DRAFT or APPROVED sales.
 */
export async function convertSaleToRental(reservationId: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const { generateReservationNumber } = await import('./reservations')

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: {
        items: {
          include: { asset: true },
        },
      },
    })

    if (!reservation) throw new Error('Sale not found')
    if (reservation.reservationType !== 'SALE') {
      throw new Error('This is not a sale order')
    }
    if (!['DRAFT', 'APPROVED'].includes(reservation.status)) {
      throw new Error(
        `Cannot convert a ${reservation.status.toLowerCase()} sale to a rental`
      )
    }

    // Generate RENTAL number
    const rentalNumber = await generateReservationNumber('RENTAL')

    // Update item rates to monthly rates and recalculate subtotals
    let newSubtotal = 0
    for (const item of reservation.items) {
      let monthlyRate = Number(item.rate)
      if (item.assetId && item.asset) {
        monthlyRate = Number(item.asset.monthlyRate) || Number(item.rate)
      }
      const itemSubtotal = monthlyRate * item.quantity
      newSubtotal += itemSubtotal
      await tx.reservationItem.update({
        where: { id: item.id },
        data: {
          rate: monthlyRate,
          pricingType: 'MONTHLY',
          isOneTime: false,
          subtotal: itemSubtotal,
        },
      })
    }

    // Recalculate totals
    let discountAmount = 0
    const discountType = reservation.discountType
    const discountValue = Number(reservation.discountValue) || 0
    if (discountType === 'PERCENTAGE' && discountValue > 0) {
      discountAmount = newSubtotal * (discountValue / 100)
    } else if (discountType === 'FIXED' && discountValue > 0) {
      discountAmount = Math.min(discountValue, newSubtotal)
    }
    const afterDiscount = newSubtotal - discountAmount
    const taxRate = Number(reservation.taxRate) || 0
    const taxAmount = afterDiscount * (taxRate / 100)
    const deliveryCost = Number(reservation.deliveryCost) || 0
    const returnCost = Number(reservation.returnCost) || 0
    const total = afterDiscount + taxAmount + deliveryCost + returnCost

    const oldNumber = reservation.reservationNumber

    // Update the reservation
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        reservationType: 'RENTAL',
        reservationNumber: rentalNumber,
        billingCycleType: 'MONTHLY',
        subtotal: newSubtotal,
        discountAmount,
        taxAmount,
        total,
        rentalCreditPercent: 0,
        rentalCreditAmount: 0,
        convertedFromNumber: oldNumber,
      },
    })

    return { reservation: updated, oldNumber }
  })

  // Record status history
  try {
    const { recordStatusChange } = await import('./status-history')
    await recordStatusChange({
      entityType: 'RESERVATION',
      entityId: reservationId,
      fromStatus: 'SALE',
      toStatus: 'RENTAL',
      changedById: authResult.userId!,
      notes: `Converted from sale (${result.oldNumber}) to rental (${result.reservation.reservationNumber})`,
    })
  } catch { /* non-critical */ }

  revalidatePath('/dashboard/sales')
  revalidatePath(`/dashboard/sales/${reservationId}`)
  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  revalidatePath('/dashboard')

  return serialize(result.reservation)
}

/**
 * Update an individual sale item's price and recalculate totals.
 */
export async function updateSaleItemPrice(reservationId: string, itemId: string, newRate: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation) throw new Error('Sale not found')
  if (reservation.reservationType !== 'SALE' && reservation.reservationType !== 'CLOUD') {
    throw new Error('Not a sale or cloud order')
  }
  if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only edit prices on draft, quoted, or approved orders')
  }

  const item = reservation.items.find((i) => i.id === itemId)
  if (!item) throw new Error('Item not found')

  if (newRate < 0) throw new Error('Price cannot be negative')

  // Cloud host subtotals factor in billing periods (rate * qty * periods).
  // For non-recurring CLOUD/SALE items, calculatePeriods returns a value
  // based on dates + pricingType; recurring orders return 1.
  const periods = item.isOneTime
    ? 1
    : await calculatePeriods(
        reservation.startDate,
        reservation.endDate,
        item.pricingType,
        reservation.isRecurring,
      )
  const newSubtotal = computeItemSubtotal(newRate, item.quantity, periods)

  // Recalculate margin % from new price vs cost
  const costBasis = item.costBasis != null ? Number(item.costBasis) : null
  let marginPercent: number | null = null
  if (costBasis != null && costBasis > 0 && newRate > 0) {
    marginPercent = Math.round(((newRate - costBasis) / newRate) * 10000) / 100
  }

  // Update the item
  await prisma.reservationItem.update({
    where: { id: itemId },
    data: {
      rate: newRate,
      subtotal: newSubtotal,
      ...(costBasis != null ? { marginPercent } : {}),
    },
  })

  // Recalculate reservation totals from the ACTIVE package only.
  // Alternate quote packages are separate options and must not contribute
  // to the order subtotal/total.
  const allItems = await getActivePackageItems(reservationId)
  const itemsSubtotal = allItems.reduce((sum, i) => sum + Number(i.subtotal), 0)

  const discountType = reservation.discountType as string | null
  const discountValue = Number(reservation.discountValue) || 0
  const taxRate = Number(reservation.taxRate) || 0

  let discountAmount = 0
  if (discountType === 'PERCENTAGE' && discountValue > 0) {
    discountAmount = itemsSubtotal * (discountValue / 100)
  } else if (discountType === 'FIXED' && discountValue > 0) {
    discountAmount = Math.min(discountValue, itemsSubtotal)
  }

  const afterDiscount = itemsSubtotal - discountAmount
  const creditAmount = Number(reservation.rentalCreditAmount) || 0
  const afterCredit = afterDiscount - creditAmount
  const taxAmount = afterCredit * (taxRate / 100)
  const logistics = (Number(reservation.deliveryCost) || 0) + (Number(reservation.returnCost) || 0)
  const total = afterCredit + taxAmount + logistics

  // Recalculate margin totals
  const totalCost = allItems.reduce((sum, i) => {
    const c = i.costBasis != null ? Number(i.costBasis) : 0
    return sum + c * i.quantity
  }, 0)
  const totalMargin = itemsSubtotal - totalCost

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      subtotal: itemsSubtotal,
      discountAmount,
      taxAmount,
      total,
      totalCost,
      totalMargin,
      priceVerified: false, // Reset verification when prices change
    },
  })

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

/**
 * Update an individual sale item's quantity and recalculate totals.
 */
export async function updateSaleItemQuantity(reservationId: string, itemId: string, newQuantity: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (!Number.isInteger(newQuantity) || newQuantity < 1) {
    throw new Error('Quantity must be a positive integer')
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation) throw new Error('Sale not found')
  if (reservation.reservationType !== 'SALE' && reservation.reservationType !== 'CLOUD') {
    throw new Error('Not a sale or cloud order')
  }
  if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only edit quantities on draft, quoted, or approved orders')
  }

  const item = reservation.items.find((i) => i.id === itemId)
  if (!item) throw new Error('Item not found')

  const rate = Number(item.rate)
  // Factor in billing periods so cloud-host parents (rate × hosts × periods)
  // recompute correctly. Non-recurring rates with date ranges get periods > 1;
  // recurring orders always return 1.
  const periods = item.isOneTime
    ? 1
    : await calculatePeriods(
        reservation.startDate,
        reservation.endDate,
        item.pricingType,
        reservation.isRecurring,
      )
  const newSubtotal = computeItemSubtotal(rate, newQuantity, periods)

  // Update the item
  await prisma.reservationItem.update({
    where: { id: itemId },
    data: { quantity: newQuantity, subtotal: newSubtotal },
  })

  // Recalculate reservation totals from the ACTIVE package only.
  const allItems = await getActivePackageItems(reservationId)
  const itemsSubtotal = allItems.reduce((sum, i) => sum + Number(i.subtotal), 0)

  const discountType = reservation.discountType as string | null
  const discountValue = Number(reservation.discountValue) || 0
  const taxRate = Number(reservation.taxRate) || 0

  let discountAmount = 0
  if (discountType === 'PERCENTAGE' && discountValue > 0) {
    discountAmount = itemsSubtotal * (discountValue / 100)
  } else if (discountType === 'FIXED' && discountValue > 0) {
    discountAmount = Math.min(discountValue, itemsSubtotal)
  }

  const afterDiscount = itemsSubtotal - discountAmount
  const creditAmount = Number(reservation.rentalCreditAmount) || 0
  const afterCredit = afterDiscount - creditAmount
  const taxAmount = afterCredit * (taxRate / 100)
  const logistics = (Number(reservation.deliveryCost) || 0) + (Number(reservation.returnCost) || 0)
  const total = afterCredit + taxAmount + logistics

  // Recalculate margin totals
  const totalCost = allItems.reduce((sum, i) => {
    const c = i.costBasis != null ? Number(i.costBasis) : 0
    return sum + c * i.quantity
  }, 0)
  const totalMargin = itemsSubtotal - totalCost

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      subtotal: itemsSubtotal,
      discountAmount,
      taxAmount,
      total,
      totalCost,
      totalMargin,
      priceVerified: false,
    },
  })

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

/**
 * Toggle price verification flag on a sale order.
 */
export async function togglePriceVerified(reservationId: string, verified: boolean) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } })
  if (!reservation) throw new Error('Sale not found')
  if (reservation.reservationType !== 'SALE') throw new Error('Not a sale order')

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      priceVerified: verified,
      priceVerifiedAt: verified ? new Date() : null,
    },
  })

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

/**
 * Get sales summary for dashboard/reporting.
 */
export async function getSalesSummary() {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [totalSales, completedSales, monthSales, totalSoldUnits, soldRevenue] = await Promise.all([
    prisma.reservation.count({ where: { reservationType: { in: ['SALE', 'CLOUD'] } } }),
    prisma.reservation.count({ where: { reservationType: { in: ['SALE', 'CLOUD'] }, status: 'COMPLETED' } }),
    prisma.reservation.count({
      where: { reservationType: { in: ['SALE', 'CLOUD'] }, createdAt: { gte: thisMonth } },
    }),
    prisma.assetUnit.count({ where: { status: 'SOLD' } }),
    prisma.reservation.aggregate({
      where: { reservationType: { in: ['SALE', 'CLOUD'] }, status: 'COMPLETED' },
      _sum: { total: true },
    }),
  ])

  return serialize({
    totalSales,
    completedSales,
    monthSales,
    totalSoldUnits,
    totalRevenue: soldRevenue._sum.total ? Number(soldRevenue._sum.total) : 0,
  })
}

// ============================================
// MARGIN MANAGEMENT
// ============================================

/**
 * Internal helper: recalculate Reservation.totalCost and totalMargin from items + internal costs.
 */
async function recalculateSaleMarginTotals(reservationId: string) {
  const [items, reservation] = await Promise.all([
    // Scope cost/margin totals to the ACTIVE package so alternate
    // quote packages don't distort deal margins.
    getActivePackageItems(reservationId),
    prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { internalShippingCost: true, subRentalCost: true, hardwareCost: true },
    }),
  ])

  const itemCost = items.reduce((sum, i) => {
    const cost = i.costBasis != null ? Number(i.costBasis) : 0
    return sum + cost * i.quantity
  }, 0)

  const internalCosts = (reservation?.internalShippingCost != null ? Number(reservation.internalShippingCost) : 0)
    + (reservation?.subRentalCost != null ? Number(reservation.subRentalCost) : 0)
    + (reservation?.hardwareCost != null ? Number(reservation.hardwareCost) : 0)
  const totalCost = itemCost + internalCosts

  const subtotal = items.reduce((sum, i) => sum + Number(i.subtotal), 0)
  const totalMargin = subtotal - totalCost

  await prisma.reservation.update({
    where: { id: reservationId },
    data: { totalCost, totalMargin },
  })
}

/**
 * Update margin % on a single sale item. Recalculates rate from cost.
 * Sale Price = cost × (1 + marginPercent/100)
 */
export async function updateSaleItemMargin(reservationId: string, itemId: string, marginPercent: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation) throw new Error('Order not found')
  if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only edit margins on draft, quoted, or approved orders')
  }

  const item = reservation.items.find((i) => i.id === itemId)
  if (!item) throw new Error('Item not found')

  const costBasis = item.costBasis != null ? Number(item.costBasis) : null

  // Gross margin: price = cost / (1 - margin/100)
  if (marginPercent >= 100) throw new Error('Margin % must be less than 100')

  let newRate = Number(item.rate)
  let newSubtotal = Number(item.subtotal)

  if (costBasis != null && costBasis > 0) {
    // Recalculate rate from cost basis and margin
    newRate = Math.round(costBasis / (1 - marginPercent / 100) * 100) / 100
    newSubtotal = newRate * item.quantity
    await prisma.reservationItem.update({
      where: { id: itemId },
      data: {
        marginPercent,
        rate: newRate,
        subtotal: newSubtotal,
      },
    })
  } else {
    // No cost basis — just store margin % without recalculating rate
    await prisma.reservationItem.update({
      where: { id: itemId },
      data: { marginPercent },
    })
  }

  // Recalculate reservation totals from the ACTIVE package only.
  const allItems = await getActivePackageItems(reservationId)
  const itemsSubtotal = allItems.reduce((sum, i) => sum + Number(i.subtotal), 0)

  const discountType = reservation.discountType as string | null
  const discountValue = Number(reservation.discountValue) || 0
  const taxRate = Number(reservation.taxRate) || 0

  let discountAmount = 0
  if (discountType === 'PERCENTAGE' && discountValue > 0) {
    discountAmount = itemsSubtotal * (discountValue / 100)
  } else if (discountType === 'FIXED' && discountValue > 0) {
    discountAmount = Math.min(discountValue, itemsSubtotal)
  }

  const afterDiscount = itemsSubtotal - discountAmount
  const creditAmount = Number(reservation.rentalCreditAmount) || 0
  const afterCredit = afterDiscount - creditAmount
  const taxAmount = afterCredit * (taxRate / 100)
  const logistics = (Number(reservation.deliveryCost) || 0) + (Number(reservation.returnCost) || 0)
  const total = afterCredit + taxAmount + logistics

  const totalCost = allItems.reduce((sum, i) => {
    const c = i.costBasis != null ? Number(i.costBasis) : 0
    return sum + c * i.quantity
  }, 0)
  const totalMargin = itemsSubtotal - totalCost

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      subtotal: itemsSubtotal,
      discountAmount,
      taxAmount,
      total,
      totalCost,
      totalMargin,
      priceVerified: false,
    },
  })

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

/**
 * Update cost basis on a single sale item. Recalculates margin %.
 */
export async function updateSaleItemCost(reservationId: string, itemId: string, costBasis: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation) throw new Error('Order not found')
  if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only edit costs on draft, quoted, or approved orders')
  }

  const item = reservation.items.find((i) => i.id === itemId)
  if (!item) throw new Error('Item not found')
  if (costBasis < 0) throw new Error('Cost cannot be negative')

  // Recalculate margin % from current rate vs new cost
  const rate = Number(item.rate)
  let marginPercent: number | null = null
  if (costBasis > 0 && rate > 0) {
    marginPercent = Math.round(((rate - costBasis) / rate) * 10000) / 100
  }

  await prisma.reservationItem.update({
    where: { id: itemId },
    data: { costBasis, marginPercent },
  })

  await recalculateSaleMarginTotals(reservationId)

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

/**
 * Apply a margin % to ALL items in a sale. Recalculates all rates from cost.
 */
export async function applyMarginToAll(reservationId: string, marginPercent: number) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  if (marginPercent >= 100) throw new Error('Margin % must be less than 100')

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  })
  if (!reservation) throw new Error('Order not found')
  if (!['DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED'].includes(reservation.status)) {
    throw new Error('Can only edit margins on draft, quoted, or approved orders')
  }

  // Apply margin only to items in the ACTIVE package so alternate
  // quote packages keep their own pricing.
  const activePackageId = await getActivePackageId(reservationId)
  const targetItems = activePackageId
    ? reservation.items.filter((i) => i.packageId === activePackageId)
    : reservation.items

  let newSubtotalSum = 0
  let totalCost = 0

  for (const item of targetItems) {
    const costBasis = item.costBasis != null ? Number(item.costBasis) : null
    if (costBasis != null && costBasis > 0) {
      const newRate = Math.round(costBasis / (1 - marginPercent / 100) * 100) / 100
      const newSubtotal = newRate * item.quantity
      newSubtotalSum += newSubtotal
      totalCost += costBasis * item.quantity

      await prisma.reservationItem.update({
        where: { id: item.id },
        data: {
          marginPercent,
          rate: newRate,
          subtotal: newSubtotal,
        },
      })
    } else {
      // No cost basis — keep existing rate, just set margin %
      newSubtotalSum += Number(item.subtotal)
      await prisma.reservationItem.update({
        where: { id: item.id },
        data: { marginPercent },
      })
    }
  }

  // Recalculate reservation totals
  const discountType = reservation.discountType as string | null
  const discountValue = Number(reservation.discountValue) || 0
  const taxRate = Number(reservation.taxRate) || 0

  let discountAmount = 0
  if (discountType === 'PERCENTAGE' && discountValue > 0) {
    discountAmount = newSubtotalSum * (discountValue / 100)
  } else if (discountType === 'FIXED' && discountValue > 0) {
    discountAmount = Math.min(discountValue, newSubtotalSum)
  }

  const afterDiscount = newSubtotalSum - discountAmount
  const creditAmount = Number(reservation.rentalCreditAmount) || 0
  const afterCredit = afterDiscount - creditAmount
  const taxAmount = afterCredit * (taxRate / 100)
  const logistics = (Number(reservation.deliveryCost) || 0) + (Number(reservation.returnCost) || 0)
  const total = afterCredit + taxAmount + logistics
  const totalMargin = newSubtotalSum - totalCost

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      subtotal: newSubtotalSum,
      discountAmount,
      taxAmount,
      total,
      totalCost,
      totalMargin,
      priceVerified: false,
    },
  })

  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}

// ===========================================================================
// Asset/unit allocation for SALE and CLOUD orders.
// Mirrors the rental-side `assignUnit`/`unassignUnit` flow but is permitted in
// any non-terminal status (DRAFT through ACTIVE) so users can earmark inventory
// during quoting. Allocated units flip to RESERVED so they can't be sold or
// rented twice.
// ===========================================================================

const ALLOCATABLE_STATUSES = [
  'DRAFT', 'QUOTE_SENT', 'REVISION', 'APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE',
] as const

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'LOST'] as const

/**
 * Search for AssetUnits the user can allocate to a sale/cloud line item.
 * Returns AVAILABLE units of the line's asset, plus any already allocated
 * to this same item (so the picker can show current allocations as selected).
 */
export async function searchAllocatableUnits(reservationItemId: string, query: string = '') {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  const item = await prisma.reservationItem.findUnique({
    where: { id: reservationItemId },
    select: {
      assetId: true,
      reservation: { select: { id: true, reservationType: true, status: true } },
      units: { select: { assetUnitId: true } },
    },
  })
  if (!item || !item.assetId) return []

  const allocatedToThisItem = item.units.map((u) => u.assetUnitId)
  const q = query.trim().toLowerCase()

  const units = await prisma.assetUnit.findMany({
    where: {
      assetId: item.assetId,
      OR: [
        // AVAILABLE units anywhere
        { status: 'AVAILABLE' },
        // Units already allocated to this same line (so user sees them as picked)
        { id: { in: allocatedToThisItem } },
      ],
      ...(q
        ? {
            OR: [
              { barcode: { contains: q, mode: 'insensitive' } },
              { serialNumber: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { location: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { barcode: 'asc' }],
    take: 50,
  })

  return units.map((u) => ({
    id: u.id,
    barcode: u.barcode,
    serialNumber: u.serialNumber,
    status: u.status,
    condition: u.condition,
    locationName: u.location?.name || null,
    isAllocatedHere: allocatedToThisItem.includes(u.id),
  }))
}

/**
 * Allocate a specific physical unit to a sale or cloud reservation item.
 * Marks the unit RESERVED so it can't be double-booked. Idempotent.
 */
export async function allocateUnitToItem(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string,
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { items: { where: { id: reservationItemId } } },
    })
    if (!reservation) throw new Error('Order not found')
    if (TERMINAL_STATUSES.includes(reservation.status as any)) {
      throw new Error(`Cannot allocate units on a ${reservation.status.toLowerCase()} order`)
    }

    const item = reservation.items[0]
    if (!item) throw new Error('Line item not found')
    if (!item.assetId) throw new Error('Cannot allocate units to ad-hoc items')

    // Don't exceed line quantity
    const existingCount = await tx.reservationItemUnit.count({
      where: { reservationItemId },
    })
    const alreadyAllocated = await tx.reservationItemUnit.findUnique({
      where: { reservationItemId_assetUnitId: { reservationItemId, assetUnitId } },
    })
    if (!alreadyAllocated && existingCount >= item.quantity) {
      throw new Error(
        `All ${item.quantity} units for this line are already allocated. Increase the quantity first.`,
      )
    }

    const unit = await tx.assetUnit.findUnique({ where: { id: assetUnitId } })
    if (!unit) throw new Error('Unit not found')
    if (unit.assetId !== item.assetId) {
      throw new Error('Unit does not belong to the line item\'s asset')
    }
    if (!['AVAILABLE', 'RESERVED'].includes(unit.status)) {
      throw new Error(`Unit is ${unit.status.toLowerCase()} — cannot allocate`)
    }

    // Block units already reserved by another order
    if (unit.status === 'RESERVED') {
      const otherAllocation = await tx.reservationItemUnit.findFirst({
        where: {
          assetUnitId,
          reservationItemId: { not: reservationItemId },
          reservationItem: {
            reservation: { status: { notIn: ['COMPLETED', 'CANCELLED', 'LOST'] } },
          },
        },
      })
      if (otherAllocation) {
        throw new Error('Unit is already reserved by another order')
      }
    }

    // Create or refresh the junction record
    await tx.reservationItemUnit.upsert({
      where: { reservationItemId_assetUnitId: { reservationItemId, assetUnitId } },
      create: {
        reservationItemId,
        assetUnitId,
        assignedAt: new Date(),
      },
      update: { assignedAt: new Date(), checkedInAt: null },
    })

    // Bump assignedCount on the line for parity with rental flow
    if (!alreadyAllocated) {
      await tx.reservationItem.update({
        where: { id: reservationItemId },
        data: { assignedCount: { increment: 1 } },
      })
    }

    // Reserve the unit
    await tx.assetUnit.update({
      where: { id: assetUnitId },
      data: { status: 'RESERVED' },
    })

    return { success: true }
  }).then((res) => {
    revalidatePath(`/dashboard/sales/${reservationId}`)
    revalidatePath(`/dashboard/cloud`)
    revalidatePath(`/dashboard/reservations/${reservationId}`)
    revalidatePath('/dashboard/assets')
    return res
  })
}

/**
 * Release a unit from a sale/cloud line. Reverts the unit to AVAILABLE
 * unless it has already been sold or otherwise locked.
 */
export async function deallocateUnitFromItem(
  reservationId: string,
  reservationItemId: string,
  assetUnitId: string,
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Order not found')
    if (TERMINAL_STATUSES.includes(reservation.status as any)) {
      throw new Error(`Cannot change allocations on a ${reservation.status.toLowerCase()} order`)
    }

    const junction = await tx.reservationItemUnit.findUnique({
      where: { reservationItemId_assetUnitId: { reservationItemId, assetUnitId } },
    })
    if (!junction) throw new Error('Unit is not allocated to this line')

    await tx.reservationItemUnit.delete({ where: { id: junction.id } })
    await tx.reservationItem.update({
      where: { id: reservationItemId },
      data: { assignedCount: { decrement: 1 } },
    })

    // Restore unit status — but only if it isn't sold/retired/checked-out
    // somewhere else
    const unit = await tx.assetUnit.findUnique({ where: { id: assetUnitId } })
    if (unit && unit.status === 'RESERVED') {
      // Check if any other active allocation still holds this unit
      const stillHeld = await tx.reservationItemUnit.findFirst({
        where: {
          assetUnitId,
          reservationItem: {
            reservation: { status: { notIn: ['COMPLETED', 'CANCELLED', 'LOST'] } },
          },
        },
      })
      if (!stillHeld) {
        await tx.assetUnit.update({
          where: { id: assetUnitId },
          data: { status: 'AVAILABLE' },
        })
      }
    }

    return { success: true }
  }).then((res) => {
    revalidatePath(`/dashboard/sales/${reservationId}`)
    revalidatePath(`/dashboard/cloud`)
    revalidatePath(`/dashboard/reservations/${reservationId}`)
    revalidatePath('/dashboard/assets')
    return res
  })
}

/**
 * Auto-allocate AVAILABLE units up to the line's quantity. Handy for cloud
 * hosts where the user already picked a backing asset + host count.
 * Returns the number of units actually allocated.
 */
export async function autoAllocateUnitsForItem(
  reservationId: string,
  reservationItemId: string,
): Promise<{ allocated: number; needed: number }> {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new Error('Order not found')
    if (TERMINAL_STATUSES.includes(reservation.status as any)) {
      throw new Error(`Cannot allocate units on a ${reservation.status.toLowerCase()} order`)
    }

    const item = await tx.reservationItem.findUnique({
      where: { id: reservationItemId },
      include: { units: true },
    })
    if (!item) throw new Error('Line item not found')
    if (!item.assetId) throw new Error('Cannot allocate units to ad-hoc items')

    const needed = item.quantity - item.units.length
    if (needed <= 0) return { allocated: 0, needed: 0 }

    const candidates = await tx.assetUnit.findMany({
      where: {
        assetId: item.assetId,
        status: 'AVAILABLE',
        id: { notIn: item.units.map((u) => u.assetUnitId) },
      },
      take: needed,
      orderBy: { barcode: 'asc' },
    })

    for (const unit of candidates) {
      await tx.reservationItemUnit.create({
        data: {
          reservationItemId,
          assetUnitId: unit.id,
          assignedAt: new Date(),
        },
      })
      await tx.assetUnit.update({
        where: { id: unit.id },
        data: { status: 'RESERVED' },
      })
    }

    if (candidates.length > 0) {
      await tx.reservationItem.update({
        where: { id: reservationItemId },
        data: { assignedCount: { increment: candidates.length } },
      })
    }

    return { allocated: candidates.length, needed }
  }).then((res) => {
    revalidatePath(`/dashboard/sales/${reservationId}`)
    revalidatePath(`/dashboard/cloud`)
    revalidatePath(`/dashboard/reservations/${reservationId}`)
    revalidatePath('/dashboard/assets')
    return res
  })
}

/**
 * Update internal costs (shipping, sub-rental, hardware) on any reservation/sale and recalculate margins.
 */
export async function updateInternalCosts(
  reservationId: string,
  costs: { internalShippingCost?: number; subRentalCost?: number; hardwareCost?: number }
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')

  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      internalShippingCost: costs.internalShippingCost ?? undefined,
      subRentalCost: costs.subRentalCost ?? undefined,
      hardwareCost: costs.hardwareCost ?? undefined,
    },
  })

  await recalculateSaleMarginTotals(reservationId)

  revalidatePath(`/dashboard/reservations/${reservationId}`)
  revalidatePath(`/dashboard/sales/${reservationId}`)
  return { success: true }
}
