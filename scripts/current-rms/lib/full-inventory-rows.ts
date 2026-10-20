import type { PrismaClient } from '../../../src/generated/prisma/client'
import { calculateDepreciatedValue, unitCost, type DepreciationMethod } from '../../../src/lib/utils/depreciation'
import { getDerivedOwnershipStatus, type OwnershipType, type AssetStatus, ownershipTypeLabels, depreciationMethodLabels } from '../../../src/lib/types'
import { dispositionLabels, unitDisposal } from '../../../src/lib/utils/disposal'

export type FullInventoryRow = Record<string, string | number>

export const FULL_INVENTORY_COLUMNS = [
  'Asset Name', 'Category', 'Barcode', 'Serial Number', 'Status', 'Location', 'Ownership Type',
  'Ownership Status', 'Purchase Date', 'Purchase Price', 'Landed Cost Adj.', 'Total Cost',
  'Salvage Value', 'Depreciable Base', 'Useful Life (months)', 'Depreciation Method',
  'Current Book Value', 'Book Value As Of', 'Accumulated Depreciation', 'Lifetime Revenue',
  'Maintenance Cost', 'Net Profit', 'Disposition', 'Disposed On', 'Disposed To', 'Sale Price',
  'Gain / Loss',
]

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Full Inventory report rows: live units, a totals row, then sold/retired units and their
 * totals. Shared by the Excel export (server action) and offline scripts, which pass their
 * own read-only client. `asOf` pins "today" for book values (defaults to now).
 * `unitIds` limits the report to those units (e.g. a scan list); totals then cover only them.
 */
