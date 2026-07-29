import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { InventoryReportData, InventoryReportItem } from '@/lib/actions/reports'

const s = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#2563eb',
  },
  subtitle: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 4,
  },
  // Summary grid
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  summaryBox: {
    width: '31.5%',
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  summaryLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  summarySubtext: {
    fontSize: 7,
    color: '#6b7280',
    marginTop: 2,
  },
  // Table
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  tableHeaderCell: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    fontSize: 7,
  },
  tableCellBold: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
  },
  // Category header
  categoryHeader: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: '#e2e8f0',
    marginTop: 6,
  },
  categoryText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  // Subtotals
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
  },
  subtotalCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
  },
  // Grand totals
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    marginTop: 4,
  },
  grandTotalCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 6,
    color: '#9ca3af',
  },
  // Column widths
  colName: { width: '14%' },
  colBarcode: { width: '8%' },
  colStatus: { width: '7%' },
  colOwnership: { width: '7%' },
  colPurchasePrice: { width: '8%', textAlign: 'right' as const },
  colSalvage: { width: '7%', textAlign: 'right' as const },
  colDepBase: { width: '8%', textAlign: 'right' as const },
  colLife: { width: '5%', textAlign: 'center' as const },
  colBookValue: { width: '9%', textAlign: 'right' as const },
  colAccDepr: { width: '9%', textAlign: 'right' as const },
  colRevenue: { width: '8%', textAlign: 'right' as const },
  colMaint: { width: '6%', textAlign: 'right' as const },
  colLocation: { width: '4%' },
})

