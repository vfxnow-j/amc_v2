import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { StockCountReportData, StockCountReportItem } from '@/lib/actions/reports'

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
    fontSize: 8,
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
    fontSize: 9,
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  categoryHeader: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: '#e2e8f0',
    marginTop: 8,
  },
  categoryText: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
  },
  subtotalCell: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
  },
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: '#1e293b',
    borderRadius: 2,
    marginTop: 4,
  },
  grandTotalCell: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
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
  colItem: { width: '58%' },
  colAvailable: { width: '14%', textAlign: 'right' as const },
  colOut: { width: '14%', textAlign: 'right' as const },
  colTotal: { width: '14%', textAlign: 'right' as const },
})

type Props = {
  data: StockCountReportData
}

export function StockCountPDF({ data }: Props) {
  const { items, summary } = data

  const categories = new Map<string, StockCountReportItem[]>()
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
        <View style={s.header}>
          <View>
            <Text style={s.title}>Stock Count</Text>
            <Text style={s.subtitle}>Available quantity on shelf by item</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={s.subtitle}>Generated: {generatedDate}</Text>
            <Text style={s.subtitle}>{summary.totalAssets} items</Text>
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Available</Text>
            <Text style={[s.summaryValue, { color: '#16a34a' }]}>{summary.totalAvailable}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Checked Out</Text>
            <Text style={s.summaryValue}>{summary.totalCheckedOut}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Reserved</Text>
            <Text style={s.summaryValue}>{summary.totalReserved}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Maintenance</Text>
            <Text style={s.summaryValue}>{summary.totalMaintenance}</Text>
          </View>
          <View style={s.summaryBox}>
            <Text style={s.summaryLabel}>Total Units</Text>
            <Text style={s.summaryValue}>{summary.totalUnits}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, s.colItem]}>Item</Text>
            <Text style={[s.tableHeaderCell, s.colAvailable]}>Available</Text>
            <Text style={[s.tableHeaderCell, s.colOut]}>Out</Text>
            <Text style={[s.tableHeaderCell, s.colTotal]}>Total</Text>
          </View>

          {Array.from(categories.entries()).map(([category, catItems]) => {
            const catAvailable = catItems.reduce((a, i) => a + i.available, 0)
            const catOut = catItems.reduce((a, i) => a + i.checkedOut + i.reserved, 0)
            const catTotal = catItems.reduce((a, i) => a + i.total, 0)

            return (
              <React.Fragment key={category}>
                <View style={s.categoryHeader} wrap={false}>
                  <Text style={s.categoryText}>{category}</Text>
                </View>

                {catItems.map((item, idx) => (
                  <View
                    key={item.assetId}
                    style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
                    wrap={false}
                  >
                    <Text style={[s.tableCellBold, s.colItem]}>{item.assetName}</Text>
                    <Text style={[s.tableCellBold, s.colAvailable, { color: item.available > 0 ? '#16a34a' : '#dc2626' }]}>
                      {item.available}
                    </Text>
                    <Text style={[s.tableCell, s.colOut]}>{item.checkedOut + item.reserved}</Text>
                    <Text style={[s.tableCell, s.colTotal]}>{item.total}</Text>
                  </View>
                ))}

                <View style={s.subtotalRow} wrap={false}>
                  <Text style={[s.subtotalCell, s.colItem]}>Subtotal — {catItems.length} items</Text>
                  <Text style={[s.subtotalCell, s.colAvailable]}>{catAvailable}</Text>
                  <Text style={[s.subtotalCell, s.colOut]}>{catOut}</Text>
                  <Text style={[s.subtotalCell, s.colTotal]}>{catTotal}</Text>
                </View>
              </React.Fragment>
            )
          })}

          <View style={s.grandTotalRow} wrap={false}>
            <Text style={[s.grandTotalCell, s.colItem]}>GRAND TOTAL</Text>
            <Text style={[s.grandTotalCell, s.colAvailable]}>{summary.totalAvailable}</Text>
            <Text style={[s.grandTotalCell, s.colOut]}>{summary.totalCheckedOut + summary.totalReserved}</Text>
            <Text style={[s.grandTotalCell, s.colTotal]}>{summary.totalUnits}</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated: {generatedDate}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
          <Text style={s.footerText}>Stock Count</Text>
        </View>
      </Page>
    </Document>
  )
}
