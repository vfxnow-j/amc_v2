'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { createExcelBuffer } from '@/lib/excel'
import type { ExportType } from '@/lib/export-types'
import { calculateDepreciatedValue, type DepreciationMethod } from '@/lib/utils/depreciation'
import { getDerivedOwnershipStatus, type OwnershipType, type AssetStatus, ownershipTypeLabels, depreciationMethodLabels } from '@/lib/types'

// ============================================
// TYPES
// ============================================

export type DateRange = {
  startDate?: Date
  endDate?: Date
}

export type ExportOptions = {
  type: ExportType
  dateRange?: DateRange
  filters?: Record<string, string>
}

export type ExportResult = {
  success: boolean
  filename: string
  data: string // Base64 encoded Excel file
  rowCount: number
  error?: string
}

// ============================================
// MAIN EXPORT FUNCTION
// ============================================

export async function generateExport(options: ExportOptions): Promise<ExportResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, filename: '', data: '', rowCount: 0, error: 'Unauthorized' }
  }

  try {
    let data: Record<string, unknown>[] = []
    let filename = ''
    const timestamp = new Date().toISOString().split('T')[0]

    switch (options.type) {
      case 'assets':
        data = await exportAssets()
        filename = `assets-${timestamp}.xlsx`
        break

      case 'assets-with-rates':
        data = await exportAssetsWithRates()
        filename = `assets-with-rates-${timestamp}.xlsx`
        break

      case 'checkouts':
        data = await exportCheckouts(options.dateRange)
        filename = `checkouts-${timestamp}.xlsx`
        break

      case 'checkouts-active':
        data = await exportActiveCheckouts()
        filename = `active-checkouts-${timestamp}.xlsx`
        break

      case 'reservations':
        data = await exportReservations(options.dateRange)
        filename = `reservations-${timestamp}.xlsx`
        break

      case 'reservations-active':
        data = await exportActiveReservations()
        filename = `active-reservations-${timestamp}.xlsx`
        break

      case 'clients':
        data = await exportClients()
        filename = `clients-${timestamp}.xlsx`
        break

      case 'clients-with-balance':
        data = await exportClientsWithBalance()
        filename = `clients-balances-${timestamp}.xlsx`
        break

      case 'invoices':
        data = await exportInvoices(options.dateRange)
        filename = `invoices-${timestamp}.xlsx`
        break

      case 'invoices-outstanding':
        data = await exportOutstandingInvoices()
        filename = `outstanding-invoices-${timestamp}.xlsx`
        break

      case 'maintenance':
        data = await exportMaintenance(options.dateRange)
        filename = `maintenance-${timestamp}.xlsx`
        break

      case 'revenue-by-client':
        data = await exportRevenueByClient(options.dateRange)
        filename = `revenue-by-client-${timestamp}.xlsx`
        break

      case 'revenue-by-month':
        data = await exportRevenueByMonth(options.dateRange)
        filename = `revenue-by-month-${timestamp}.xlsx`
        break

      case 'asset-utilization':
        data = await exportAssetUtilization(options.dateRange)
        filename = `asset-utilization-${timestamp}.xlsx`
        break

      case 'inventory-value':
        data = await exportInventoryValue()
        filename = `inventory-value-${timestamp}.xlsx`
        break

      case 'traffic-report':
        data = await exportTrafficReport(options.dateRange)
        filename = `traffic-report-${timestamp}.xlsx`
        break

      case 'full-inventory':
        data = await exportFullInventory()
        filename = `full-inventory-report-${timestamp}.xlsx`
        break

      case 'simple-inventory':
        data = await exportSimpleInventory()
        filename = `simple-inventory-report-${timestamp}.xlsx`
        break

      default:
        return { success: false, filename: '', data: '', rowCount: 0, error: 'Unknown export type' }
    }

    // Convert to Excel
    const buffer = await createExcelBuffer(data)

    return {
      success: true,
      filename,
      data: buffer,
      rowCount: data.length,
    }
  } catch (error) {
    return {
      success: false,
      filename: '',
      data: '',
      rowCount: 0,
      error: error instanceof Error ? error.message : 'Export failed',
    }
  }
}

// ============================================
// EXPORT DATA FUNCTIONS
// ============================================

/**
 * Export product types (Assets) with unit status counts.
 * Asset = product type; AssetUnit = physical instance.
 */
