'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { calculateDepreciatedValue, type DepreciationMethod } from '@/lib/utils/depreciation'
import { getDerivedOwnershipStatus, type OwnershipType, type AssetStatus } from '@/lib/types'

export type DateRange = {
  startDate: Date
  endDate: Date
}

// Dashboard overview stats
export async function getDashboardStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfYear = new Date(today.getFullYear(), 0, 1)

  const [
    totalUnits,
    activeUnits,
    availableUnits,
    checkedOutUnits,
    maintenanceUnits,
    soldUnits,
    totalProductTypes,
    totalClients,
    activeCheckouts,
    overdueCheckouts,
    monthlyRevenue,
    yearlyRevenue,
    pendingInvoices,
    overdueInvoices,
    completedSalesCount,
    salesRevenue,
  ] = await Promise.all([
    prisma.assetUnit.count(),
    prisma.assetUnit.count({ where: { status: { in: ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED'] } } }),
    prisma.assetUnit.count({ where: { status: 'AVAILABLE' } }),
    prisma.assetUnit.count({ where: { status: 'CHECKED_OUT' } }),
    prisma.assetUnit.count({ where: { status: 'MAINTENANCE' } }),
    prisma.assetUnit.count({ where: { status: 'SOLD' } }),
    prisma.asset.count(),
    prisma.client.count({
      where: {
        reservations: {
          some: {
            status: { in: ['QUOTE_SENT', 'APPROVED', 'REVISION', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
          },
        },
      },
    }),
    prisma.checkout.count({ where: { status: 'ACTIVE' } }),
    prisma.checkout.count({ where: { status: 'OVERDUE' } }),
    prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: { gte: startOfMonth },
      },
      _sum: { total: true },
    }),
    prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: { gte: startOfYear },
      },
      _sum: { total: true },
    }),
    prisma.invoice.count({ where: { status: { in: ['SENT', 'PARTIAL'] } } }),
    prisma.invoice.count({ where: { status: 'OVERDUE' } }),
    prisma.reservation.count({ where: { reservationType: 'SALE', status: 'COMPLETED' } }),
    prisma.reservation.aggregate({
      where: { reservationType: 'SALE', status: 'COMPLETED' },
      _sum: { total: true },
    }),
  ])

  return {
    assets: {
      total: totalUnits,
      active: activeUnits,
      available: availableUnits,
      checkedOut: checkedOutUnits,
      maintenance: maintenanceUnits,
      sold: soldUnits,
      productTypes: totalProductTypes,
      utilizationRate: activeUnits > 0 ? Math.round((checkedOutUnits / activeUnits) * 100) : 0,
    },
    clients: {
      total: totalClients,
    },
    checkouts: {
      active: activeCheckouts,
      overdue: overdueCheckouts,
    },
    revenue: {
      monthly: Number(monthlyRevenue._sum.total || 0),
      yearly: Number(yearlyRevenue._sum.total || 0),
    },
    invoices: {
      pending: pendingInvoices,
      overdue: overdueInvoices,
    },
    sales: {
      completed: completedSalesCount,
      revenue: Number(salesRevenue._sum.total || 0),
    },
  }
}

// Asset utilization report
export async function getAssetUtilizationReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 3))
  const endDate = range?.endDate || new Date()

  const checkouts = await prisma.checkout.findMany({
    where: {
      checkoutDate: { gte: startDate, lte: endDate },
      assetUnit: { status: { not: 'RETIRED' } },
    },
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
        },
      },
    },
  })

  // Calculate utilization by category (retired units excluded above)
  const categoryStats = new Map<string, { checkouts: number; totalDays: number; assets: Set<string> }>()

  checkouts.forEach((checkout) => {
    const categoryName = checkout.assetUnit.asset.category?.name || 'Uncategorized'
    const checkoutDate = new Date(checkout.checkoutDate)
    const returnDate = checkout.actualReturn ? new Date(checkout.actualReturn) : new Date()
    const days = Math.max(1, Math.ceil((returnDate.getTime() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24)))

    if (!categoryStats.has(categoryName)) {
      categoryStats.set(categoryName, { checkouts: 0, totalDays: 0, assets: new Set() })
    }

    const stats = categoryStats.get(categoryName)!
    stats.checkouts++
    stats.totalDays += days
    stats.assets.add(checkout.assetUnit.assetId)
  })

  const utilizationByCategory = Array.from(categoryStats.entries()).map(([category, stats]) => ({
    category,
    checkoutCount: stats.checkouts,
    totalDays: stats.totalDays,
    uniqueAssets: stats.assets.size,
    avgDaysPerCheckout: Math.round(stats.totalDays / stats.checkouts),
  }))

  // Top utilized assets (by product type, exclude retired units)
  const assetUtilization = await prisma.checkout.groupBy({
    by: ['assetUnitId'],
    where: {
      checkoutDate: { gte: startDate, lte: endDate },
      assetUnit: { status: { not: 'RETIRED' } },
    },
    _count: { id: true },
  })

  // Get the top unit IDs, then map to product types
  const topUnitIds = assetUtilization
    .sort((a, b) => b._count.id - a._count.id)
    .slice(0, 10)
    .map((a) => a.assetUnitId)

  const topUnits = await prisma.assetUnit.findMany({
    where: { id: { in: topUnitIds } },
    include: { asset: { include: { category: true } } },
  })

  const topUtilizedAssets = topUnitIds.map((unitId) => {
    const unit = topUnits.find((u) => u.id === unitId)!
    const utilization = assetUtilization.find((u) => u.assetUnitId === unitId)!
    return {
      id: unit.asset.id,
      name: unit.asset.name,
      barcode: unit.barcode,
      category: unit.asset.category?.name || 'Uncategorized',
      checkoutCount: utilization._count.id,
    }
  })

  return {
    period: { startDate, endDate },
    totalCheckouts: checkouts.length,
    utilizationByCategory,
    topUtilizedAssets,
  }
}

