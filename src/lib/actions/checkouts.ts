'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { requireAuth, requireEditor, requireAdmin } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { recomputeUnitRevenue } from '@/lib/utils/revenue'
import { calculatePeriods, computeItemSubtotal } from '@/lib/pricing/periods'
import type { CheckoutStatus, PricingType } from '@/lib/types'

export type CheckoutFormData = {
  assetUnitId: string
  clientId: string
  checkoutDate?: Date
  expectedReturn?: Date
  pricingType?: PricingType
  rate?: number
  conditionOut?: string
  notes?: string
}

export type CheckoutFilters = {
  search?: string
  status?: CheckoutStatus
  clientId?: string
}

export async function getCheckouts(filters: CheckoutFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, clientId } = filters

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { assetUnit: { asset: { name: { contains: search, mode: 'insensitive' } } } },
      { assetUnit: { barcode: { contains: search, mode: 'insensitive' } } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { client: { companyName: { contains: search, mode: 'insensitive' } } },
    ]
  }

  if (status) {
    where.status = status
  }

  if (clientId) {
    where.clientId = clientId
  }

  const checkouts = await prisma.checkout.findMany({
    where,
    include: {
      assetUnit: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
        },
      },
      client: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { checkoutDate: 'desc' },
  })

  return serialize(checkouts)
}

export async function getCheckout(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const checkout = await prisma.checkout.findUnique({
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
      client: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      approvals: {
        include: {
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  })

  return serialize(checkout)
}

export async function createCheckout(data: CheckoutFormData) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  // Calculate total charge based on pricing type and dates
  let totalCharge: number | undefined
  if (data.rate && data.expectedReturn && data.checkoutDate) {
    const checkoutDate = data.checkoutDate || new Date()
    const returnDate = data.expectedReturn

    // Shares the reservation term math: the period count is prorated, so a 6-week
    // checkout of a monthly-rate unit charges 1.38 months rather than a flat one.
    totalCharge = computeItemSubtotal(
      data.rate,
      1,
      calculatePeriods(checkoutDate, returnDate, data.pricingType || 'DAILY')
    )
  }

  const checkout = await prisma.$transaction(async (tx) => {
    // Create the checkout
    const newCheckout = await tx.checkout.create({
      data: {
        assetUnitId: data.assetUnitId,
        clientId: data.clientId,
        checkoutDate: data.checkoutDate || new Date(),
        expectedReturn: data.expectedReturn,
        pricingType: data.pricingType || 'DAILY',
        rate: data.rate,
        totalCharge,
        conditionOut: data.conditionOut,
        notes: data.notes,
        status: 'ACTIVE',
        createdById: session.user.id,
      },
      include: {
        assetUnit: {
          include: {
            asset: true,
          },
        },
        client: true,
      },
    })

    // Update asset unit status
    await tx.assetUnit.update({
      where: { id: data.assetUnitId },
      data: { status: 'CHECKED_OUT' },
    })
    // Credit the unit's earned revenue now that it's checked out
    await recomputeUnitRevenue(tx, data.assetUnitId)

    return newCheckout
  })

  revalidatePath('/dashboard/checkouts')
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(checkout)
}

export type ReturnCheckoutData = {
  conditionIn?: string
  notes?: string
  actualCharge?: number
}

export async function returnCheckout(id: string, data: ReturnCheckoutData = {}) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const checkout = await prisma.$transaction(async (tx) => {
    const existingCheckout = await tx.checkout.findUnique({
      where: { id },
      include: { assetUnit: true },
    })

    if (!existingCheckout) {
      throw new Error('Checkout not found')
    }

    // Calculate final charge if actual charge not provided
    let finalCharge = data.actualCharge
    if (!finalCharge && existingCheckout.rate) {
      const checkoutDate = existingCheckout.checkoutDate
      const returnDate = new Date()

      // PROJECT/CUSTOM are flat figures for the whole engagement — the agreed
      // total stands regardless of when the unit actually came back.
      if (existingCheckout.pricingType === 'PROJECT' || existingCheckout.pricingType === 'CUSTOM') {
        finalCharge = Number(existingCheckout.totalCharge)
      } else {
        finalCharge = computeItemSubtotal(
          Number(existingCheckout.rate),
          1,
          calculatePeriods(checkoutDate, returnDate, existingCheckout.pricingType)
        )
      }
    }

    // Update checkout
    const updatedCheckout = await tx.checkout.update({
      where: { id },
      data: {
        status: 'RETURNED',
        actualReturn: new Date(),
        conditionIn: data.conditionIn,
        totalCharge: finalCharge,
        notes: data.notes
          ? existingCheckout.notes
            ? `${existingCheckout.notes}\n\nReturn notes: ${data.notes}`
            : `Return notes: ${data.notes}`
          : existingCheckout.notes,
      },
      include: {
        assetUnit: {
          include: {
            asset: true,
          },
        },
        client: true,
      },
    })

    // Update asset unit status. totalCharge on the checkout was just set to the
    // final charge above; re-derive the unit's revenue from it rather than
    // incrementing (the charge was already credited at checkout time).
    await tx.assetUnit.update({
      where: { id: existingCheckout.assetUnitId },
      data: { status: 'AVAILABLE' },
    })
    await recomputeUnitRevenue(tx, existingCheckout.assetUnitId)

    return updatedCheckout
  })

  revalidatePath('/dashboard/checkouts')
  revalidatePath(`/dashboard/checkouts/${id}`)
  revalidatePath('/dashboard/assets')
  revalidatePath(`/dashboard/assets/${checkout.assetUnit.assetId}`)
  revalidatePath('/dashboard')

  return serialize(checkout)
}

