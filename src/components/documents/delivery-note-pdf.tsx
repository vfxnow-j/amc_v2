import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'
import type { OrderDetailData } from './order-detail-pdf'
import { groupRowsWithBreakdown } from '@/lib/utils/item-rows'

type Props = {
  data: OrderDetailData
  logoDataUri?: string
  signatureDataUrl?: string
  signerName?: string
  signedAt?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function DeliveryNotePDF({
  data,
  logoDataUri,
  signatureDataUrl,
  signerName,
  signedAt,
}: Props) {
  const isSigned = !!signatureDataUrl
  const hasDeliveryInfo = !!(data.deliveryMethod || data.returnMethod)
  const hasNotes = !!data.notes

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
            <Text style={s.documentTitle}>Delivery Note</Text>
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
            <Text style={s.infoBoxTitle}>Delivery Details</Text>
            <Text style={s.infoBoxText}>
              {data.dateLabel}: {data.startDate}
            </Text>
            {data.endDate && (
              <Text style={s.infoBoxText}>End Date: {data.endDate}</Text>
            )}
            {data.projectName && (
              <Text style={s.infoBoxText}>Project: {data.projectName}</Text>
            )}
            {data.projectCode && (
              <Text style={s.infoBoxText}>Code: {data.projectCode}</Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, s.colDescription]}>Description</Text>
            <Text style={[s.tableHeaderCell, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeaderCell, s.colPricing]}>Type</Text>
            <Text style={[s.tableHeaderCell, s.colRate]}>Rate</Text>
            <Text style={[s.tableHeaderCell, s.colAmount]}>Amount</Text>
          </View>
          {(() => {
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
                        <View style={[s.tableCell, s.colDescription]}>
                          <Text>{item.description}</Text>
                          {item.assetNumbers && item.assetNumbers.length > 0 && (
                            <Text style={{ fontSize: 7, color: '#6b7280', marginTop: 1 }}>
                              Asset #: {item.assetNumbers.join(', ')}
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
                    </View>
                  )
                })}
              </View>
            ))
          })()}
        </View>

        {/* Totals — keep together */}
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
                  {(data as any).deliveryTrackingProvider && (
                    <Text style={{ fontSize: 9 }}>Carrier: {(data as any).deliveryTrackingProvider}</Text>
                  )}
                  {(data as any).deliveryTrackingNumber && (
                    <Text style={{ fontSize: 9 }}>Tracking #: {(data as any).deliveryTrackingNumber}</Text>
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
                  {(data as any).returnTrackingProvider && (
                    <Text style={{ fontSize: 9 }}>Carrier: {(data as any).returnTrackingProvider}</Text>
                  )}
                  {(data as any).returnTrackingNumber && (
                    <Text style={{ fontSize: 9 }}>Tracking #: {(data as any).returnTrackingNumber}</Text>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Notes — keep together */}
        {hasNotes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Signature Section — keep together */}
        <View style={s.signatureSection} wrap={false}>
          <Text style={s.signatureTitle}>Received in good condition by:</Text>
          {isSigned ? (
            <View>
              <Image src={signatureDataUrl!} style={s.signatureImage} />
              <Text style={s.signedByText}>{signerName}</Text>
              <Text style={s.signedAtText}>
                Signed: {signedAt}
              </Text>
            </View>
          ) : (
            <View>
              <View style={s.signatureLine} />
              <Text style={s.signatureLabel}>Signature</Text>
              <View style={[s.signatureLine, { height: 20 }]} />
              <Text style={s.signatureLabel}>Print Name</Text>
              <View style={[s.signatureLine, { height: 20 }]} />
              <Text style={s.signatureLabel}>Date</Text>
            </View>
          )}
        </View>

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
          <Text style={s.footerText}>{data.number} - Delivery Note</Text>
        </View>
      </Page>
    </Document>
  )
}
