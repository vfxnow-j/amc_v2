import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'
import { groupRowsWithBreakdown } from '@/lib/utils/item-rows'

export type OrderDetailData = {
  entityType: 'RESERVATION' | 'PURCHASE_ORDER'
  number: string
  // Client/Vendor info
  contactLabel: string
  contactName: string
  contactCompany?: string
  contactEmail?: string
  contactPhone?: string
  contactAddress?: string
  // Dates
  dateLabel: string
  startDate: string
  endDate?: string
  /** Plain-English length of the rental term, e.g. '6 weeks'. Rentals only. */
  termLength?: string
  // Metadata
  projectName?: string
  projectCode?: string
  status: string
  /** Pre-formatted date the quoted pricing expires — omitted when the order has none set. */
  quoteExpiresAt?: string
  // Items
  items: {
    description: string
    quantity: number
    pricingType?: string
    rate: number
    amount: number
    category?: string
    costBasis?: number
    marginPercent?: number
    assetNumbers?: string[]
    // Component nesting — when isComponent is true, the row is rendered indented
    // beneath its parent. configuredTotal on parents shows base + components sum.
    isComponent?: boolean
    configuredTotal?: number
    /**
     * Pre-formatted derivation of the line amount when the term doesn't land on a
     * whole billing period — e.g. '$400.00/mo → $551.95 for 6 weeks'. Omitted when
     * the rate already is the amount (one-time, project, exactly one period).
     */
    termNote?: string
  }[]
  // Totals
  subtotal: number
  discountAmount?: number
  taxRate?: number
  taxAmount: number
  total: number
  // Margin (sales)
  totalCost?: number
  totalMargin?: number
  // Payment terms
  paymentTerms?: string
  // Notes
  notes?: string
  // Delivery info
  deliveryMethod?: string
  deliveryAddress?: string
  deliveryDate?: string
  deliveryCost?: number
  deliveryNotes?: string
  deliveryTrackingProvider?: string
  deliveryTrackingNumber?: string
  returnMethod?: string
  returnDate?: string
  returnCost?: number
  returnTrackingProvider?: string
  returnTrackingNumber?: string
  // Rent-to-Own
  reservationType?: string
  rtoTermMonths?: number
  rtoMonthlyPayment?: number
  rtoBuyoutPrice?: number
  rtoInstallmentsPaid?: number
  rtoStartDate?: string
}