export async function cancelCheckout(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const checkout = await prisma.$transaction(async (tx) => {
    const existingCheckout = await tx.checkout.findUnique({
      where: { id },
    })

    if (!existingCheckout) {
      throw new Error('Checkout not found')
    }

    // Update checkout
    const updatedCheckout = await tx.checkout.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
    })

    // Update asset unit status back to available
    await tx.assetUnit.update({
      where: { id: existingCheckout.assetUnitId },
      data: { status: 'AVAILABLE' },
    })
    // Canceled checkouts no longer count — re-derive the unit's revenue
    await recomputeUnitRevenue(tx, existingCheckout.assetUnitId)

    return updatedCheckout
  })

  revalidatePath('/dashboard/checkouts')
  revalidatePath(`/dashboard/checkouts/${id}`)
  revalidatePath('/dashboard/assets')
  revalidatePath('/dashboard')

  return serialize(checkout)
}

export async function getCheckoutStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [total, active, overdue, returned] = await Promise.all([
    prisma.checkout.count(),
    prisma.checkout.count({
      where: {
        status: { in: ['ACTIVE', 'APPROVED'] },
      },
    }),
    prisma.checkout.count({
      where: {
        status: 'ACTIVE',
        expectedReturn: { lt: new Date() },
      },
    }),
    prisma.checkout.count({
      where: { status: 'RETURNED' },
    }),
  ])

  return {
    total,
    active,
    overdue,
    returned,
  }
}