// Revenue report
export async function getRevenueReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 12))
  const endDate = range?.endDate || new Date()

  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      client: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const monthlyRevenue = new Map<string, number>()
  invoices.forEach((invoice) => {
    const monthKey = `${invoice.createdAt.getFullYear()}-${String(invoice.createdAt.getMonth() + 1).padStart(2, '0')}`
    const current = monthlyRevenue.get(monthKey) || 0
    monthlyRevenue.set(monthKey, current + Number(invoice.total))
  })

  const clientRevenue = new Map<string, { name: string; total: number; count: number }>()
  invoices.forEach((invoice) => {
    const clientId = invoice.clientId
    const current = clientRevenue.get(clientId) || { name: invoice.client.name, total: 0, count: 0 }
    current.total += Number(invoice.total)
    current.count++
    clientRevenue.set(clientId, current)
  })

  const topClients = Array.from(clientRevenue.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total), 0)
  const avgInvoiceValue = invoices.length > 0 ? totalRevenue / invoices.length : 0

  return {
    period: { startDate, endDate },
    totalRevenue,
    invoiceCount: invoices.length,
    avgInvoiceValue,
    monthlyBreakdown: Array.from(monthlyRevenue.entries()).map(([month, total]) => ({
      month,
      total,
    })),
    topClients,
  }
}

// Checkout history report
export async function getCheckoutHistoryReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 1))
  const endDate = range?.endDate || new Date()

  const checkouts = await prisma.checkout.findMany({
    where: {
      checkoutDate: { gte: startDate, lte: endDate },
    },
    include: {
      assetUnit: {
        include: { asset: { include: { category: true } } },
      },
      client: true,
    },
    orderBy: { checkoutDate: 'desc' },
  })

  const totalCheckouts = checkouts.length
  const returned = checkouts.filter((c) => c.status === 'RETURNED').length
  const active = checkouts.filter((c) => c.status === 'ACTIVE').length
  const overdue = checkouts.filter((c) => c.status === 'OVERDUE').length

  const returnedCheckouts = checkouts.filter((c) => c.actualReturn)
  const totalDays = returnedCheckouts.reduce((sum, c) => {
    const days = Math.ceil(
      (new Date(c.actualReturn!).getTime() - new Date(c.checkoutDate).getTime()) / (1000 * 60 * 60 * 24)
    )
    return sum + days
  }, 0)
  const avgDuration = returnedCheckouts.length > 0 ? Math.round(totalDays / returnedCheckouts.length) : 0

  const dailyCheckouts = new Map<string, number>()
  checkouts.forEach((checkout) => {
    const dayKey = checkout.checkoutDate.toISOString().split('T')[0]
    dailyCheckouts.set(dayKey, (dailyCheckouts.get(dayKey) || 0) + 1)
  })

  return {
    period: { startDate, endDate },
    summary: {
      total: totalCheckouts,
      returned,
      active,
      overdue,
      avgDurationDays: avgDuration,
    },
    dailyBreakdown: Array.from(dailyCheckouts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    recentCheckouts: checkouts.slice(0, 20).map((c) => ({
      id: c.id,
      assetName: c.assetUnit.asset.name,
      barcode: c.assetUnit.barcode,
      clientName: c.client.name,
      checkoutDate: c.checkoutDate,
      returnDate: c.actualReturn,
      status: c.status,
    })),
  }
}