type Props = {
  data: OrderDetailData
  logoDataUri?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function OrderDetailPDF({ data, logoDataUri }: Props) {
  const hasDeliveryInfo = !!(data.deliveryMethod || data.returnMethod)
  const hasNotes = !!data.notes
  const isRTO = data.reservationType === 'RENT_TO_OWN' && !!data.rtoTermMonths && !!data.rtoMonthlyPayment

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
            <Text style={s.documentTitle}>{isRTO ? 'RTO Order Detail' : 'Order Detail'}</Text>
            <Text style={s.documentNumber}>{data.number}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Status: {data.status}
            </Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>{data.contactLabel}</Text>
            <Text style={s.infoBoxTextBold}>{data.contactName}</Text>
            {data.contactCompany && (
              <Text style={s.infoBoxText}>{data.contactCompany}</Text>
            )}
            {data.contactEmail && (
              <Text style={s.infoBoxText}>{data.contactEmail}</Text>
            )}
            {data.contactPhone && (
              <Text style={s.infoBoxText}>{data.contactPhone}</Text>
            )}
            {data.contactAddress && (
              <Text style={s.infoBoxText}>{data.contactAddress}</Text>
            )}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Order Details</Text>
            <Text style={s.infoBoxText}>
              {data.dateLabel}: {data.startDate}
            </Text>
            {data.endDate && (
              <Text style={s.infoBoxText}>End Date: {data.endDate}</Text>
            )}
            {data.termLength && (
              <Text style={s.infoBoxText}>Rental Term: {data.termLength}</Text>
            )}
            {data.projectName && (
              <Text style={s.infoBoxText}>Project: {data.projectName}</Text>
            )}
            {data.projectCode && (
              <Text style={s.infoBoxText}>Code: {data.projectCode}</Text>
            )}
            {data.paymentTerms && (
              <Text style={s.infoBoxText}>Terms: {data.paymentTerms}</Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={s.table}>
          {/* Table header repeats on each page */}
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, s.colDescription]}>Description</Text>
            <Text style={[s.tableHeaderCell, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeaderCell, s.colPricing]}>Type</Text>
            <Text style={[s.tableHeaderCell, s.colRate]}>Rate</Text>
            <Text style={[s.tableHeaderCell, s.colAmount]}>Amount</Text>
          </View>
          {(() => {
            // Group items by category, preserving order
            const groups: { category: string; items: typeof data.items }[] = []
            const catMap = new Map<string, typeof data.items>()
            const catOrder: string[] = []
            for (const item of data.items) {
              const cat = item.category || 'Other'
              if (!catMap.has(cat)) {
                catMap.set(cat, [])
                catOrder.push(cat)
              }
              catMap.get(cat)!.push(item)
            }
            for (const cat of catOrder) {
              groups.push({ category: cat, items: catMap.get(cat)! })
            }
            const hasCategories = groups.length > 1 || (groups.length === 1 && groups[0].category !== 'Other')
            let rowIdx = 0
            return groups.map((group) => (
              <View key={group.category}>
                {hasCategories && (
                  <View
                    style={{ flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 3, paddingHorizontal: 6 }}
                    minPresenceAhead={30}
                  >
                    <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#374151' }}>
                      {group.category}
                    </Text>
                  </View>
                )}
                {groupRowsWithBreakdown(group.items).map(({ item, breakdown }) => {
                  const idx = rowIdx++
                  const showConfigured = item.configuredTotal != null && item.configuredTotal !== item.amount && breakdown.length === 0
                  const alt = idx % 2 !== 0
                  return (
                    <View
                      key={idx}
                      wrap={false}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: '#e2e8f0',
                        ...(alt ? { backgroundColor: '#f8fafc' } : {}),
                      }}
                    >
                      <View style={{ flexDirection: 'row' }}>
                        <View style={s.colDescription}>
                          <Text style={s.tableCell}>
                            {item.isComponent ? `     ↳ ${item.description}` : item.description}
                          </Text>
                          {/* How the amount was reached when the term isn't a whole
                              number of billing periods (e.g. a 6-week monthly rental). */}
                          {item.termNote && (
                            <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>
                              {item.termNote}
                            </Text>
                          )}
                        </View>
                        <Text style={[s.tableCell, s.colQty]}>{item.quantity}</Text>
                        <Text style={[s.tableCell, s.colPricing]}>
                          {item.pricingType || '-'}
                        </Text>
                        <Text style={[s.tableCell, s.colRate]}>
                          {formatCurrency(item.rate)}
                        </Text>
                        <Text style={[s.tableCellBold, s.colAmount]}>
                          {formatCurrency(item.amount)}
                        </Text>
                      </View>
                      {breakdown.length > 0 && (
                        <View style={{ marginTop: 4, paddingLeft: 10 }}>
                          {breakdown.map((b, i) => (
                            <Text key={i} style={{ fontSize: 8, color: '#6b7280' }}>
                              ↳ {b.description}
                            </Text>
                          ))}
                        </View>
                      )}
                      {showConfigured && (
                        <View style={{ flexDirection: 'row', marginTop: 4 }}>
                          <Text style={[s.tableCell, s.colDescription, { fontSize: 8, color: '#6b7280', fontStyle: 'italic' }]}>
                            Configured total
                          </Text>
                          <Text style={[s.tableCell, s.colQty]}></Text>
                          <Text style={[s.tableCell, s.colPricing]}></Text>
                          <Text style={[s.tableCell, s.colRate]}></Text>
                          <Text style={[s.tableCellBold, s.colAmount, { color: '#2563eb', fontSize: 9 }]}>
                            {formatCurrency(item.configuredTotal!)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            ))
          })()}
        </View>

        {/* Totals — keep together, never split across pages */}
        <View style={s.totalsSection} wrap={false}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{formatCurrency(data.subtotal)}</Text>
            </View>
            {data.taxAmount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>
                  Tax{data.taxRate ? ` (${data.taxRate}%)` : ''}
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
          </View>
        </View>

        {/* RTO Financing Details */}
        {isRTO && (
          <View style={{ marginBottom: 16 }} wrap={false}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>
              Rent-to-Own Financing Details
            </Text>
            <View style={{ flexDirection: 'row', gap: 20, marginBottom: 10 }}>
              <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Term</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{data.rtoTermMonths} Months</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Monthly Payment</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{formatCurrency(data.rtoMonthlyPayment!)}/mo</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Total Buyout Price</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{formatCurrency(data.rtoBuyoutPrice ?? data.total)}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Ownership</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>Transfers upon final payment</Text>
              </View>
            </View>
            {/* Installment progress (if any payments made) */}
            {(data.rtoInstallmentsPaid ?? 0) > 0 && (
              <View style={{ flexDirection: 'row', gap: 20, marginBottom: 10 }}>
                <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                  <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Installments Paid</Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{data.rtoInstallmentsPaid} of {data.rtoTermMonths}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 8, borderRadius: 4 }}>
                  <Text style={{ fontSize: 8, color: '#6b7280', marginBottom: 2 }}>Remaining Balance</Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>
                    {formatCurrency(data.rtoMonthlyPayment! * (data.rtoTermMonths! - (data.rtoInstallmentsPaid ?? 0)))}
                  </Text>
                </View>
              </View>
            )}
            {/* Payment Schedule Table */}
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Payment Schedule
            </Text>
            <View>
              <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 3, marginBottom: 2 }}>
                <Text style={{ width: 30, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280' }}>#</Text>
                <Text style={{ flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280' }}>Due Date</Text>
                <Text style={{ width: 80, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textAlign: 'right' }}>Payment</Text>
                <Text style={{ width: 80, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textAlign: 'right' }}>Remaining</Text>
              </View>
              {Array.from({ length: data.rtoTermMonths! }, (_, i) => {
                const startDate = data.rtoStartDate ? new Date(data.rtoStartDate) : new Date(data.startDate)
                const dueDate = new Date(startDate)
                dueDate.setMonth(dueDate.getMonth() + i)
                const remaining = data.rtoMonthlyPayment! * (data.rtoTermMonths! - i - 1)
                const isPaid = i < (data.rtoInstallmentsPaid ?? 0)
                return (
                  <View key={i} style={{ flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#f3f4f6' }}>
                    <Text style={{ width: 30, fontSize: 8, color: isPaid ? '#16a34a' : '#374151' }}>{i + 1}</Text>
                    <Text style={{ flex: 1, fontSize: 8, color: isPaid ? '#16a34a' : '#374151' }}>
                      {dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      {isPaid ? ' (Paid)' : ''}
                    </Text>
                    <Text style={{ width: 80, fontSize: 8, color: isPaid ? '#16a34a' : '#374151', textAlign: 'right' }}>
                      {formatCurrency(data.rtoMonthlyPayment!)}
                    </Text>
                    <Text style={{ width: 80, fontSize: 8, color: '#6b7280', textAlign: 'right' }}>
                      {formatCurrency(remaining)}
                    </Text>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* Delivery & Return — keep together */}
        {hasDeliveryInfo && (
          <View style={{ marginBottom: 16 }} wrap={false}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>
              Delivery & Return
            </Text>
            <View style={{ flexDirection: 'row', gap: 20 }}>
              {data.deliveryMethod && (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Delivery</Text>
                  <Text style={{ fontSize: 9 }}>Method: {data.deliveryMethod}</Text>
                  {data.deliveryAddress && (
                    <Text style={{ fontSize: 9 }}>Address: {data.deliveryAddress}</Text>
                  )}
                  {data.deliveryDate && (
                    <Text style={{ fontSize: 9 }}>Date: {data.deliveryDate}</Text>
                  )}
                  {data.deliveryCost != null && data.deliveryCost > 0 && (
                    <Text style={{ fontSize: 9 }}>Cost: {formatCurrency(data.deliveryCost)}</Text>
                  )}
                  {data.deliveryTrackingProvider && (
                    <Text style={{ fontSize: 9 }}>Carrier: {data.deliveryTrackingProvider === 'Other' ? 'Other' : data.deliveryTrackingProvider}</Text>
                  )}
                  {data.deliveryTrackingNumber && (
                    <Text style={{ fontSize: 9 }}>Tracking #: {data.deliveryTrackingNumber}</Text>
                  )}
                  {data.deliveryNotes && (
                    <Text style={{ fontSize: 9, color: '#6b7280' }}>{data.deliveryNotes}</Text>
                  )}
                </View>
              )}
              {data.returnMethod && (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Return</Text>
                  <Text style={{ fontSize: 9 }}>Method: {data.returnMethod}</Text>
                  {data.returnDate && (
                    <Text style={{ fontSize: 9 }}>Date: {data.returnDate}</Text>
                  )}
                  {data.returnCost != null && data.returnCost > 0 && (
                    <Text style={{ fontSize: 9 }}>Cost: {formatCurrency(data.returnCost)}</Text>
                  )}
                  {data.returnTrackingProvider && (
                    <Text style={{ fontSize: 9 }}>Carrier: {data.returnTrackingProvider === 'Other' ? 'Other' : data.returnTrackingProvider}</Text>
                  )}
                  {data.returnTrackingNumber && (
                    <Text style={{ fontSize: 9 }}>Tracking #: {data.returnTrackingNumber}</Text>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Notes — keep together, never split */}
        {hasNotes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Footer — fixed on every page */}
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
          <Text style={s.footerText}>{data.number} - Order Detail</Text>
        </View>
      </Page>
    </Document>
  )
}
