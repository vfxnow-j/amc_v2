import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'

export type PurchaseOrderData = {
  number: string
  // Vendor
  vendorName: string
  vendorEmail?: string
  vendorPhone?: string
  vendorAddress?: string
  // Ship To
  shipToName?: string
  shipToAddress?: string
  // Dates
  orderDate: string
  expectedDate?: string
  // Status
  status: string
  creditTerms?: string
  // Items
  items: {
    description: string
    quantity: number
    unitPrice: number
    amount: number
  }[]
  // Totals
  subtotal: number
  discountAmount: number
  freightAmount: number
  taxAmount: number
  taxExempt?: boolean
  total: number
  // Notes
  notes?: string
  // Prepared by (current user)
  preparedBy?: string
}

type Props = {
  data: PurchaseOrderData
  logoDataUri?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function PurchaseOrderPDF({ data, logoDataUri }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={[s.page, { paddingBottom: 60 }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoDataUri ? (
              <Image src={logoDataUri} style={s.logo} />
            ) : (
              <Text style={s.documentTitle}>AMC</Text>
            )}
          </View>
          <View style={s.headerRight}>
            <Text style={s.documentTitle}>Purchase Order</Text>
            <Text style={s.documentNumber}>{data.number}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Status: {data.status}
            </Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Vendor</Text>
            <Text style={s.infoBoxTextBold}>{data.vendorName}</Text>
            {data.vendorEmail && (
              <Text style={s.infoBoxText}>{data.vendorEmail}</Text>
            )}
            {data.vendorPhone && (
              <Text style={s.infoBoxText}>{data.vendorPhone}</Text>
            )}
            {data.vendorAddress && (
              <Text style={s.infoBoxText}>{data.vendorAddress}</Text>
            )}
          </View>
          <View style={s.infoBox}>
            {data.shipToName ? (
              <>
                <Text style={s.infoBoxTitle}>Ship To</Text>
                <Text style={s.infoBoxTextBold}>{data.shipToName}</Text>
                {data.shipToAddress && (
                  <Text style={s.infoBoxText}>{data.shipToAddress}</Text>
                )}
              </>
            ) : (
              <Text style={s.infoBoxTitle}>Ship To</Text>
            )}
            <Text style={s.infoBoxText}>
              Order Date: {data.orderDate}
            </Text>
            {data.expectedDate && (
              <Text style={s.infoBoxText}>Expected: {data.expectedDate}</Text>
            )}
            {data.preparedBy && (
              <Text style={s.infoBoxText}>Prepared By: {data.preparedBy}</Text>
            )}
            {data.creditTerms && (
              <Text style={s.infoBoxText}>Terms: {data.creditTerms}</Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, { width: '50%' }]}>Description</Text>
            <Text style={[s.tableHeaderCell, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeaderCell, { width: '20%', textAlign: 'right' as const }]}>Unit Price</Text>
            <Text style={[s.tableHeaderCell, { width: '20%', textAlign: 'right' as const }]}>Amount</Text>
          </View>
          {data.items.map((item, index) => (
            <View
              key={index}
              style={index % 2 === 0 ? s.tableRow : s.tableRowAlt}
              wrap={false}
            >
              <Text style={[s.tableCell, { width: '50%' }]}>{item.description}</Text>
              <Text style={[s.tableCell, s.colQty]}>{item.quantity}</Text>
              <Text style={[s.tableCell, { width: '20%', textAlign: 'right' as const }]}>
                {formatCurrency(item.unitPrice)}
              </Text>
              <Text style={[s.tableCellBold, { width: '20%', textAlign: 'right' as const }]}>
                {formatCurrency(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals — keep together */}
        <View style={s.totalsSection} wrap={false}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{formatCurrency(data.subtotal)}</Text>
            </View>
            {data.discountAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Discount</Text>
                <Text style={s.totalsValue}>
                  -{formatCurrency(data.discountAmount)}
                </Text>
              </View>
            )}
            {data.freightAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Freight / Shipping</Text>
                <Text style={s.totalsValue}>
                  {formatCurrency(data.freightAmount)}
                </Text>
              </View>
            )}
            {data.taxExempt ? (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Tax</Text>
                <Text style={s.totalsValue}>Tax Exempt</Text>
              </View>
            ) : data.taxAmount > 0 ? (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Tax</Text>
                <Text style={s.totalsValue}>
                  {formatCurrency(data.taxAmount)}
                </Text>
              </View>
            ) : null}
            <View style={s.totalsDivider} />
            <View style={s.totalsRow}>
              <Text style={s.totalGrandLabel}>Total</Text>
              <Text style={s.totalGrandValue}>{formatCurrency(data.total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes — keep together */}
        {data.notes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <Text style={s.footerText}>{data.number} - Purchase Order</Text>
        </View>
      </Page>
    </Document>
  )
}