// Maintenance cost report
export async function getMaintenanceCostReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1))
  const endDate = range?.endDate || new Date()

  const maintenanceRecords = await prisma.maintenanceRecord.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      status: 'COMPLETED',
    },
    include: {
      assetUnit: {
        include: { asset: { include: { category: true } } },
      },
    },
  })

  const totalLaborCost = maintenanceRecords.reduce((sum, r) => sum + Number(r.laborCost || 0), 0)
  const totalPartsCost = maintenanceRecords.reduce((sum, r) => sum + Number(r.partsCost || 0), 0)
  const totalCost = totalLaborCost + totalPartsCost

  const costByType = new Map<string, { count: number; cost: number }>()
  maintenanceRecords.forEach((record) => {
    const type = record.type
    const current = costByType.get(type) || { count: 0, cost: 0 }
    current.count++
    current.cost += Number(record.totalCost || 0)
    costByType.set(type, current)
  })

  const costByCategory = new Map<string, { count: number; cost: number }>()
  maintenanceRecords.forEach((record) => {
    const category = record.assetUnit.asset.category?.name || 'Uncategorized'
    const current = costByCategory.get(category) || { count: 0, cost: 0 }
    current.count++
    current.cost += Number(record.totalCost || 0)
    costByCategory.set(category, current)
  })

  const monthlyCosts = new Map<string, number>()
  maintenanceRecords.forEach((record) => {
    const monthKey = `${record.createdAt.getFullYear()}-${String(record.createdAt.getMonth() + 1).padStart(2, '0')}`
    monthlyCosts.set(monthKey, (monthlyCosts.get(monthKey) || 0) + Number(record.totalCost || 0))
  })

  return {
    period: { startDate, endDate },
    summary: {
      totalRecords: maintenanceRecords.length,
      totalLaborCost,
      totalPartsCost,
      totalCost,
      avgCostPerRecord: maintenanceRecords.length > 0 ? totalCost / maintenanceRecords.length : 0,
    },
    byType: Array.from(costByType.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      cost: data.cost,
    })),
    byCategory: Array.from(costByCategory.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        cost: data.cost,
      }))
      .sort((a, b) => b.cost - a.cost),
    monthlyBreakdown: Array.from(monthlyCosts.entries())
      .map(([month, cost]) => ({ month, cost }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  }
}

// Client activity report
export async function getClientActivityReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 3))
  const endDate = range?.endDate || new Date()

  const clients = await prisma.client.findMany({
    include: {
      checkouts: {
        where: {
          checkoutDate: { gte: startDate, lte: endDate },
        },
      },
      invoices: {
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      },
      reservations: {
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      },
    },
  })

  const clientActivity = clients
    .map((client) => {
      const totalInvoiced = client.invoices.reduce((sum, inv) => sum + Number(inv.total), 0)
      const paidInvoices = client.invoices.filter((inv) => inv.status === 'PAID')
      const totalPaid = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0)

      return {
        id: client.id,
        name: client.name,
        companyName: client.companyName,
        checkoutCount: client.checkouts.length,
        reservationCount: client.reservations.length,
        invoiceCount: client.invoices.length,
        totalInvoiced,
        totalPaid,
        outstandingBalance: totalInvoiced - totalPaid,
      }
    })
    .filter((c) => c.checkoutCount > 0 || c.invoiceCount > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid)

  const activeClients = clientActivity.filter((c) => c.checkoutCount > 0).length
  const totalRevenue = clientActivity.reduce((sum, c) => sum + c.totalPaid, 0)
  const totalOutstanding = clientActivity.reduce((sum, c) => sum + c.outstandingBalance, 0)

  return {
    period: { startDate, endDate },
    summary: {
      totalClients: clients.length,
      activeClients,
      totalRevenue,
      totalOutstanding,
    },
    clients: clientActivity.slice(0, 20),
  }
}

// Traffic report - individual asset unit movement tracking
export type TrafficReportFilters = {
  search?: string
  clientId?: string
  status?: string
  startDate?: Date
  endDate?: Date
}

