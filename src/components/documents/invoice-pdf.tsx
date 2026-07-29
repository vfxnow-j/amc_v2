import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'

export type InvoiceData = {
  invoiceNumber: string
  issueDate: string
  dueDate: string
  paymentTerms?: string
  // Client info
  clientName: string
  clientCompany?: string
  clientEmail?: string
  clientPhone?: string
  clientAddress?: string
  // Reservation link
  reservationNumber?: string
  // Items
  items: {
    description: string
    quantity: number
    unitPrice: number
    amount: number
    // Component nesting — true for items rendered indented beneath a parent.
    isComponent?: boolean
    configuredTotal?: number
  }[]
  // Totals
  subtotal: number
  // Optional adjustment lines shown between subtotal and tax. Real invoices
  // fold these into their line items, so they're only populated for pro formas
  // rendered straight off an order.
  discountAmount?: number
  creditAmount?: number
  creditLabel?: string
  deliveryCost?: number
  returnCost?: number
  taxRate: number
  taxLabel?: string
  taxAmount: number
  total: number
  amountPaid: number
  balanceDue: number
  // Payments
  payments?: {
    date: string
    method: string
    amount: number
  }[]
  // Notes
  notes?: string
  terms?: string
}

type Props = {
  data: InvoiceData
  logoDataUri?: string
  /**
   * Renders the same layout as a pro forma invoice: a quotation of what the
   * final invoice will look like. It carries no payment obligation and is not
   * a tax document, so the wording and validity framing differ throughout.
   */
  proForma?: boolean
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function InvoicePDF({ data, logoDataUri, proForma }: Props) {
  const docLabel = proForma ? 'Pro Forma Invoice' : 'Invoice'
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
            <Text style={s.documentTitle}>{proForma ? 'PRO FORMA INVOICE' : 'INVOICE'}</Text>
            <Text style={s.documentNumber}>{data.invoiceNumber}</Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Bill To</Text>
            <Text style={s.infoBoxTextBold}>{data.clientName}</Text>
            {data.clientCompany && (
              <Text style={s.infoBoxText}>{data.clientCompany}</Text>
            )}
            {data.clientEmail && (
              <Text style={s.infoBoxText}>{data.clientEmail}</Text>
            )}
            {data.clientPhone && (
              <Text style={s.infoBoxText}>{data.clientPhone}</Text>
            )}
            {data.clientAddress && (
              <Text style={s.infoBoxText}>{data.clientAddress}</Text>
            )}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>{proForma ? 'Pro Forma Details' : 'Invoice Details'}</Text>
            <Text style={s.infoBoxText}>
              {proForma ? 'Reference #' : 'Invoice #'}: {data.invoiceNumber}
            </Text>
            <Text style={s.infoBoxText}>
              Issue Date: {data.issueDate}
            </Text>
            <Text style={s.infoBoxText}>
              {proForma ? 'Valid Until' : 'Due Date'}: {data.dueDate}
            </Text>
            {data.paymentTerms && (
              <Text style={s.infoBoxText}>
                Terms: {data.paymentTerms}
              </Text>
            )}
            {data.reservationNumber && (
              <Text style={s.infoBoxText}>
                {proForma ? 'Order' : 'Reservation'}: {data.reservationNumber}
              </Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, { width: '45%' }]}>Description</Text>
            <Text style={[s.tableHeaderCell, { width: '10%', textAlign: 'center' }]}>Qty</Text>
            <Text style={[s.tableHeaderCell, { width: '20%', textAlign: 'right' }]}>Unit Price</Text>
            <Text style={[s.tableHeaderCell, { width: '25%', textAlign: 'right' }]}>Amount</Text>
          </View>
          {data.items.map((item, index) => {
            const showConfigured = item.configuredTotal != null && item.configuredTotal !== item.amount
            return (
              <React.Fragment key={index}>
                <View
                  style={index % 2 === 0 ? s.tableRow : s.tableRowAlt}
                  wrap={false}
                >
                  <Text style={[s.tableCell, { width: '45%' }]}>
                    {item.isComponent ? `     ↳ ${item.description}` : item.description}
                  </Text>
                  <Text style={[s.tableCell, { width: '10%', textAlign: 'center' }]}>
                    {item.quantity}
                  </Text>
                  <Text style={[s.tableCell, { width: '20%', textAlign: 'right' }]}>
                    {formatCurrency(item.unitPrice)}
                  </Text>
                  <Text style={[s.tableCellBold, { width: '25%', textAlign: 'right' }]}>
                    {formatCurrency(item.amount)}
                  </Text>
                </View>
                {showConfigured && (
                  <View
                    style={{ flexDirection: 'row', paddingHorizontal: 6, paddingBottom: 3 }}
                    wrap={false}
                  >
                    <Text style={[s.tableCell, { width: '45%', fontSize: 8, color: '#6b7280', fontStyle: 'italic' }]}>
                      Configured total
                    </Text>
                    <Text style={[s.tableCell, { width: '10%' }]}></Text>
                    <Text style={[s.tableCell, { width: '20%' }]}></Text>
                    <Text style={[s.tableCellBold, { width: '25%', textAlign: 'right', color: '#2563eb', fontSize: 9 }]}>
                      {formatCurrency(item.configuredTotal!)}
                    </Text>
                  </View>
                )}
              </React.Fragment>
            )
          })}
        </View>

        {/* Totals — keep together */}
        <View style={s.totalsSection} wrap={false}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{formatCurrency(data.subtotal)}</Text>
            </View>
            {!!data.discountAmount && data.discountAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Discount</Text>
                <Text style={[s.totalsValue, { color: '#16a34a' }]}>
                  -{formatCurrency(data.discountAmount)}
                </Text>
              </View>
            )}
            {!!data.creditAmount && data.creditAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>{data.creditLabel || 'Credit Applied'}</Text>
                <Text style={[s.totalsValue, { color: '#16a34a' }]}>
                  -{formatCurrency(data.creditAmount)}
                </Text>
              </View>
            )}
            {!!data.deliveryCost && data.deliveryCost > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Delivery</Text>
                <Text style={s.totalsValue}>{formatCurrency(data.deliveryCost)}</Text>
              </View>
            )}
            {!!data.returnCost && data.returnCost > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Return / Collection</Text>
                <Text style={s.totalsValue}>{formatCurrency(data.returnCost)}</Text>
              </View>
            )}
            {data.taxAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>
                  {data.taxLabel || `Tax (${data.taxRate}%)`}
                </Text>
                <Text style={s.totalsValue}>
                  {formatCurrency(data.taxAmount)}
                </Text>
              </View>
            )}
            <View style={s.totalsDivider} />
            <View style={s.totalsRow}>
              <Text style={s.totalGrandLabel}>Total</Text>
              <Text style={s.totalGrandValue}>{formatCurrency(data.total)}</Text>
            </View>
            {data.amountPaid > 0 && (
              <>
                <View style={s.totalsRow}>
                  <Text style={s.totalsLabel}>Amount Paid</Text>
                  <Text style={[s.totalsValue, { color: '#16a34a' }]}>
                    -{formatCurrency(data.amountPaid)}
                  </Text>
                </View>
                <View style={s.totalsDivider} />
                <View style={s.totalsRow}>
                  <Text style={s.totalGrandLabel}>Balance Due</Text>
                  <Text style={s.totalGrandValue}>
                    {formatCurrency(data.balanceDue)}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Pro forma notice — this document is not a demand for payment */}
        {proForma && (
          <View
            style={{ marginBottom: 20, padding: 12, backgroundColor: '#f8fafc', borderRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' }}
            wrap={false}
          >
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Pro Forma Invoice
            </Text>
            <Text style={{ fontSize: 9, lineHeight: 1.4 }}>
              This pro forma invoice is issued for quotation, customs and internal
              approval purposes only. It is not a tax invoice and is not a demand for
              payment — no amount is due against this document. Figures reflect the
              order as configured on the issue date and remain valid until the date
              shown above. A tax invoice will be issued once the order is confirmed.
              All amounts are in USD.
            </Text>
          </View>
        )}

        {/* Payment History — keep together */}
        {data.payments && data.payments.length > 0 && (
          <View style={{ marginBottom: 20 }} wrap={false}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>
              Payment History
            </Text>
            {data.payments.map((payment, index) => (
              <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
                <Text style={{ fontSize: 9 }}>{payment.date}</Text>
                <Text style={{ fontSize: 9, color: '#6b7280' }}>{payment.method}</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>
                  {formatCurrency(payment.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Notes — keep together */}
        {data.notes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Terms — keep together */}
        {data.terms && (
          <View
            style={{ marginBottom: 20, padding: 12, backgroundColor: '#f8fafc', borderRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' }}
            wrap={false}
          >
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Terms & Conditions
            </Text>
            <Text style={{ fontSize: 9, lineHeight: 1.4 }}>{data.terms}</Text>
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
          <Text style={s.footerText}>{data.invoiceNumber} - {docLabel}</Text>
        </View>
      </Page>
    </Document>
  )
}