export async function buildFullInventoryRows(
  db: PrismaClient,
  opts: { asOf?: Date; unitIds?: string[] } = {},
): Promise<FullInventoryRow[]> {
  const now = opts.asOf ?? new Date()
  if (opts.unitIds && opts.unitIds.length === 0) return []
  const units = await db.assetUnit.findMany({
    where: {
      status: { in: ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED', 'SOLD', 'RETIRED'] },
      ...(opts.unitIds ? { id: { in: opts.unitIds } } : {}),
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
    const landedAdj = Number(unit.landedCostAdjustment || 0)
    const cost = unitCost(unit.purchasePrice, unit.landedCostAdjustment)
    const salvageValue = Number(unit.asset.salvageValue || 0)
    const usefulLifeMonths = unit.asset.usefulLifeMonths || 60
    const depMethod = unit.asset.depreciationMethod as DepreciationMethod

    // Sold/retired units stop depreciating when they leave: book value is as of disposal
    const disposal = unitDisposal(unit)
    const bookAsOf = disposal.disposedAt ?? now
    let currentBookValue = cost
    if (unit.purchaseDate && cost > 0) {
      currentBookValue = calculateDepreciatedValue(
        cost,
        unit.purchaseDate,
        depMethod,
        usefulLifeMonths,
        salvageValue,
        unit.receivedDate,
        bookAsOf
      )
    }
    currentBookValue = Math.round(currentBookValue * 100) / 100
    const gainLoss = disposal.disposition === 'SOLD' && disposal.salePrice != null
      ? Math.round((disposal.salePrice - currentBookValue) * 100) / 100
      : null

    const accumulatedDepreciation = cost - currentBookValue
    const depreciableBase = cost - salvageValue
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
      'Landed Cost Adj.': landedAdj || '',
      'Total Cost': cost || '',
      'Salvage Value': salvageValue || '',
      'Depreciable Base': depreciableBase > 0 ? depreciableBase : '',
      'Useful Life (months)': usefulLifeMonths,
      'Depreciation Method': depreciationMethodLabels[depMethod] || depMethod,
      'Current Book Value': currentBookValue,
      'Book Value As Of': formatDate(bookAsOf),
      'Accumulated Depreciation': Math.round(accumulatedDepreciation * 100) / 100,
      'Lifetime Revenue': totalRevenue,
      'Maintenance Cost': maintenanceCost,
      'Net Profit': Math.round((totalRevenue - maintenanceCost) * 100) / 100,
      'Disposition': disposal.disposition ? dispositionLabels[disposal.disposition] : '',
      'Disposed On': disposal.disposedAt ? formatDate(disposal.disposedAt) : '',
      'Disposed To': disposal.recipient || '',
      'Sale Price': disposal.salePrice ?? '',
      'Gain / Loss': gainLoss ?? '',
    }
  })

  // Live inventory first, then everything sold/retired
  const activeRows = rows.filter((r) => !r['Disposition'] && r['Status'] !== 'SOLD' && r['Status'] !== 'RETIRED')
  const disposedRows = rows.filter((r) => !activeRows.includes(r))

  // Summary row
  const sum = (list: typeof rows, key: keyof (typeof rows)[number]) =>
    Math.round(list.reduce((acc, r) => acc + (Number(r[key]) || 0), 0) * 100) / 100
  const totalPurchase = sum(activeRows, 'Purchase Price')
  const totalLandedAdj = sum(activeRows, 'Landed Cost Adj.')
  const totalCost = sum(activeRows, 'Total Cost')
  const totalBookValue = sum(activeRows, 'Current Book Value')
  const totalDepreciation = sum(activeRows, 'Accumulated Depreciation')
  const totalSalvage = sum(activeRows, 'Salvage Value')
  const totalRevenue = sum(activeRows, 'Lifetime Revenue')
  const totalMaintenance = sum(activeRows, 'Maintenance Cost')

  const blank = Object.fromEntries(Object.keys(rows[0] || {}).map((k) => [k, ''])) as unknown as (typeof rows)[number]
  const out: (typeof rows)[number][] = [...activeRows]
  out.push({
    ...blank,
    'Asset Name': `--- TOTALS (${activeRows.length} active units) ---`,
    'Category': '',
    'Barcode': '',
    'Serial Number': '',
    'Status': '' as unknown as typeof rows[0]['Status'],
    'Location': '',
    'Ownership Type': '',
    'Ownership Status': '',
    'Purchase Date': '',
    'Purchase Price': totalPurchase,
    'Landed Cost Adj.': Math.round(totalLandedAdj * 100) / 100,
    'Total Cost': Math.round(totalCost * 100) / 100,
    'Salvage Value': totalSalvage,
    'Depreciable Base': Math.round((totalCost - totalSalvage) * 100) / 100,
    'Useful Life (months)': '' as unknown as number,
    'Depreciation Method': '',
    'Current Book Value': Math.round(totalBookValue * 100) / 100,
    'Accumulated Depreciation': Math.round(totalDepreciation * 100) / 100,
    'Lifetime Revenue': totalRevenue,
    'Maintenance Cost': totalMaintenance,
    'Net Profit': Math.round((totalRevenue - totalMaintenance) * 100) / 100,
  })

  if (disposedRows.length > 0) {
    out.push({ ...blank })
    out.push({ ...blank, 'Asset Name': `=== SOLD / RETIRED (${disposedRows.length} units — not in the totals above; book value as of disposal) ===` })
    out.push(...disposedRows)
    out.push({
      ...blank,
      'Asset Name': '--- SOLD / RETIRED TOTALS ---',
      'Purchase Price': sum(disposedRows, 'Purchase Price'),
      'Landed Cost Adj.': sum(disposedRows, 'Landed Cost Adj.'),
      'Total Cost': sum(disposedRows, 'Total Cost'),
      'Current Book Value': sum(disposedRows, 'Current Book Value'),
      'Accumulated Depreciation': sum(disposedRows, 'Accumulated Depreciation'),
      'Lifetime Revenue': sum(disposedRows, 'Lifetime Revenue'),
      'Sale Price': sum(disposedRows, 'Sale Price'),
      'Gain / Loss': sum(disposedRows, 'Gain / Loss'),
    })
  }

  return out
}