export async function getTrafficReport(filters: TrafficReportFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const startDate = filters.startDate || new Date(new Date().setMonth(new Date().getMonth() - 3))
  const endDate = filters.endDate || new Date()

  const where: Record<string, unknown> = {
    checkoutDate: { gte: startDate, lte: endDate },
  }

  if (filters.search) {
    where.OR = [
      { assetUnit: { asset: { name: { contains: filters.search, mode: 'insensitive' } } } },
      { assetUnit: { barcode: { contains: filters.search, mode: 'insensitive' } } },
      { assetUnit: { serialNumber: { contains: filters.search, mode: 'insensitive' } } },
      { client: { name: { contains: filters.search, mode: 'insensitive' } } },
      { client: { companyName: { contains: filters.search, mode: 'insensitive' } } },
    ]
  }
  if (filters.clientId) where.clientId = filters.clientId
  if (filters.status) where.status = filters.status

  const checkouts = await prisma.checkout.findMany({
    where,
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
        },
      },
      client: true,
    },
    orderBy: { checkoutDate: 'desc' },
  })

  const items = checkouts.map((c) => {
    const checkoutDate = new Date(c.checkoutDate)
    const returnDate = c.actualReturn ? new Date(c.actualReturn) : null
    const durationDays = returnDate
      ? Math.ceil((returnDate.getTime() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24))
      : null

    return {
      checkoutId: c.id,
      assetName: c.assetUnit.asset.name,
      assetId: c.assetUnit.asset.id,
      barcode: c.assetUnit.barcode,
      serialNumber: c.assetUnit.serialNumber,
      category: c.assetUnit.asset.category?.name || 'Uncategorized',
      clientId: c.client.id,
      clientName: c.client.name,
      clientCompany: c.client.companyName,
      checkoutDate: c.checkoutDate,
      expectedReturn: c.expectedReturn,
      actualReturn: c.actualReturn,
      durationDays,
      pricingType: c.pricingType,
      rate: c.rate ? Number(c.rate) : null,
      totalCharge: c.totalCharge ? Number(c.totalCharge) : null,
      conditionOut: c.conditionOut,
      conditionIn: c.conditionIn,
      damageFlag: c.damageFlag,
      damageNotes: c.damageNotes,
      ownershipType: c.assetUnit.ownershipType,
      loanAmount: c.assetUnit.loanAmount ? Number(c.assetUnit.loanAmount) : null,
      unitTotalRevenue: Number(c.assetUnit.totalRevenue || 0),
      unitStatus: c.assetUnit.status,
      soldAt: c.assetUnit.soldAt?.toISOString() || null,
      status: c.status,
    }
  })

  const totalRevenue = items.reduce((sum, item) => sum + (item.totalCharge || 0), 0)
  const returnedItems = items.filter((i) => i.durationDays !== null)
  const avgDurationDays = returnedItems.length > 0
    ? Math.round(returnedItems.reduce((s, i) => s + i.durationDays!, 0) / returnedItems.length)
    : 0
  const currentlyOut = items.filter((i) => i.status === 'ACTIVE' || i.status === 'APPROVED').length
  const overdueCount = items.filter((i) => i.status === 'OVERDUE').length
  const damagedCount = items.filter((i) => i.damageFlag).length
  const loanCount = items.filter((i) => i.ownershipType === 'LOAN').length

  return {
    items: items.map((item) => ({
      ...item,
      checkoutDate: item.checkoutDate.toISOString(),
      expectedReturn: item.expectedReturn?.toISOString() || null,
      actualReturn: item.actualReturn?.toISOString() || null,
    })),
    summary: {
      totalMovements: items.length,
      totalRevenue,
      avgDurationDays,
      currentlyOut,
      overdueCount,
      damagedCount,
      loanCount,
    },
  }
}

export type TrafficReportItem = Awaited<ReturnType<typeof getTrafficReport>>['items'][number]
export type TrafficReportSummary = Awaited<ReturnType<typeof getTrafficReport>>['summary']

