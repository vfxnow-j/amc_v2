'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-utils'

export type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  type: 'reservation' | 'checkout' | 'maintenance' | 'task'
  status: string
  clientName?: string
  assetNames?: string[]
  color: string
  url: string
}

export async function getCalendarEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const events: CalendarEvent[] = []

  // Fetch reservations
  const reservations = await prisma.reservation.findMany({
    where: {
      OR: [
        {
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      ],
      status: { notIn: ['CANCELLED'] },
    },
    include: {
      client: { select: { name: true } },
      items: {
        include: {
          asset: { select: { name: true } },
        },
      },
    },
  })

  reservations.forEach((res) => {
    const statusColors: Record<string, string> = {
      DRAFT: '#94a3b8',
      QUOTE_SENT: '#f59e0b',
      APPROVED: '#3b82f6',
      REVISION: '#f59e0b',
      PREPARING: '#8b5cf6',
      SHIPPED: '#06b6d4',
      ACTIVE: '#22c55e',
      COMPLETED: '#6b7280',
    }

    // Show product type names with quantities
    const assetNames = res.items.map((i) => {
      const name = i.asset?.name || i.description || 'Ad-hoc item'
      return i.quantity > 1 ? `${i.quantity}x ${name}` : name
    })

    events.push({
      id: res.id,
      title: `${res.reservationNumber} - ${res.client.name}`,
      start: res.startDate,
      end: res.endDate,
      type: 'reservation',
      status: res.status,
      clientName: res.client.name,
      assetNames,
      color: statusColors[res.status] || '#3b82f6',
      url: `/dashboard/orders/${res.id}`,
    })
  })

  // Fetch active checkouts (that don't have a reservation)
  const checkouts = await prisma.checkout.findMany({
    where: {
      checkoutDate: { lte: endDate },
      OR: [
        { actualReturn: null, expectedReturn: { gte: startDate } },
        { actualReturn: { gte: startDate } },
      ],
      reservationId: null,
      status: { notIn: ['CANCELLED'] },
    },
    include: {
      client: { select: { name: true } },
      assetUnit: {
        select: {
          barcode: true,
          asset: { select: { name: true } },
        },
      },
    },
  })

  checkouts.forEach((checkout) => {
    const statusColors: Record<string, string> = {
      ACTIVE: '#f59e0b',
      OVERDUE: '#ef4444',
      RETURNED: '#6b7280',
    }

    events.push({
      id: checkout.id,
      title: `${checkout.assetUnit.asset.name} - ${checkout.client.name}`,
      start: checkout.checkoutDate,
      end: checkout.actualReturn || checkout.expectedReturn || checkout.checkoutDate,
      type: 'checkout',
      status: checkout.status,
      clientName: checkout.client.name,
      assetNames: [checkout.assetUnit.asset.name],
      color: statusColors[checkout.status] || '#f59e0b',
      url: `/dashboard/checkouts/${checkout.id}`,
    })
  })

  // Fetch maintenance records
  const maintenance = await prisma.maintenanceRecord.findMany({
    where: {
      OR: [
        { scheduledDate: { gte: startDate, lte: endDate } },
        { startDate: { gte: startDate, lte: endDate } },
        { completionDate: { gte: startDate, lte: endDate } },
      ],
      status: { notIn: ['CANCELLED'] },
    },
    include: {
      assetUnit: {
        select: {
          asset: { select: { name: true } },
        },
      },
    },
  })

  maintenance.forEach((maint) => {
    const statusColors: Record<string, string> = {
      SCHEDULED: '#8b5cf6',
      IN_PROGRESS: '#f59e0b',
      COMPLETED: '#6b7280',
    }

    const startDt = maint.startDate || maint.scheduledDate || maint.createdAt
    const endDt = maint.completionDate || startDt

    events.push({
      id: maint.id,
      title: `🔧 ${maint.assetUnit.asset.name}`,
      start: startDt,
      end: endDt,
      type: 'maintenance',
      status: maint.status,
      assetNames: [maint.assetUnit.asset.name],
      color: statusColors[maint.status] || '#8b5cf6',
      url: `/dashboard/maintenance/${maint.id}`,
    })
  })

  // Fetch Flow tasks with due dates in the range
  const tasks = await prisma.flowTask.findMany({
    where: {
      dueDate: { gte: startDate, lte: endDate },
      status: { notIn: ['COMPLETED'] },
    },
    include: {
      assignees: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  tasks.forEach((task) => {
    const priorityColors: Record<string, string> = {
      URGENT: '#ef4444',
      HIGH: '#f97316',
      MEDIUM: '#3b82f6',
      LOW: '#94a3b8',
    }

    events.push({
      id: `task-${task.id}`,
      title: task.title,
      start: task.dueDate!,
      end: task.dueDate!,
      type: 'task',
      status: task.status,
      clientName: task.assignees.map(a => a.name).join(', ') || undefined,
      assetNames: task.group ? [task.group.name] : undefined,
      color: priorityColors[task.priority] || '#3b82f6',
      url: '/dashboard/flow',
    })
  })

  return events
}

export async function getAssetAvailability(assetId: string, startDate: Date, endDate: Date) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  // For a product type, check how many units are available
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { totalQuantity: true },
  })

  // Check reservations for this product type in the date range
  const reservedItems = await prisma.reservationItem.findMany({
    where: {
      assetId,
      reservation: {
        status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    },
    include: {
      reservation: {
        select: {
          reservationNumber: true,
          startDate: true,
          endDate: true,
          client: { select: { name: true } },
        },
      },
    },
  })

  const totalReservedQuantity = reservedItems.reduce((sum, item) => sum + item.quantity, 0)

  // Check units currently in maintenance
  const maintenanceCount = await prisma.assetUnit.count({
    where: {
      assetId,
      status: { in: ['MAINTENANCE', 'RETIRED'] },
    },
  })

  const totalQuantity = asset?.totalQuantity || 0
  const availableCount = Math.max(0, totalQuantity - totalReservedQuantity - maintenanceCount)

  return {
    isAvailable: availableCount > 0,
    totalQuantity,
    availableCount,
    reservedQuantity: totalReservedQuantity,
    maintenanceCount,
    conflicts: {
      reservations: reservedItems.map((r) => ({
        id: r.reservation.reservationNumber,
        start: r.reservation.startDate,
        end: r.reservation.endDate,
        client: r.reservation.client.name,
        quantity: r.quantity,
      })),
    },
  }
}

export async function getMonthSummary(year: number, month: number) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const startDate = new Date(year, month, 1)
  const endDate = new Date(year, month + 1, 0, 23, 59, 59)

  const [reservationCount, checkoutCount, maintenanceCount, revenue] = await Promise.all([
    prisma.reservation.count({
      where: {
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        status: { notIn: ['CANCELLED'] },
      },
    }),
    prisma.checkout.count({
      where: {
        checkoutDate: { gte: startDate, lte: endDate },
      },
    }),
    prisma.maintenanceRecord.count({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
    }),
    prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { total: true },
    }),
  ])

  return {
    reservationCount,
    checkoutCount,
    maintenanceCount,
    revenue: Number(revenue._sum.total || 0),
  }
}
