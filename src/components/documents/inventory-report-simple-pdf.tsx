import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { InventoryReportData, InventoryReportItem } from '@/lib/actions/reports'

const s = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
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
  // Summary row
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryBox: {
    flex: 1,
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
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 2,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    fontSize: 8,
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  // Category header
  categoryHeader: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: '#e2e8f0',
    marginTop: 8,
  },
  categoryText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  // Subtotals
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
  },
  subtotalCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
  },
  // Grand totals
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    marginTop: 4,
  },
  grandTotalCell: {
    fontSize: 9,
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
  // Column widths — portrait, 5 columns
  colName: { width: '30%' },
  colBarcode: { width: '18%' },
  colStatus: { width: '12%' },
  colBookValue: { width: '20%', textAlign: 'right' as const },
  colLocation: { width: '20%' },
})

function fmt(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

const statusLabels: Record<string, string> = {
  AVAILABLE: 'Available',
  CHECKED_OUT: 'Checked Out',
  MAINTENANCE: 'Maintenance',
  RESERVED: 'Reserved',
}

type Props = {
  data: InventoryReportData
}

export function InventoryReportSimplePDF({ data }: Props) {
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
      <Page size="LETTER" orientation="portrait" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Inventory Report</Text>
            <Text style={s.subtitle}>Compact asset list by category</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={s.subtitle}>Generated: {generatedDate}</Text>
            <Text style={s.subtitle}>{summary.totalUnits} active units</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Items</Text>
            <Text style={s.summaryValue}>{summary.totalUnits}</Text>
            <Text style={s.summarySubtext}>
              {summary.unitsIn} in / {summary.unitsOut} out
              {summary.unitsMaintenance > 0 ? ` / ${summary.unitsMaintenance} maint` : ''}
            </Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Book Value</Text>
            <Text style={[s.summaryValue, { color: '#2563eb' }]}>{fmt(summary.totalCurrentBookValue)}</Text>
            <Text style={s.summarySubtext}>Purchase cost: {fmt(summary.totalPurchaseValue)}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Depreciation</Text>
            <Text style={[s.summaryValue, { color: '#dc2626' }]}>{fmt(summary.totalAccumulatedDepreciation)}</Text>
            <Text style={s.summarySubtext}>
              {summary.totalPurchaseValue > 0
                ? `${Math.round((summary.totalAccumulatedDepreciation / summary.totalPurchaseValue) * 100)}% depreciated`
                : '0% depreciated'}
            </Text>
          </View>
        </View>

        {/* Table */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, s.colName]}>Asset</Text>
            <Text style={[s.tableHeaderCell, s.colBarcode]}>Barcode</Text>
            <Text style={[s.tableHeaderCell, s.colStatus]}>Status</Text>
            <Text style={[s.tableHeaderCell, s.colBookValue]}>Book Value</Text>
            <Text style={[s.tableHeaderCell, s.colLocation]}>Location</Text>
          </View>

          {Array.from(categories.entries()).map(([category, catItems]) => {
            const catBookValue = catItems.reduce((acc, i) => acc + i.currentBookValue, 0)

            return (
              <React.Fragment key={category}>
                <View style={s.categoryHeader}>
                  <Text style={s.categoryText}>{category} ({catItems.length} units)</Text>
                </View>

                {catItems.map((item, idx) => (
                  <View
                    key={item.barcode}
                    style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
                    wrap={false}
                  >
                    <Text style={[s.tableCellBold, s.colName]}>{item.assetName}</Text>
                    <Text style={[s.tableCell, s.colBarcode]}>{item.barcode}</Text>
                    <Text style={[s.tableCell, s.colStatus]}>{statusLabels[item.status] || item.status}</Text>
                    <Text style={[s.tableCellBold, s.colBookValue]}>{fmt(item.currentBookValue)}</Text>
                    <Text style={[s.tableCell, s.colLocation]}>{item.location || ''}</Text>
                  </View>
                ))}

                <View style={s.subtotalRow} wrap={false}>
                  <Text style={[s.subtotalCell, s.colName]}>Subtotal</Text>
                  <Text style={[s.subtotalCell, s.colBarcode]}></Text>
                  <Text style={[s.subtotalCell, s.colStatus]}>{catItems.length}</Text>
                  <Text style={[s.subtotalCell, s.colBookValue]}>{fmt(catBookValue)}</Text>
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
            <Text style={[s.grandTotalCell, s.colBookValue]}>{fmt(summary.totalCurrentBookValue)}</Text>
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
          <Text style={s.footerText}>Inventory Report (Simple)</Text>
        </View>
      </Page>
    </Document>
  )
}