// Full Inventory Report - complete asset snapshot with depreciation, ownership, and valuation
export async function getFullInventoryReport() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const units = await prisma.assetUnit.findMany({
    where: {
      status: { in: ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED', 'RETIRED'] },
    },
    include: {
      asset: {
        include: { category: true },
      },
      location: true,
    },
    orderBy: [
      { asset: { category: { name: 'asc' } } },
      { asset: { name: 'asc' } },
      { barcode: 'asc' },
    ],
  })

  const items = units.map((unit) => {
    const purchasePrice = Number(unit.purchasePrice || 0)
    const salvageValue = Number(unit.asset.salvageValue || 0)
    const usefulLifeMonths = unit.asset.usefulLifeMonths || 60
    const depreciationMethod = unit.asset.depreciationMethod as DepreciationMethod

    let currentBookValue = purchasePrice
    if (unit.purchaseDate && purchasePrice > 0) {
      currentBookValue = calculateDepreciatedValue(
        purchasePrice,
        unit.purchaseDate,
        depreciationMethod,
        usefulLifeMonths,
        salvageValue,
        unit.receivedDate
      )
    }

    const accumulatedDepreciation = purchasePrice - currentBookValue
    const depreciableBase = purchasePrice - salvageValue
    const totalRevenue = Number(unit.totalRevenue || 0)
    const maintenanceCost = Number(unit.maintenanceCost || 0)
    const ownershipStatus = getDerivedOwnershipStatus(
      unit.ownershipType as OwnershipType,
      unit.loanAmount ? Number(unit.loanAmount) : null,
      totalRevenue,
      unit.status as AssetStatus
    )

    return {
      assetName: unit.asset.name,
      category: unit.asset.category?.name || 'Uncategorized',
      barcode: unit.barcode,
      serialNumber: unit.serialNumber,
      status: unit.status,
      ownershipType: unit.ownershipType,
      ownershipStatus,
      loanName: unit.loanName || null,
      purchaseDate: unit.purchaseDate?.toISOString() || null,
      purchasePrice,
      salvageValue,
      depreciableBase,
      usefulLifeMonths,
      depreciationMethod,
      currentBookValue: Math.round(currentBookValue * 100) / 100,
      accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
      totalRevenue,
      maintenanceCost,
      location: unit.location?.name || '',
      retirementReason: unit.retirementReason || null,
      retiredAt: unit.retiredAt?.toISOString() || null,
      retiredTo: unit.retiredTo || null,
    }
  })

  // Compute summary
  const totalUnits = items.length
  const unitsOut = items.filter((i) => i.status === 'CHECKED_OUT').length
  const unitsIn = items.filter((i) => i.status === 'AVAILABLE').length
  const unitsMaintenance = items.filter((i) => i.status === 'MAINTENANCE').length
  const unitsReserved = items.filter((i) => i.status === 'RESERVED').length
  const unitsRetired = items.filter((i) => i.status === 'RETIRED').length

  // Financial metrics exclude retired assets — they are no longer active inventory
  const activeItems = items.filter((i) => i.status !== 'RETIRED')

  const totalPurchaseValue = activeItems.reduce((s, i) => s + i.purchasePrice, 0)
  const totalCurrentBookValue = activeItems.reduce((s, i) => s + i.currentBookValue, 0)
  const totalAccumulatedDepreciation = activeItems.reduce((s, i) => s + i.accumulatedDepreciation, 0)
  const totalSalvageValue = activeItems.reduce((s, i) => s + i.salvageValue, 0)
  const totalRevenue = activeItems.reduce((s, i) => s + i.totalRevenue, 0)
  const totalMaintenanceCost = activeItems.reduce((s, i) => s + i.maintenanceCost, 0)

  const outItems = items.filter((i) => i.status === 'CHECKED_OUT')
  const inItems = items.filter((i) => i.status === 'AVAILABLE')

  const valueOut = outItems.reduce((s, i) => s + i.currentBookValue, 0)
  const valueIn = inItems.reduce((s, i) => s + i.currentBookValue, 0)
  const purchaseValueOut = outItems.reduce((s, i) => s + i.purchasePrice, 0)
  const purchaseValueIn = inItems.reduce((s, i) => s + i.purchasePrice, 0)

  return {
    summary: {
      totalUnits,
      unitsOut,
      unitsIn,
      unitsMaintenance,
      unitsReserved,
      unitsRetired,
      totalPurchaseValue: Math.round(totalPurchaseValue * 100) / 100,
      totalCurrentBookValue: Math.round(totalCurrentBookValue * 100) / 100,
      totalAccumulatedDepreciation: Math.round(totalAccumulatedDepreciation * 100) / 100,
      totalSalvageValue: Math.round(totalSalvageValue * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalMaintenanceCost: Math.round(totalMaintenanceCost * 100) / 100,
      valueOut: Math.round(valueOut * 100) / 100,
      valueIn: Math.round(valueIn * 100) / 100,
      purchaseValueOut: Math.round(purchaseValueOut * 100) / 100,
      purchaseValueIn: Math.round(purchaseValueIn * 100) / 100,
    },
    items,
  }
}

export type InventoryReportData = Awaited<ReturnType<typeof getFullInventoryReport>>
export type InventoryReportItem = InventoryReportData['items'][number]
export type InventoryReportSummary = InventoryReportData['summary']

// Sales report
export async function getSalesReport(range?: DateRange) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  const startDate = range?.startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1))
  const endDate = range?.endDate || new Date()

  const sales = await prisma.reservation.findMany({
    where: {
      reservationType: 'SALE',
      createdAt: { gte: startDate, lte: endDate },
    },
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

  const completedSales = sales.filter((s) => s.status === 'COMPLETED')
  const totalRevenue = completedSales.reduce((sum, s) => sum + Number(s.total), 0)
  const totalUnitsSold = completedSales.reduce(
    (sum, s) => sum + s.items.reduce((iSum, item) => iSum + item.quantity, 0),
    0
  )

  // Revenue by month
  const monthlyRevenue = new Map<string, { revenue: number; count: number }>()
  completedSales.forEach((sale) => {
    const monthKey = `${sale.completedAt!.getFullYear()}-${String(sale.completedAt!.getMonth() + 1).padStart(2, '0')}`
    const current = monthlyRevenue.get(monthKey) || { revenue: 0, count: 0 }
    current.revenue += Number(sale.total)
    current.count++
    monthlyRevenue.set(monthKey, current)
  })

  // Revenue by category
  const categoryRevenue = new Map<string, { revenue: number; unitsSold: number }>()
  completedSales.forEach((sale) => {
    sale.items.forEach((item) => {
      const category = item.asset?.category?.name || 'Uncategorized'
      const current = categoryRevenue.get(category) || { revenue: 0, unitsSold: 0 }
      current.revenue += Number(item.subtotal)
      current.unitsSold += item.quantity
      categoryRevenue.set(category, current)
    })
  })

  // Revenue by client
  const clientRevenue = new Map<string, { name: string; revenue: number; salesCount: number }>()
  completedSales.forEach((sale) => {
    const current = clientRevenue.get(sale.clientId) || { name: sale.client.name, revenue: 0, salesCount: 0 }
    current.revenue += Number(sale.total)
    current.salesCount++
    clientRevenue.set(sale.clientId, current)
  })

  return {
    period: { startDate, endDate },
    summary: {
      totalSales: sales.length,
      completedSales: completedSales.length,
      pendingSales: sales.filter((s) => ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'PREPARING', 'SHIPPED'].includes(s.status)).length,
      cancelledSales: sales.filter((s) => s.status === 'CANCELLED').length,
      totalRevenue,
      totalUnitsSold,
      avgSaleValue: completedSales.length > 0 ? totalRevenue / completedSales.length : 0,
    },
    monthlyBreakdown: Array.from(monthlyRevenue.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: Array.from(categoryRevenue.entries())
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.revenue - a.revenue),
    topClients: Array.from(clientRevenue.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
  }
}

// ============================================
// KPIs + FORECAST
// ============================================

const LEAD_WEIGHTS: Record<string, number> = {
  NEW: 0.10,
  CONTACTED: 0.25,
  QUALIFIED: 0.50,
  PROSPECT: 0.75,
}

const RESERVATION_WEIGHTS: Record<string, number> = {
  ACTIVE: 1.0,
  APPROVED: 0.9,
  PREPARING: 0.95,
  SHIPPED: 0.95,
  QUOTE_SENT: 0.6,
  DRAFT: 0.4,
  REVISION: 0.4,
}

export type ForecastLineItem = {
  id: string
  label: string        // reservation number or invoice number
  clientName: string
  status: string
  rawTotal: number
  weight: number
  weightedTotal: number
}

export type ForecastLeadItem = {
  id: string
  name: string
  companyName: string | null
  stage: string
  estimatedValue: number
  weight: number
  weightedValue: number
}

export type ForecastMonth = {
  month: string // YYYY-MM
  label: string // "Feb 2026"
  confirmed: number
  drafts: number
  leadPipeline: number
  recurring: number
  totalForecast: number
  invoiced: number
  paid: number
  // Breakdown details
  confirmedItems: ForecastLineItem[]
  draftItems: ForecastLineItem[]
  recurringItems: ForecastLineItem[]
  invoicedItems: ForecastLineItem[]
  paidItems: ForecastLineItem[]
}

export type KpiTargets = {
  revenueTarget: number
  expenses: number
  payroll: number
}

export type ForecastReport = {
  months: ForecastMonth[]
  leadsByStage: { stage: string; count: number; rawValue: number; weightedValue: number }[]
  leadItems: ForecastLeadItem[]
  totalPipeline: number
  totalLeadPipeline: number
}

export async function getForecastReport(): Promise<ForecastReport> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const now = new Date()
  const months: ForecastMonth[] = []

  for (let i = 0; i < 3; i++) {
    const year = now.getFullYear()
    const monthIdx = now.getMonth() + i
    const start = new Date(year, monthIdx, 1)
    const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999)
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
    const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const resSelect = {
      id: true, reservationNumber: true, total: true, status: true,
      client: { select: { name: true, companyName: true } },
    } as const

    const [
      confirmedReservations,
      draftReservations,
      recurringReservations,
      invoicedRecords,
      paidRecords,
    ] = await Promise.all([
      // APPROVED/PREPARING/SHIPPED/ACTIVE reservations overlapping this month
      prisma.reservation.findMany({
        where: {
          status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: resSelect,
      }),
      // DRAFT/QUOTE_SENT/REVISION reservations overlapping this month
      prisma.reservation.findMany({
        where: {
          status: { in: ['DRAFT', 'QUOTE_SENT', 'REVISION'] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: resSelect,
      }),
      // Recurring reservations with nextBillingDate in this month
      prisma.reservation.findMany({
        where: {
          status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
          nextBillingDate: { gte: start, lte: end },
        },
        select: resSelect,
      }),
      // Invoiced actuals this month
      prisma.invoice.findMany({
        where: {
          issueDate: { gte: start, lte: end },
          status: { notIn: ['CANCELLED', 'VOID'] },
        },
        select: {
          id: true, invoiceNumber: true, total: true, status: true,
          reservation: { select: { client: { select: { name: true, companyName: true } } } },
        },
      }),
      // Paid actuals this month
      prisma.invoice.findMany({
        where: {
          issueDate: { gte: start, lte: end },
          status: 'PAID',
        },
        select: {
          id: true, invoiceNumber: true, amountPaid: true, status: true,
          reservation: { select: { client: { select: { name: true, companyName: true } } } },
        },
      }),
    ])

    // Build breakdown items
    const confirmedItems: ForecastLineItem[] = confirmedReservations.map((r) => {
      const weight = RESERVATION_WEIGHTS[r.status] ?? 0.9
      const raw = Number(r.total)
      return {
        id: r.id, label: r.reservationNumber,
        clientName: r.client?.companyName || r.client?.name || 'Unknown',
        status: r.status, rawTotal: raw, weight, weightedTotal: raw * weight,
      }
    })

    const draftItems: ForecastLineItem[] = draftReservations.map((r) => {
      const raw = Number(r.total)
      return {
        id: r.id, label: r.reservationNumber,
        clientName: r.client?.companyName || r.client?.name || 'Unknown',
        status: r.status, rawTotal: raw, weight: RESERVATION_WEIGHTS.DRAFT,
        weightedTotal: raw * RESERVATION_WEIGHTS.DRAFT,
      }
    })

    const recurringItems: ForecastLineItem[] = recurringReservations.map((r) => {
      const raw = Number(r.total)
      return {
        id: r.id, label: r.reservationNumber,
        clientName: r.client?.companyName || r.client?.name || 'Unknown',
        status: r.status, rawTotal: raw, weight: 0.95, weightedTotal: raw * 0.95,
      }
    })

    const invoicedItems: ForecastLineItem[] = invoicedRecords.map((inv) => {
      const raw = Number(inv.total)
      return {
        id: inv.id, label: inv.invoiceNumber,
        clientName: inv.reservation?.client?.companyName || inv.reservation?.client?.name || 'Unknown',
        status: inv.status, rawTotal: raw, weight: 1.0, weightedTotal: raw,
      }
    })

    const paidItems: ForecastLineItem[] = paidRecords.map((inv) => {
      const raw = Number(inv.amountPaid)
      return {
        id: inv.id, label: inv.invoiceNumber,
        clientName: inv.reservation?.client?.companyName || inv.reservation?.client?.name || 'Unknown',
        status: inv.status, rawTotal: raw, weight: 1.0, weightedTotal: raw,
      }
    })

    const confirmed = confirmedItems.reduce((sum, i) => sum + i.weightedTotal, 0)
    const drafts = draftItems.reduce((sum, i) => sum + i.weightedTotal, 0)
    const recurring = recurringItems.reduce((sum, i) => sum + i.weightedTotal, 0)
    const invoiced = invoicedItems.reduce((sum, i) => sum + i.rawTotal, 0)
    const paid = paidItems.reduce((sum, i) => sum + i.rawTotal, 0)

    months.push({
      month: monthKey,
      label,
      confirmed,
      drafts,
      leadPipeline: 0, // filled below
      recurring,
      totalForecast: 0, // calculated below
      invoiced,
      paid,
      confirmedItems,
      draftItems,
      recurringItems,
      invoicedItems,
      paidItems,
    })
  }

  // Lead pipeline (not month-specific — open leads are a general pipeline)
  const openLeads = await prisma.lead.findMany({
    where: {
      status: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROSPECT'] },
      estimatedValue: { not: null },
    },
    select: { id: true, name: true, companyName: true, status: true, estimatedValue: true },
  })

  const leadsByStage: ForecastReport['leadsByStage'] = []
  const stageMap = new Map<string, { count: number; rawValue: number; weightedValue: number }>()
  const leadItems: ForecastLeadItem[] = []

  openLeads.forEach((lead) => {
    const weight = LEAD_WEIGHTS[lead.status] ?? 0.1
    const raw = Number(lead.estimatedValue || 0)
    const existing = stageMap.get(lead.status) || { count: 0, rawValue: 0, weightedValue: 0 }
    existing.count++
    existing.rawValue += raw
    existing.weightedValue += raw * weight
    stageMap.set(lead.status, existing)

    leadItems.push({
      id: lead.id,
      name: lead.name,
      companyName: lead.companyName,
      stage: lead.status,
      estimatedValue: raw,
      weight,
      weightedValue: raw * weight,
    })
  })

  // Sort leads by weighted value descending
  leadItems.sort((a, b) => b.weightedValue - a.weightedValue)

  let totalLeadPipeline = 0
  for (const [stage, data] of stageMap.entries()) {
    leadsByStage.push({ stage, ...data })
    totalLeadPipeline += data.weightedValue
  }
  leadsByStage.sort((a, b) => b.weightedValue - a.weightedValue)

  // Spread lead pipeline evenly across the 3 months
  const leadPerMonth = totalLeadPipeline / 3

  let totalPipeline = 0
  months.forEach((m) => {
    m.leadPipeline = leadPerMonth
    m.totalForecast = m.confirmed + m.drafts + m.leadPipeline + m.recurring
    totalPipeline += m.totalForecast
  })

  return { months, leadsByStage, leadItems, totalPipeline, totalLeadPipeline }
}

export async function getKpiTargets(monthKeys: string[]): Promise<Record<string, KpiTargets>> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const keys = monthKeys.map((m) => `kpi_${m}`)
  const settings = await prisma.setting.findMany({
    where: { key: { in: keys } },
  })

  const result: Record<string, KpiTargets> = {}
  for (const s of settings) {
    const month = s.key.replace('kpi_', '')
    const val = s.value as Record<string, number>
    result[month] = {
      revenueTarget: val.revenueTarget ?? 0,
      expenses: val.expenses ?? 0,
      payroll: val.payroll ?? 0,
    }
  }
  return result
}

export async function saveKpiTargets(month: string, data: KpiTargets) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const key = `kpi_${month}`
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: data as Record<string, number> },
    update: { value: data as Record<string, number> },
  })

  return { success: true }
}