export async function getAvailableAssets() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  // Return product types (Assets) with a count of available units
  const assets = await prisma.asset.findMany({
    where: {
      units: {
        some: {
          status: 'AVAILABLE',
        },
      },
    },
    include: {
      category: true,
      units: {
        where: { status: 'AVAILABLE' },
        select: {
          id: true,
          barcode: true,
          serialNumber: true,
          condition: true,
          locationId: true,
          location: true,
        },
      },
      _count: {
        select: {
          units: {
            where: { status: 'AVAILABLE' },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return serialize(assets)
}

export async function getRecentCheckouts(limit = 5) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const checkouts = await prisma.checkout.findMany({
    include: {
      assetUnit: {
        include: {
          asset: {
            include: {
              category: true,
            },
          },
        },
      },
      client: true,
    },
    orderBy: { checkoutDate: 'desc' },
    take: limit,
  })
  return serialize(checkouts)
}

// Mark overdue checkouts (can be run as a cron job)
export async function markOverdueCheckouts() {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const overdueCheckouts = await prisma.checkout.updateMany({
    where: {
      status: 'ACTIVE',
      expectedReturn: { lt: new Date() },
    },
    data: {
      status: 'OVERDUE',
    },
  })

  return overdueCheckouts.count
}

// ============================================
// IN/OUT ACTIVITY FEED
// ============================================

export type InOutDirection = 'OUT' | 'IN'

export type InOutActivity = {
  id: string
  direction: InOutDirection
  timestamp: Date
  asset: {
    id: string
    name: string
    barcode: string
    category: string
  }
  client: {
    id: string
    name: string
    companyName: string | null
  }
  reservation: {
    id: string
    reservationNumber: string
    projectName: string | null
  } | null
  checkoutId: string | null
  condition: string | null
  notes: string | null
  processedBy: string | null
}

export type InOutFilters = {
  search?: string
  direction?: InOutDirection
  days?: number // Last N days, default 30
  clientId?: string
  assetId?: string
}

export async function getInOutActivity(filters: InOutFilters = {}): Promise<InOutActivity[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, direction, days = 30, clientId, assetId } = filters

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - days)

  const activities: InOutActivity[] = []

  // Build common search conditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchCondition: any = search ? {
    OR: [
      { assetUnit: { asset: { name: { contains: search, mode: 'insensitive' } } } },
      { assetUnit: { barcode: { contains: search, mode: 'insensitive' } } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { client: { companyName: { contains: search, mode: 'insensitive' } } },
      { reservation: { reservationNumber: { contains: search, mode: 'insensitive' } } },
      { reservation: { projectName: { contains: search, mode: 'insensitive' } } },
    ]
  } : {}

  // Asset filter now targets the product type through the unit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetFilter: any = assetId ? { assetUnit: { assetId } } : {}

  // Get CHECK-OUTS (from Checkout records with checkoutDate)
  if (!direction || direction === 'OUT') {
    const checkouts = await prisma.checkout.findMany({
      where: {
        checkoutDate: { gte: sinceDate },
        ...(clientId && { clientId }),
        ...assetFilter,
        ...searchCondition,
      },
      include: {
        assetUnit: {
          include: {
            asset: {
              include: { category: true },
            },
          },
        },
        client: true,
        reservation: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { checkoutDate: 'desc' },
    })

    for (const checkout of checkouts) {
      activities.push({
        id: `out-${checkout.id}`,
        direction: 'OUT',
        timestamp: checkout.checkoutDate,
        asset: {
          id: checkout.assetUnit.asset.id,
          name: checkout.assetUnit.asset.name,
          barcode: checkout.assetUnit.barcode,
          category: checkout.assetUnit.asset.category.name,
        },
        client: {
          id: checkout.client.id,
          name: checkout.client.name,
          companyName: checkout.client.companyName,
        },
        reservation: checkout.reservation ? {
          id: checkout.reservation.id,
          reservationNumber: checkout.reservation.reservationNumber,
          projectName: checkout.reservation.projectName,
        } : null,
        checkoutId: checkout.id,
        condition: checkout.conditionOut,
        notes: checkout.notes,
        processedBy: checkout.createdBy?.name || null,
      })
    }
  }

  // Get CHECK-INS (from Checkout records with actualReturn)
  if (!direction || direction === 'IN') {
    const checkins = await prisma.checkout.findMany({
      where: {
        actualReturn: { gte: sinceDate },
        status: 'RETURNED',
        ...(clientId && { clientId }),
        ...assetFilter,
        ...searchCondition,
      },
      include: {
        assetUnit: {
          include: {
            asset: {
              include: { category: true },
            },
          },
        },
        client: true,
        reservation: true,
        checkedInBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { actualReturn: 'desc' },
    })

    for (const checkin of checkins) {
      if (checkin.actualReturn) {
        activities.push({
          id: `in-${checkin.id}`,
          direction: 'IN',
          timestamp: checkin.actualReturn,
          asset: {
            id: checkin.assetUnit.asset.id,
            name: checkin.assetUnit.asset.name,
            barcode: checkin.assetUnit.barcode,
            category: checkin.assetUnit.asset.category.name,
          },
          client: {
            id: checkin.client.id,
            name: checkin.client.name,
            companyName: checkin.client.companyName,
          },
          reservation: checkin.reservation ? {
            id: checkin.reservation.id,
            reservationNumber: checkin.reservation.reservationNumber,
            projectName: checkin.reservation.projectName,
          } : null,
          checkoutId: checkin.id,
          condition: checkin.conditionIn,
          notes: checkin.notes,
          processedBy: checkin.checkedInBy?.name || null,
        })
      }
    }
  }

  // Sort by timestamp descending
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return serialize(activities)
}

export async function getInOutStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  weekAgo.setHours(0, 0, 0, 0)

  const [
    todayOut,
    todayIn,
    weekOut,
    weekIn,
    currentlyOut,
    overdue,
  ] = await Promise.all([
    // Today's checkouts
    prisma.checkout.count({
      where: { checkoutDate: { gte: today } },
    }),
    // Today's checkins
    prisma.checkout.count({
      where: { actualReturn: { gte: today }, status: 'RETURNED' },
    }),
    // Week's checkouts
    prisma.checkout.count({
      where: { checkoutDate: { gte: weekAgo } },
    }),
    // Week's checkins
    prisma.checkout.count({
      where: { actualReturn: { gte: weekAgo }, status: 'RETURNED' },
    }),
    // Currently checked out
    prisma.checkout.count({
      where: { status: { in: ['ACTIVE', 'APPROVED', 'OVERDUE'] } },
    }),
    // Overdue
    prisma.checkout.count({
      where: {
        status: { in: ['ACTIVE', 'APPROVED'] },
        expectedReturn: { lt: new Date() },
      },
    }),
  ])

  return {
    today: { out: todayOut, in: todayIn },
    week: { out: weekOut, in: weekIn },
    currentlyOut,
    overdue,
  }
}