function fmt(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const statusLabels: Record<string, string> = {
  AVAILABLE: 'In',
  CHECKED_OUT: 'Out',
  MAINTENANCE: 'Maint',
  RESERVED: 'Rsrvd',
}

type Props = {
  data: InventoryReportData
}

export function InventoryReportPDF({ data }: Props) {
  const { summary, items } = data

  // Group items by category
  const categories = new Map<string, InventoryReportItem[]>()
  for (const item of items) {
    const cat = item.category
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(item)
  }

  const generatedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Full Inventory Report</Text>
            <Text style={s.subtitle}>
              Complete asset snapshot with depreciation, ownership, and valuation
            </Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={s.subtitle}>Generated: {generatedDate}</Text>
            <Text style={s.subtitle}>{summary.totalUnits} active units</Text>
          </View>
        </View>

        {/* Summary Cards - Row 1: Depreciation story */}
        <View style={s.summaryGrid}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Purchase Cost</Text>
            <Text style={s.summaryValue}>{fmt(summary.totalPurchaseValue)}</Text>
            <Text style={s.summarySubtext}>Original cost basis (before depreciation)</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Accumulated Depreciation</Text>
            <Text style={[s.summaryValue, { color: '#dc2626' }]}>{fmt(summary.totalAccumulatedDepreciation)}</Text>
            <Text style={s.summarySubtext}>Salvage value: {fmt(summary.totalSalvageValue)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Current Book Value</Text>
            <Text style={[s.summaryValue, { color: '#2563eb' }]}>{fmt(summary.totalCurrentBookValue)}</Text>
            <Text style={s.summarySubtext}>After depreciation ({summary.totalPurchaseValue > 0 ? Math.round((summary.totalAccumulatedDepreciation / summary.totalPurchaseValue) * 100) : 0}% depreciated)</Text>
          </View>
        </View>
        {/* Summary Cards - Row 2 */}
        <View style={s.summaryGrid}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Asset Value In ({summary.unitsIn} units)</Text>
            <Text style={s.summaryValue}>{fmt(summary.valueIn)}</Text>
            <Text style={s.summarySubtext}>Cost: {fmt(summary.purchaseValueIn)} | Dep: {fmt(summary.purchaseValueIn - summary.valueIn)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Asset Value Out ({summary.unitsOut} units)</Text>
            <Text style={s.summaryValue}>{fmt(summary.valueOut)}</Text>
            <Text style={s.summarySubtext}>Cost: {fmt(summary.purchaseValueOut)} | Dep: {fmt(summary.purchaseValueOut - summary.valueOut)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Revenue / Net Profit</Text>
            <Text style={s.summaryValue}>{fmt(summary.totalRevenue)}</Text>
            <Text style={s.summarySubtext}>
              Net: {fmt(summary.totalRevenue - summary.totalMaintenanceCost)} (maint: {fmt(summary.totalMaintenanceCost)})
            </Text>
          </View>
        </View>

        {/* Table Header */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, s.colName]}>Asset Name</Text>
            <Text style={[s.tableHeaderCell, s.colBarcode]}>Barcode</Text>
            <Text style={[s.tableHeaderCell, s.colStatus]}>Status</Text>
            <Text style={[s.tableHeaderCell, s.colOwnership]}>Owned</Text>
            <Text style={[s.tableHeaderCell, s.colPurchasePrice]}>Cost</Text>
            <Text style={[s.tableHeaderCell, s.colSalvage]}>Salvage</Text>
            <Text style={[s.tableHeaderCell, s.colDepBase]}>Dep. Base</Text>
            <Text style={[s.tableHeaderCell, s.colLife]}>Life</Text>
            <Text style={[s.tableHeaderCell, s.colBookValue]}>Book Value</Text>
            <Text style={[s.tableHeaderCell, s.colAccDepr]}>Acc. Depr.</Text>
            <Text style={[s.tableHeaderCell, s.colRevenue]}>Revenue</Text>
            <Text style={[s.tableHeaderCell, s.colMaint]}>Maint.</Text>
            <Text style={[s.tableHeaderCell, s.colLocation]}>Loc</Text>
          </View>

          {/* Category groups */}
          {Array.from(categories.entries()).map(([category, catItems]) => {
            const catPurchase = catItems.reduce((s, i) => s + i.purchasePrice, 0)
            const catBookValue = catItems.reduce((s, i) => s + i.currentBookValue, 0)
            const catDepreciation = catItems.reduce((s, i) => s + i.accumulatedDepreciation, 0)
            const catRevenue = catItems.reduce((s, i) => s + i.totalRevenue, 0)
            const catSalvage = catItems.reduce((s, i) => s + i.salvageValue, 0)
            const catMaint = catItems.reduce((s, i) => s + i.maintenanceCost, 0)

            return (
              <React.Fragment key={category}>
                {/* Category header */}
                <View style={s.categoryHeader}>
                  <Text style={s.categoryText}>{category} ({catItems.length} units)</Text>
                </View>

                {/* Items */}
                {catItems.map((item, idx) => (
                  <View
                    key={item.barcode}
                    style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
                    wrap={false}
                  >
                    <Text style={[s.tableCell, s.colName]}>{item.assetName}</Text>
                    <Text style={[s.tableCell, s.colBarcode]}>{item.barcode}</Text>
                    <Text style={[s.tableCell, s.colStatus]}>{statusLabels[item.status] || item.status}</Text>
                    <Text style={[s.tableCell, s.colOwnership]}>
                      {item.ownershipStatus === 'OWNED' ? 'Owned' : item.ownershipStatus === 'NOT_OWNED' ? (item.loanName ? item.loanName : 'Not Owned') : '-'}
                    </Text>
                    <Text style={[s.tableCell, s.colPurchasePrice]}>{item.purchasePrice > 0 ? fmt(item.purchasePrice) : '-'}</Text>
                    <Text style={[s.tableCell, s.colSalvage]}>{item.salvageValue > 0 ? fmt(item.salvageValue) : '-'}</Text>
                    <Text style={[s.tableCell, s.colDepBase]}>{item.depreciableBase > 0 ? fmt(item.depreciableBase) : '-'}</Text>
                    <Text style={[s.tableCell, s.colLife]}>{item.usefulLifeMonths}m</Text>
                    <Text style={[s.tableCellBold, s.colBookValue]}>{fmt(item.currentBookValue)}</Text>
                    <Text style={[s.tableCell, s.colAccDepr]}>{fmt(item.accumulatedDepreciation)}</Text>
                    <Text style={[s.tableCell, s.colRevenue]}>{item.totalRevenue > 0 ? fmt(item.totalRevenue) : '-'}</Text>
                    <Text style={[s.tableCell, s.colMaint]}>{item.maintenanceCost > 0 ? fmt(item.maintenanceCost) : '-'}</Text>
                    <Text style={[s.tableCell, s.colLocation]}>{item.location || ''}</Text>
                  </View>
                ))}

                {/* Category subtotal */}
                <View style={s.subtotalRow} wrap={false}>
                  <Text style={[s.subtotalCell, s.colName]}>Subtotal</Text>
                  <Text style={[s.subtotalCell, s.colBarcode]}></Text>
                  <Text style={[s.subtotalCell, s.colStatus]}>{catItems.length}</Text>
                  <Text style={[s.subtotalCell, s.colOwnership]}></Text>
                  <Text style={[s.subtotalCell, s.colPurchasePrice]}>{fmt(catPurchase)}</Text>
                  <Text style={[s.subtotalCell, s.colSalvage]}>{fmt(catSalvage)}</Text>
                  <Text style={[s.subtotalCell, s.colDepBase]}>{fmt(catPurchase - catSalvage)}</Text>
                  <Text style={[s.subtotalCell, s.colLife]}></Text>
                  <Text style={[s.subtotalCell, s.colBookValue]}>{fmt(catBookValue)}</Text>
                  <Text style={[s.subtotalCell, s.colAccDepr]}>{fmt(catDepreciation)}</Text>
                  <Text style={[s.subtotalCell, s.colRevenue]}>{fmt(catRevenue)}</Text>
                  <Text style={[s.subtotalCell, s.colMaint]}>{fmt(catMaint)}</Text>
                  <Text style={[s.subtotalCell, s.colLocation]}></Text>
                </View>
              </React.Fragment>
            )
          })}

          {/* Grand total */}
          <View style={s.grandTotalRow} wrap={false}>
            <Text style={[s.grandTotalCell, s.colName]}>GRAND TOTAL</Text>
            <Text style={[s.grandTotalCell, s.colBarcode]}></Text>
            <Text style={[s.grandTotalCell, s.colStatus]}>{summary.totalUnits}</Text>
            <Text style={[s.grandTotalCell, s.colOwnership]}></Text>
            <Text style={[s.grandTotalCell, s.colPurchasePrice]}>{fmt(summary.totalPurchaseValue)}</Text>
            <Text style={[s.grandTotalCell, s.colSalvage]}>{fmt(summary.totalSalvageValue)}</Text>
            <Text style={[s.grandTotalCell, s.colDepBase]}>{fmt(summary.totalPurchaseValue - summary.totalSalvageValue)}</Text>
            <Text style={[s.grandTotalCell, s.colLife]}></Text>
            <Text style={[s.grandTotalCell, s.colBookValue]}>{fmt(summary.totalCurrentBookValue)}</Text>
            <Text style={[s.grandTotalCell, s.colAccDepr]}>{fmt(summary.totalAccumulatedDepreciation)}</Text>
            <Text style={[s.grandTotalCell, s.colRevenue]}>{fmt(summary.totalRevenue)}</Text>
            <Text style={[s.grandTotalCell, s.colMaint]}>{fmt(summary.totalMaintenanceCost)}</Text>
            <Text style={[s.grandTotalCell, s.colLocation]}></Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated: {generatedDate}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
          <Text style={s.footerText}>Full Inventory Report</Text>
        </View>
      </Page>
    </Document>
  )
}