// Stock Count report — simple list of assets with available-on-shelf quantity
export async function getStockCountReport() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const assets = await prisma.asset.findMany({
    include: {
      category: true,
      units: {
        where: { status: { not: 'RETIRED' } },
        select: { status: true },
      },
    },
    orderBy: [
      { category: { name: 'asc' } },
      { name: 'asc' },
    ],
  })

  const items = assets
    .map((asset) => {
      const available = asset.units.filter((u) => u.status === 'AVAILABLE').length
      const checkedOut = asset.units.filter((u) => u.status === 'CHECKED_OUT').length
      const reserved = asset.units.filter((u) => u.status === 'RESERVED').length
      const maintenance = asset.units.filter((u) => u.status === 'MAINTENANCE').length
      const total = asset.units.length
      return {
        assetId: asset.id,
        assetName: asset.name,
        category: asset.category?.name || 'Uncategorized',
        available,
        checkedOut,
        reserved,
        maintenance,
        total,
      }
    })
    .filter((item) => item.total > 0)

  const summary = {
    totalAssets: items.length,
    totalUnits: items.reduce((s, i) => s + i.total, 0),
    totalAvailable: items.reduce((s, i) => s + i.available, 0),
    totalCheckedOut: items.reduce((s, i) => s + i.checkedOut, 0),
    totalReserved: items.reduce((s, i) => s + i.reserved, 0),
    totalMaintenance: items.reduce((s, i) => s + i.maintenance, 0),
  }

  return { items, summary }
}