async function exportAssets() {
  const assets = await prisma.asset.findMany({
    include: {
      category: true,
      vendor: true,
      units: {
        select: { status: true },
      },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  return assets.map((asset) => {
    const statusCounts = {
      available: 0,
      checkedOut: 0,
      maintenance: 0,
      retired: 0,
      reserved: 0,
    }
    for (const unit of asset.units) {
      switch (unit.status) {
        case 'AVAILABLE': statusCounts.available++; break
        case 'CHECKED_OUT': statusCounts.checkedOut++; break
        case 'MAINTENANCE': statusCounts.maintenance++; break
        case 'RETIRED': statusCounts.retired++; break
        case 'RESERVED': statusCounts.reserved++; break
      }
    }

    return {
      'Asset Number': asset.assetNumber || '',
      'Name': asset.name,
      'Description': asset.description || '',
      'Category': asset.category.name,
      'Sub-Category': asset.subCategory || '',
      'Vendor': asset.vendor?.name || '',
      'Manufacturer': asset.manufacturer || '',
      'Model': asset.model || '',
      'Total Quantity': asset.totalQuantity,
      'Available': statusCounts.available,
      'Checked Out': statusCounts.checkedOut,
      'Maintenance': statusCounts.maintenance,
      'Reserved': statusCounts.reserved,
      'Retired': statusCounts.retired,
      'Created At': formatDate(asset.createdAt),
    }
  })
}

/**
 * Export product types with rental rates and aggregated financials from units.
 */
async function exportAssetsWithRates() {
  const assets = await prisma.asset.findMany({
    include: {
      category: true,
      units: {
        select: {
          status: true,
          totalRevenue: true,
          maintenanceCost: true,
        },
      },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  return assets.map((asset) => {
    const activeUnits = asset.units.filter((u) => u.status !== 'RETIRED')
    const totalRevenue = activeUnits.reduce((sum, u) => sum + Number(u.totalRevenue), 0)
    const totalMaintenanceCost = activeUnits.reduce((sum, u) => sum + Number(u.maintenanceCost), 0)

    return {
      'Name': asset.name,
      'Category': asset.category.name,
      'Active Units': activeUnits.length,
      'Daily Rate': asset.dailyRate ? Number(asset.dailyRate) : '',
      'Weekly Rate': asset.weeklyRate ? Number(asset.weeklyRate) : '',
      'Monthly Rate': asset.monthlyRate ? Number(asset.monthlyRate) : '',
      'Sale Price': asset.salePrice ? Number(asset.salePrice) : '',
      'Total Revenue (all units)': totalRevenue,
      'Maintenance Cost (all units)': totalMaintenanceCost,
      'Net Profit (all units)': totalRevenue - totalMaintenanceCost,
    }
  })
}

/**
 * Export all checkout records.
 * Checkout now links to AssetUnit, which links to Asset (product type).
 */
async function exportCheckouts(dateRange?: DateRange) {
  const where: Record<string, unknown> = {}
  if (dateRange?.startDate) {
    where.checkoutDate = { gte: dateRange.startDate }
  }
  if (dateRange?.endDate) {
    where.checkoutDate = { ...((where.checkoutDate as object) || {}), lte: dateRange.endDate }
  }

  const checkouts = await prisma.checkout.findMany({
    where,
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
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

  return checkouts.map((checkout) => ({
    'Checkout Date': formatDate(checkout.checkoutDate),
    'Barcode': checkout.assetUnit.barcode,
    'Serial Number': checkout.assetUnit.serialNumber || '',
    'Asset Name': checkout.assetUnit.asset.name,
    'Category': checkout.assetUnit.asset.category.name,
    'Client': checkout.client.name,
    'Company': checkout.client.companyName || '',
    'Status': checkout.status,
    'Expected Return': checkout.expectedReturn ? formatDate(checkout.expectedReturn) : '',
    'Actual Return': checkout.actualReturn ? formatDate(checkout.actualReturn) : '',
    'Pricing Type': checkout.pricingType,
    'Rate': checkout.rate ? Number(checkout.rate) : '',
    'Total Charge': checkout.totalCharge ? Number(checkout.totalCharge) : '',
    'Condition Out': checkout.conditionOut || '',
    'Condition In': checkout.conditionIn || '',
    'Created By': checkout.createdBy.name,
    'Notes': checkout.notes || '',
  }))
}

/**
 * Export currently active checkouts.
 * Checkout -> AssetUnit -> Asset (product type).
 */
async function exportActiveCheckouts() {
  const checkouts = await prisma.checkout.findMany({
    where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
        },
      },
      client: true,
      reservation: true,
    },
    orderBy: { checkoutDate: 'desc' },
  })

  return checkouts.map((checkout) => ({
    'Status': checkout.status,
    'Days Out': Math.ceil((Date.now() - checkout.checkoutDate.getTime()) / (1000 * 60 * 60 * 24)),
    'Checkout Date': formatDate(checkout.checkoutDate),
    'Expected Return': checkout.expectedReturn ? formatDate(checkout.expectedReturn) : '',
    'Barcode': checkout.assetUnit.barcode,
    'Serial Number': checkout.assetUnit.serialNumber || '',
    'Asset Name': checkout.assetUnit.asset.name,
    'Category': checkout.assetUnit.asset.category.name,
    'Client': checkout.client.name,
    'Company': checkout.client.companyName || '',
    'Client Phone': checkout.client.phone || '',
    'Client Email': checkout.client.email || '',
    'Reservation': checkout.reservation?.reservationNumber || '',
    'Rate': checkout.rate ? Number(checkout.rate) : '',
    'Notes': checkout.notes || '',
  }))
}

/**
 * Export reservations with quantity-based item tracking.
 * ReservationItem now has quantity and checkedOutCount/checkedInCount instead of booleans.
 */
async function exportReservations(dateRange?: DateRange) {
  const where: Record<string, unknown> = {}
  if (dateRange?.startDate || dateRange?.endDate) {
    where.OR = []
    if (dateRange?.startDate) {
      (where.OR as unknown[]).push({ endDate: { gte: dateRange.startDate } })
    }
    if (dateRange?.endDate) {
      (where.OR as unknown[]).push({ startDate: { lte: dateRange.endDate } })
    }
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: {
      client: true,
      items: { include: { asset: true } },
    },
    orderBy: { startDate: 'desc' },
  })

  return reservations.map((res) => {
    const totalQuantity = res.items.reduce((sum, i) => sum + i.quantity, 0)
    const totalCheckedOut = res.items.reduce((sum, i) => sum + i.checkedOutCount, 0)
    const totalCheckedIn = res.items.reduce((sum, i) => sum + i.checkedInCount, 0)

    return {
      'Reservation #': res.reservationNumber,
      'Client': res.client.name,
      'Company': res.client.companyName || '',
      'Type': res.reservationType,
      'Status': res.status,
      'Start Date': formatDate(res.startDate),
      'End Date': formatDate(res.endDate),
      'Project Name': res.projectName || '',
      'Project Code': res.projectCode || '',
      'Line Items': res.items.length,
      'Total Quantity': totalQuantity,
      'Total Checked Out': totalCheckedOut,
      'Total Checked In': totalCheckedIn,
      'Subtotal': Number(res.subtotal),
      'Tax': Number(res.taxAmount),
      'Total': Number(res.total),
      'Billing Cycle': res.billingCycleType,
      'Notes': res.notes || '',
    }
  })
}

/**
 * Export active reservations with per-item detail rows.
 * Items reference product types (Asset) with quantities.
 * checkedOutCount/checkedInCount replace boolean checkedOut/checkedIn.
 */
async function exportActiveReservations() {
  const reservations = await prisma.reservation.findMany({
    where: { status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] } },
    include: {
      client: true,
      items: {
        include: {
          asset: { include: { category: true } },
          units: {
            include: { assetUnit: true },
          },
        },
      },
    },
    orderBy: { startDate: 'asc' },
  })

  const rows: Record<string, unknown>[] = []

  for (const res of reservations) {
    for (const item of res.items) {
      rows.push({
        'Reservation #': res.reservationNumber,
        'Status': res.status,
        'Client': res.client.name,
        'Company': res.client.companyName || '',
        'Start Date': formatDate(res.startDate),
        'End Date': formatDate(res.endDate),
        'Asset Name': item.asset?.name || item.description || 'Ad-hoc item',
        'Category': item.asset?.category?.name || '',
        'Quantity': item.quantity,
        'Checked Out': `${item.checkedOutCount} / ${item.quantity}`,
        'Checked In': `${item.checkedInCount} / ${item.quantity}`,
        'Assigned Barcodes': item.units.map((u) => u.assetUnit?.barcode || '-').join(', '),
        'Rate': Number(item.rate),
        'Pricing Type': item.pricingType,
        'Subtotal': Number(item.subtotal),
      })
    }
  }

  return rows
}

/**
 * Export client directory - no changes needed for two-tier model.
 */
async function exportClients() {
  const clients = await prisma.client.findMany({
    include: {
      _count: {
        select: { checkouts: true, reservations: true, invoices: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return clients.map((client) => ({
    'Name': client.name,
    'Company': client.companyName || '',
    'Email': client.email || '',
    'Phone': client.phone || '',
    'Address': client.address || '',
    'Billing Address': client.billingAddress || '',
    'Payment Terms': `${client.paymentTerms} days`,
    'Tax Exempt': client.taxExempt ? 'Yes' : 'No',
    'Total Checkouts': client._count.checkouts,
    'Total Reservations': client._count.reservations,
    'Total Invoices': client._count.invoices,
    'Created At': formatDate(client.createdAt),
    'Notes': client.notes || '',
  }))
}

/**
 * Export clients with outstanding balances - no changes needed for two-tier model.
 */
async function exportClientsWithBalance() {
  const clients = await prisma.client.findMany({
    include: {
      invoices: {
        where: { status: { notIn: ['CANCELLED', 'VOID'] } },
      },
      checkouts: {
        where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
      },
    },
    orderBy: { name: 'asc' },
  })

  return clients.map((client) => {
    const totalInvoiced = client.invoices.reduce((sum, inv) => sum + Number(inv.total), 0)
    const totalPaid = client.invoices.reduce((sum, inv) => sum + Number(inv.amountPaid), 0)
    const balance = totalInvoiced - totalPaid

    return {
      'Name': client.name,
      'Company': client.companyName || '',
      'Email': client.email || '',
      'Phone': client.phone || '',
      'Active Checkouts': client.checkouts.length,
      'Total Invoiced': totalInvoiced,
      'Total Paid': totalPaid,
      'Outstanding Balance': balance,
      'Payment Terms': `${client.paymentTerms} days`,
    }
  }).filter((c) => c['Outstanding Balance'] > 0 || c['Active Checkouts'] > 0)
}

/**
 * Export invoices - no changes needed for two-tier model.
 */
async function exportInvoices(dateRange?: DateRange) {
  const where: Record<string, unknown> = {}
  if (dateRange?.startDate) {
    where.issueDate = { gte: dateRange.startDate }
  }
  if (dateRange?.endDate) {
    where.issueDate = { ...((where.issueDate as object) || {}), lte: dateRange.endDate }
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      client: true,
      reservation: true,
      items: true,
      payments: true,
    },
    orderBy: { issueDate: 'desc' },
  })

  return invoices.map((inv) => ({
    'Invoice #': inv.invoiceNumber,
    'Client': inv.client.name,
    'Company': inv.client.companyName || '',
    'Status': inv.status,
    'Issue Date': formatDate(inv.issueDate),
    'Due Date': formatDate(inv.dueDate),
    'Reservation': inv.reservation?.reservationNumber || '',
    'Item Count': inv.items.length,
    'Subtotal': Number(inv.subtotal),
    'Tax Rate': `${Number(inv.taxRate)}%`,
    'Tax Amount': Number(inv.taxAmount),
    'Total': Number(inv.total),
    'Amount Paid': Number(inv.amountPaid),
    'Balance Due': Number(inv.total) - Number(inv.amountPaid),
    'Payment Count': inv.payments.length,
    'Notes': inv.notes || '',
  }))
}

/**
 * Export outstanding invoices - no changes needed for two-tier model.
 */
async function exportOutstandingInvoices() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
    include: {
      client: true,
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  })

  return invoices.map((inv) => {
    const daysOverdue = inv.dueDate < new Date()
      ? Math.ceil((Date.now() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0

    return {
      'Invoice #': inv.invoiceNumber,
      'Status': inv.status,
      'Days Overdue': daysOverdue > 0 ? daysOverdue : '',
      'Client': inv.client.name,
      'Company': inv.client.companyName || '',
      'Client Email': inv.client.email || '',
      'Client Phone': inv.client.phone || '',
      'Issue Date': formatDate(inv.issueDate),
      'Due Date': formatDate(inv.dueDate),
      'Total': Number(inv.total),
      'Amount Paid': Number(inv.amountPaid),
      'Balance Due': Number(inv.total) - Number(inv.amountPaid),
    }
  })
}

/**
 * Export maintenance records.
 * MaintenanceRecord now links to AssetUnit, which links to Asset (product type).
 */
async function exportMaintenance(dateRange?: DateRange) {
  const where: Record<string, unknown> = {}
  if (dateRange?.startDate) {
    where.createdAt = { gte: dateRange.startDate }
  }
  if (dateRange?.endDate) {
    where.createdAt = { ...((where.createdAt as object) || {}), lte: dateRange.endDate }
  }

  const records = await prisma.maintenanceRecord.findMany({
    where,
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return records.map((record) => ({
    'Barcode': record.assetUnit.barcode,
    'Serial Number': record.assetUnit.serialNumber || '',
    'Asset Name': record.assetUnit.asset.name,
    'Category': record.assetUnit.asset.category.name,
    'Type': record.type,
    'Status': record.status,
    'Description': record.description,
    'Scheduled Date': record.scheduledDate ? formatDate(record.scheduledDate) : '',
    'Start Date': record.startDate ? formatDate(record.startDate) : '',
    'Completion Date': record.completionDate ? formatDate(record.completionDate) : '',
    'Performed By': record.performedBy || '',
    'Labor Cost': record.laborCost ? Number(record.laborCost) : '',
    'Parts Cost': record.partsCost ? Number(record.partsCost) : '',
    'Total Cost': record.totalCost ? Number(record.totalCost) : '',
    'Parts Used': record.partsUsed || '',
    'Work Performed': record.workPerformed || '',
    'Notes': record.notes || '',
  }))
}

/**
 * Export revenue by client - works on invoices, no changes needed.
 */
async function exportRevenueByClient(dateRange?: DateRange) {
  const startDate = dateRange?.startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1))
  const endDate = dateRange?.endDate || new Date()

  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      createdAt: { gte: startDate, lte: endDate },
    },
    include: { client: true },
  })

  // Group by client
  const clientRevenue = new Map<string, { name: string; company: string; count: number; total: number }>()

  invoices.forEach((inv) => {
    const key = inv.clientId
    const current = clientRevenue.get(key) || {
      name: inv.client.name,
      company: inv.client.companyName || '',
      count: 0,
      total: 0,
    }
    current.count++
    current.total += Number(inv.total)
    clientRevenue.set(key, current)
  })

  return Array.from(clientRevenue.values())
    .sort((a, b) => b.total - a.total)
    .map((client, index) => ({
      'Rank': index + 1,
      'Client': client.name,
      'Company': client.company,
      'Invoice Count': client.count,
      'Total Revenue': client.total,
      'Average Invoice': Math.round(client.total / client.count * 100) / 100,
    }))
}

/**
 * Export revenue by month - works on invoices, no changes needed.
 */
async function exportRevenueByMonth(dateRange?: DateRange) {
  const startDate = dateRange?.startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1))
  const endDate = dateRange?.endDate || new Date()

  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      createdAt: { gte: startDate, lte: endDate },
    },
  })

  // Group by month
  const monthlyRevenue = new Map<string, { count: number; total: number }>()

  invoices.forEach((inv) => {
    const month = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`
    const current = monthlyRevenue.get(month) || { count: 0, total: 0 }
    current.count++
    current.total += Number(inv.total)
    monthlyRevenue.set(month, current)
  })

  return Array.from(monthlyRevenue.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      'Month': month,
      'Invoice Count': data.count,
      'Total Revenue': data.total,
      'Average Invoice': Math.round(data.total / data.count * 100) / 100,
    }))
}

/**
 * Export asset utilization report.
 * Utilization is aggregated at the product type level. Checkouts live on AssetUnit,
 * so we query Assets with their units and each unit's checkouts, then aggregate.
 */
async function exportAssetUtilization(dateRange?: DateRange) {
  const startDate = dateRange?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 3))
  const endDate = dateRange?.endDate || new Date()
  const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

  const assets = await prisma.asset.findMany({
    include: {
      category: true,
      units: {
        include: {
          checkouts: {
            where: {
              checkoutDate: { gte: startDate, lte: endDate },
            },
          },
        },
      },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  })

  return assets.map((asset) => {
    let totalCheckoutCount = 0
    let totalDaysOut = 0
    let totalRevenue = 0

    const activeUnits = asset.units.filter((u) => u.status !== 'RETIRED')

    for (const unit of activeUnits) {
      totalCheckoutCount += unit.checkouts.length
      for (const checkout of unit.checkouts) {
        const checkoutDate = checkout.checkoutDate
        const returnDate = checkout.actualReturn || new Date()
        totalDaysOut += Math.ceil((returnDate.getTime() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24))
      }
      totalRevenue += Number(unit.totalRevenue)
    }

    // Utilization: total unit-days out / (number of active units * period days)
    const unitCount = activeUnits.length || 1
    const maxUnitDays = unitCount * periodDays
    const utilizationRate = maxUnitDays > 0
      ? Math.min(100, Math.round((totalDaysOut / maxUnitDays) * 100))
      : 0

    return {
      'Name': asset.name,
      'Category': asset.category.name,
      'Total Units': asset.totalQuantity,
      'Checkout Count': totalCheckoutCount,
      'Total Unit-Days Out': totalDaysOut,
      'Utilization Rate %': utilizationRate,
      'Total Revenue (all units)': totalRevenue,
    }
  })
}

/**
 * Export inventory value report.
 * Operates at the AssetUnit level for per-unit purchase info and depreciation,
 * with product type name and category included for context.
 */
async function exportInventoryValue() {
  const units = await prisma.assetUnit.findMany({
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

  // Calculate depreciated value (simple straight-line) per unit
  const rows = units.map((unit) => {
    const purchasePrice = Number(unit.purchasePrice || 0)
    const salvageValue = Number(unit.asset.salvageValue || 0)
    const usefulLifeMonths = unit.asset.usefulLifeMonths || 36

    let currentValue = purchasePrice
    if (unit.purchaseDate && purchasePrice > 0) {
      const monthsOwned = Math.floor(
        (Date.now() - unit.purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
      const monthlyDepreciation = (purchasePrice - salvageValue) / usefulLifeMonths
      const totalDepreciation = Math.min(monthsOwned * monthlyDepreciation, purchasePrice - salvageValue)
      currentValue = purchasePrice - totalDepreciation
    }

    return {
      'Barcode': unit.barcode,
      'Serial Number': unit.serialNumber || '',
      'Asset Name': unit.asset.name,
      'Category': unit.asset.category.name,
      'Location': unit.location?.name || '',
      'Status': unit.status,
      'Purchase Date': unit.purchaseDate ? formatDate(unit.purchaseDate) : '',
      'Purchase Price': purchasePrice || '',
      'Warranty Expiry': unit.warrantyExpiry ? formatDate(unit.warrantyExpiry) : '',
      'Salvage Value': salvageValue || '',
      'Useful Life (months)': usefulLifeMonths,
      'Current Book Value': Math.round(currentValue * 100) / 100,
      'Total Revenue': Number(unit.totalRevenue),
      'Maintenance Cost': Number(unit.maintenanceCost),
      'Net Profit': Number(unit.totalRevenue) - Number(unit.maintenanceCost),
    }
  })

  // Add summary row (exclude retired units from totals)
  const activeRows = rows.filter((r) => r['Status'] !== 'RETIRED')
  const totalPurchase = activeRows.reduce((sum, r) => sum + (Number(r['Purchase Price']) || 0), 0)
  const totalCurrentValue = activeRows.reduce((sum, r) => sum + (Number(r['Current Book Value']) || 0), 0)
  const totalRevenue = activeRows.reduce((sum, r) => sum + (Number(r['Total Revenue']) || 0), 0)
  const totalMaintenance = activeRows.reduce((sum, r) => sum + (Number(r['Maintenance Cost']) || 0), 0)

  rows.push({
    'Barcode': '--- TOTALS ---',
    'Serial Number': '',
    'Asset Name': '',
    'Category': '',
    'Location': '',
    'Status': '' as unknown as typeof rows[0]['Status'],
    'Purchase Date': '',
    'Purchase Price': totalPurchase,
    'Warranty Expiry': '',
    'Salvage Value': '',
    'Useful Life (months)': '' as unknown as number,
    'Current Book Value': totalCurrentValue,
    'Total Revenue': totalRevenue,
    'Maintenance Cost': totalMaintenance,
    'Net Profit': totalRevenue - totalMaintenance,
  })

  return rows
}

/**
 * Export traffic report with full lifecycle detail:
 * purchase info, checkout/checkin history, depreciation, loan status,
 * and summary rows for asset value rented/sold/in-house/retired.
 */
async function exportTrafficReport(dateRange?: DateRange) {
  const startDate = dateRange?.startDate || new Date(new Date().setMonth(new Date().getMonth() - 3))
  const endDate = dateRange?.endDate || new Date()

  const checkouts = await prisma.checkout.findMany({
    where: {
      checkoutDate: { gte: startDate, lte: endDate },
    },
    include: {
      assetUnit: {
        include: {
          asset: { include: { category: true } },
          location: true,
        },
      },
      client: true,
      createdBy: { select: { name: true } },
    },
    orderBy: { checkoutDate: 'desc' },
  })

  const rows: Record<string, unknown>[] = checkouts.map((c) => {
    const unit = c.assetUnit
    const asset = unit.asset
    const purchasePrice = unit.purchasePrice ? Number(unit.purchasePrice) : 0
    const salvageValue = asset.salvageValue ? Number(asset.salvageValue) : 0
    const usefulLifeMonths = asset.usefulLifeMonths || 36
    const ageMonths = unit.purchaseDate
      ? Math.max(0, Math.round((Date.now() - new Date(unit.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
      : 0
    const depreciatedValue = purchasePrice > 0
      ? Math.max(salvageValue, purchasePrice - ((purchasePrice - salvageValue) * Math.min(ageMonths, usefulLifeMonths) / usefulLifeMonths))
      : 0

    const checkoutDate = new Date(c.checkoutDate)
    const returnDate = c.actualReturn ? new Date(c.actualReturn) : null
    const durationDays = returnDate
      ? Math.ceil((returnDate.getTime() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24))
      : null

    return {
      'Asset Name': asset.name,
      'Category': asset.category?.name || '',
      'Barcode': unit.barcode,
      'Serial Number': unit.serialNumber || '',
      'Client': c.client.name,
      'Company': c.client.companyName || '',
      'Checkout Date': formatDate(c.checkoutDate),
      'Expected Return': c.expectedReturn ? formatDate(c.expectedReturn) : '',
      'Actual Return': c.actualReturn ? formatDate(c.actualReturn) : '',
      'Duration (days)': durationDays ?? '',
      'Status': c.status,
      'Pricing Type': c.pricingType,
      'Rate': c.rate ? Number(c.rate) : '',
      'Total Charge': c.totalCharge ? Number(c.totalCharge) : 0,
      'Condition Out': c.conditionOut || '',
      'Condition In': c.conditionIn || '',
      'Damage': c.damageFlag ? 'Yes' : 'No',
      'Damage Notes': c.damageNotes || '',
      'Ownership Type': unit.ownershipType,
      'Purchase Date': unit.purchaseDate ? formatDate(unit.purchaseDate) : '',
      'Purchase Price': purchasePrice || '',
      'Depreciation Method': asset.depreciationMethod,
      'Useful Life (months)': usefulLifeMonths,
      'Salvage Value': salvageValue || '',
      'Current Book Value': Math.round(depreciatedValue * 100) / 100,
      'Unit Revenue (lifetime)': Number(unit.totalRevenue),
      'Maintenance Cost (lifetime)': Number(unit.maintenanceCost),
      'Loan Name': unit.loanName || '',
      'Loan Amount': unit.loanAmount ? Number(unit.loanAmount) : '',
      'Loan End Date': unit.amortizationEndDate ? formatDate(unit.amortizationEndDate) : '',
      'Created By': c.createdBy.name,
    }
  })

  // Build summary rows
  const allUnits = await prisma.assetUnit.findMany({
    select: {
      status: true,
      purchasePrice: true,
      totalRevenue: true,
      maintenanceCost: true,
      loanAmount: true,
      ownershipType: true,
      asset: { select: { salvageValue: true, usefulLifeMonths: true } },
      purchaseDate: true,
    },
  })

  let valueRented = 0
  let valueInHouse = 0
  let valueRetired = 0
  let totalLoanBalance = 0

  for (const u of allUnits) {
    const pp = Number(u.purchasePrice || 0)
    const sv = Number(u.asset.salvageValue || 0)
    const ulm = u.asset.usefulLifeMonths || 36
    const age = u.purchaseDate
      ? Math.max(0, Math.round((Date.now() - new Date(u.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
      : 0
    const bv = pp > 0 ? Math.max(sv, pp - ((pp - sv) * Math.min(age, ulm) / ulm)) : 0

    if (u.status === 'CHECKED_OUT') valueRented += bv
    else if (u.status === 'RETIRED') valueRetired += bv
    else valueInHouse += bv

    if (u.ownershipType === 'LOAN' && u.loanAmount) {
      totalLoanBalance += Number(u.loanAmount)
    }
  }

  const totalRevenue = rows.reduce((s, r) => s + (Number(r['Total Charge']) || 0), 0)
  const emptyRow: Record<string, unknown> = Object.fromEntries(Object.keys(rows[0] || {}).map(k => [k, '']))

  rows.push({ ...emptyRow })
  rows.push({ ...emptyRow, 'Asset Name': '=== PORTFOLIO SUMMARY ===' })
  rows.push({ ...emptyRow, 'Asset Name': 'Asset Value (Rented Out)', 'Total Charge': Math.round(valueRented * 100) / 100 })
  rows.push({ ...emptyRow, 'Asset Name': 'Asset Value (In House)', 'Total Charge': Math.round(valueInHouse * 100) / 100 })
  rows.push({ ...emptyRow, 'Asset Name': 'Asset Value (Retired)', 'Total Charge': Math.round(valueRetired * 100) / 100 })
  rows.push({ ...emptyRow, 'Asset Name': 'Total Portfolio Value', 'Total Charge': Math.round((valueRented + valueInHouse + valueRetired) * 100) / 100 })
  rows.push({ ...emptyRow, 'Asset Name': 'Total Loan Balance', 'Total Charge': Math.round(totalLoanBalance * 100) / 100 })
  rows.push({ ...emptyRow, 'Asset Name': 'Revenue (this period)', 'Total Charge': Math.round(totalRevenue * 100) / 100 })

  return rows
}

/**
 * Export full inventory report with depreciation, ownership, and valuation.
 */
async function exportFullInventory() {
  const units = await prisma.assetUnit.findMany({
    where: {
      status: { in: ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED'] },
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

  const rows = units.map((unit) => {
    const purchasePrice = Number(unit.purchasePrice || 0)
    const salvageValue = Number(unit.asset.salvageValue || 0)
    const usefulLifeMonths = unit.asset.usefulLifeMonths || 60
    const depMethod = unit.asset.depreciationMethod as DepreciationMethod

    let currentBookValue = purchasePrice
    if (unit.purchaseDate && purchasePrice > 0) {
      currentBookValue = calculateDepreciatedValue(
        purchasePrice,
        unit.purchaseDate,
        depMethod,
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
      'Asset Name': unit.asset.name,
      'Category': unit.asset.category?.name || 'Uncategorized',
      'Barcode': unit.barcode,
      'Serial Number': unit.serialNumber || '',
      'Status': unit.status,
      'Location': unit.location?.name || '',
      'Ownership Type': ownershipTypeLabels[unit.ownershipType as OwnershipType] || unit.ownershipType,
      'Ownership Status': ownershipStatus === 'OWNED' ? 'Owned' : ownershipStatus === 'NOT_OWNED' ? 'Not Owned' : '',
      'Purchase Date': unit.purchaseDate ? formatDate(unit.purchaseDate) : '',
      'Purchase Price': purchasePrice || '',
      'Salvage Value': salvageValue || '',
      'Depreciable Base': depreciableBase > 0 ? depreciableBase : '',
      'Useful Life (months)': usefulLifeMonths,
      'Depreciation Method': depreciationMethodLabels[depMethod] || depMethod,
      'Current Book Value': Math.round(currentBookValue * 100) / 100,
      'Accumulated Depreciation': Math.round(accumulatedDepreciation * 100) / 100,
      'Lifetime Revenue': totalRevenue,
      'Maintenance Cost': maintenanceCost,
      'Net Profit': Math.round((totalRevenue - maintenanceCost) * 100) / 100,
    }
  })

  // Summary row
  const totalPurchase = rows.reduce((sum, r) => sum + (Number(r['Purchase Price']) || 0), 0)
  const totalBookValue = rows.reduce((sum, r) => sum + (Number(r['Current Book Value']) || 0), 0)
  const totalDepreciation = rows.reduce((sum, r) => sum + (Number(r['Accumulated Depreciation']) || 0), 0)
  const totalSalvage = rows.reduce((sum, r) => sum + (Number(r['Salvage Value']) || 0), 0)
  const totalRevenue = rows.reduce((sum, r) => sum + (Number(r['Lifetime Revenue']) || 0), 0)
  const totalMaintenance = rows.reduce((sum, r) => sum + (Number(r['Maintenance Cost']) || 0), 0)

  rows.push({
    'Asset Name': '--- TOTALS ---',
    'Category': '',
    'Barcode': '',
    'Serial Number': '',
    'Status': '' as unknown as typeof rows[0]['Status'],
    'Location': '',
    'Ownership Type': '',
    'Ownership Status': '',
    'Purchase Date': '',
    'Purchase Price': totalPurchase,
    'Salvage Value': totalSalvage,
    'Depreciable Base': Math.round((totalPurchase - totalSalvage) * 100) / 100,
    'Useful Life (months)': '' as unknown as number,
    'Depreciation Method': '',
    'Current Book Value': Math.round(totalBookValue * 100) / 100,
    'Accumulated Depreciation': Math.round(totalDepreciation * 100) / 100,
    'Lifetime Revenue': totalRevenue,
    'Maintenance Cost': totalMaintenance,
    'Net Profit': Math.round((totalRevenue - totalMaintenance) * 100) / 100,
  })

  return rows
}

/**
 * Export simple inventory — barcode, name, category, status, book value, location, retirement info.
 */
async function exportSimpleInventory() {
  const units = await prisma.assetUnit.findMany({
    where: {
      status: { in: ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED', 'RETIRED'] },
    },
    include: {
      asset: { include: { category: true } },
      location: true,
    },
    orderBy: [
      { asset: { category: { name: 'asc' } } },
      { asset: { name: 'asc' } },
      { barcode: 'asc' },
    ],
  })

  const retirementReasonLabels: Record<string, string> = {
    SOLD: 'Sold', RECYCLED: 'Recycled', GIFTED: 'Gifted',
    DAMAGED: 'Damaged', STOLEN: 'Stolen', LOST: 'Lost',
    RELEASED: 'Released', OTHER: 'Other',
  }

  return units.map((unit) => {
    const purchasePrice = Number(unit.purchasePrice || 0)
    const salvageValue = Number(unit.asset.salvageValue || 0)
    const usefulLifeMonths = unit.asset.usefulLifeMonths || 60
    const depMethod = unit.asset.depreciationMethod as DepreciationMethod

    let currentBookValue = purchasePrice
    if (unit.purchaseDate && purchasePrice > 0) {
      currentBookValue = calculateDepreciatedValue(
        purchasePrice, unit.purchaseDate, depMethod,
        usefulLifeMonths, salvageValue, unit.receivedDate
      )
    }

    return {
      'Category': unit.asset.category?.name || 'Uncategorized',
      'Asset Name': unit.asset.name,
      'Barcode': unit.barcode,
      'Status': unit.status,
      'Book Value': Math.round(currentBookValue * 100) / 100,
      'Location': unit.location?.name || '',
      'Retirement Reason': unit.retirementReason
        ? (retirementReasonLabels[unit.retirementReason] || unit.retirementReason)
        : '',
      'Disposed To': unit.retiredTo || '',
      'Retired On': unit.retiredAt ? formatDate(unit.retiredAt) : '',
    }
  })
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