export type StockCountReportData = Awaited<ReturnType<typeof getStockCountReport>>
export type StockCountReportItem = StockCountReportData['items'][number]

// ---------------------------------------------------------------------------
// UNPRICED CHECKED-OUT ITEMS (data-quality report)
// ---------------------------------------------------------------------------
// Items that were checked out but carry NO rate on the checkout OR its
// reservation line item — so they earn $0 and can't attribute revenue to the
// unit/loan. Split into orders that are genuinely $0 vs orders that DO have a
// value but whose line items were never priced (those need fixing).
export async function getUnpricedItemsReport() {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const [checkouts, rius] = await Promise.all([
    prisma.checkout.findMany({
      include: {
        assetUnit: { select: { barcode: true, serialNumber: true, ownershipType: true, assetId: true, asset: { select: { name: true } } } },
        client: { select: { name: true } },
        reservation: { select: { id: true, reservationNumber: true, reservationType: true, total: true, isRecurring: true } },
      },
      orderBy: { checkoutDate: 'desc' },
    }),
    prisma.reservationItemUnit.findMany({
      where: { checkoutId: { not: null } },
      select: { checkoutId: true, reservationItem: { select: { rate: true } } },
    }),
  ])

  // checkoutId -> reservation line-item rate (fallback when checkout.rate is empty)
  const itemRateByCheckout = new Map<string, number | null>()
  for (const riu of rius) {
    if (!riu.checkoutId) continue
    itemRateByCheckout.set(riu.checkoutId, riu.reservationItem?.rate != null ? Number(riu.reservationItem.rate) : null)
  }

  const items = checkouts
    .filter((c) => {
      const coRate = c.rate != null ? Number(c.rate) : 0
      const itemRate = itemRateByCheckout.get(c.id) ?? 0
      // "Unpriced" = no positive rate anywhere
      return coRate <= 0 && itemRate <= 0
    })
    .map((c) => ({
      checkoutId: c.id,
      reservationId: c.reservation?.id ?? null,
      reservationNumber: c.reservation?.reservationNumber ?? '—',
      reservationType: c.reservation?.reservationType ?? 'RENTAL',
      orderTotal: c.reservation?.total != null ? Number(c.reservation.total) : 0,
      isRecurring: c.reservation?.isRecurring ?? false,
      clientName: c.client?.name ?? '—',
      assetName: c.assetUnit?.asset?.name ?? '—',
      assetId: c.assetUnit?.assetId ?? null,
      barcode: c.assetUnit?.barcode ?? '—',
      serialNumber: c.assetUnit?.serialNumber ?? null,
      ownershipType: c.assetUnit?.ownershipType ?? 'CASH',
      status: c.status,
      checkoutDate: c.checkoutDate.toISOString(),
    }))

  // Group by reservation so it's actionable per order
  const groupsMap = new Map<string, {
    reservationId: string | null
    reservationNumber: string
    reservationType: string
    clientName: string
    orderTotal: number
    isRecurring: boolean
    items: typeof items
  }>()
  for (const it of items) {
    const key = it.reservationId ?? `standalone:${it.checkoutId}`
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        reservationId: it.reservationId,
        reservationNumber: it.reservationNumber,
        reservationType: it.reservationType,
        clientName: it.clientName,
        orderTotal: it.orderTotal,
        isRecurring: it.isRecurring,
        items: [],
      })
    }
    groupsMap.get(key)!.items.push(it)
  }
  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    // Orders with value first (they need fixing), then by item count
    if ((b.orderTotal > 0 ? 1 : 0) !== (a.orderTotal > 0 ? 1 : 0)) return (b.orderTotal > 0 ? 1 : 0) - (a.orderTotal > 0 ? 1 : 0)
    return b.items.length - a.items.length
  })

  const needsPricing = groups.filter((g) => g.orderTotal > 0)
  const zeroValue = groups.filter((g) => g.orderTotal <= 0)

  return {
    items,
    groups,
    summary: {
      totalItems: items.length,
      totalOrders: groups.length,
      ordersWithValue: needsPricing.length,
      itemsInValuedOrders: needsPricing.reduce((s, g) => s + g.items.length, 0),
      zeroValueOrders: zeroValue.length,
    },
  }
}

export type UnpricedItemsReport = Awaited<ReturnType<typeof getUnpricedItemsReport>>
