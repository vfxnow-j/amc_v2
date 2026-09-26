import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'
import { FlowTermsPdfSection, type FlowAutopayLine } from './flow-terms-pdf-section'
import type { FlowClientQuote } from '@/lib/pricing/flow-client-quote'
import type { RenderedFlowTerms } from '@/lib/pricing/flow-terms'

/**
 * What the Flow quote prints. Its own shape rather than OrderDetailData, which
 * carries cost basis and margin fields: this document goes to the client, so it
 * has no field that could hold either.
 */
export type FlowQuotePdfData = {
  number: string
  contactName: string
  contactCompany?: string
  contactEmail?: string
  contactPhone?: string
  contactAddress?: string
  startDate: string
  projectName?: string
  quoteExpiresAt?: string
  notes?: string
  /** The gear, names and quantities only — never a line price. */
  gear: { description: string; spec?: string; quantity: number; isComponent?: boolean }[]
}

type Props = {
  data: FlowQuotePdfData
  flow: FlowClientQuote
  logoDataUri?: string
  /** Signed copy (approved through the online quote link). */
  signatureDataUrl?: string
  signerName?: string
  signedAt?: string
  /** Rebuilt copy whose drawn signature was lost — the audit trail instead. */
  approvalStamp?: { method: string; signerName: string; signedAt: string }
  /** The Flow subscription terms (the frozen snapshot once approved). */
  terms?: RenderedFlowTerms
  autopay?: FlowAutopayLine
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

const range = (a: number, b: number) => (a === b ? `Month ${a}` : `Months ${a}–${b}`)

/**
 * Flow Subscription quote, ported from v1 (src/components/documents/flow-quote-pdf.tsx).
 * Client-safe by construction: it reads the gear list (names, quantities, specs)
 * and the FlowClientQuote — never line rates or costs.
 */
export function FlowQuotePDF({
  data,
  flow,
  logoDataUri,
  signatureDataUrl,
  signerName,
  signedAt,
  approvalStamp,
  terms,
  autopay,
}: Props) {
  const hasTax = flow.totals.tax > 0

  return (
    <Document>
      <Page size="LETTER" style={[s.page, { paddingBottom: 60 }]}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoDataUri ? <Image src={logoDataUri} style={s.logo} /> : <Text style={s.documentTitle}>VFXnow</Text>}
          </View>
          <View style={s.headerRight}>
            <Text style={s.documentTitle}>Flow Subscription Quote</Text>
            <Text style={s.documentNumber}>{data.number}</Text>
            {data.quoteExpiresAt && (
              <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 4 }}>Valid until {data.quoteExpiresAt}</Text>
            )}
          </View>
        </View>

        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Prepared For</Text>
            <Text style={s.infoBoxTextBold}>{data.contactName}</Text>
            {data.contactCompany && <Text style={s.infoBoxText}>{data.contactCompany}</Text>}
            {data.contactEmail && <Text style={s.infoBoxText}>{data.contactEmail}</Text>}
            {data.contactPhone && <Text style={s.infoBoxText}>{data.contactPhone}</Text>}
            {data.contactAddress && <Text style={s.infoBoxText}>{data.contactAddress}</Text>}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Subscription</Text>
            <Text style={s.infoBoxText}>Term: {flow.termMonths} months</Text>
            <Text style={s.infoBoxText}>Starts: {data.startDate}</Text>
            <Text style={s.infoBoxText}>Billing: Monthly (Flow, {flow.termMonths} months)</Text>
            {data.projectName && <Text style={s.infoBoxText}>Project: {data.projectName}</Text>}
          </View>
        </View>

        <View wrap={false} style={{ marginBottom: 16 }}>
          <Text style={[s.infoBoxTitle, { marginBottom: 6 }]}>Your Monthly Payment</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {flow.tiers.map((t) => (
              <View
                key={t.fromMonth}
                style={{ flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 10, backgroundColor: '#f9fafb' }}
              >
                <Text style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {range(t.fromMonth, t.toMonth)}
                </Text>
                <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: 4 }}>
                  {fmt(t.payment)}
                  <Text style={{ fontSize: 9, color: '#6b7280' }}> /mo</Text>
                </Text>
                {hasTax && <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>+ {fmt(t.tax)} tax</Text>}
              </View>
            ))}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, { width: '85%' }]}>Equipment Included</Text>
            <Text style={[s.tableHeaderCell, { width: '15%', textAlign: 'center' }]}>Qty</Text>
          </View>
          {data.gear.map((item, i) => (
            <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]} wrap={false}>
              <View style={{ width: '85%', paddingLeft: item.isComponent ? 12 : 0 }}>
                <Text style={s.tableCellBold}>
                  {item.isComponent ? '+ ' : ''}
                  {item.description}
                </Text>
                {item.spec && <Text style={[s.tableCell, { fontSize: 8, color: '#4b5563', marginTop: 2 }]}>{item.spec}</Text>}
              </View>
              <Text style={[s.tableCell, { width: '15%', textAlign: 'center' }]}>{item.quantity}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalsSection} wrap={false}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subscription ({flow.termMonths} mo)</Text>
              <Text style={s.totalsValue}>{fmt(flow.totals.contract)}</Text>
            </View>
            {flow.totals.discount > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Discount</Text>
                <Text style={s.totalsValue}>-{fmt(flow.totals.discount)}</Text>
              </View>
            )}
            {hasTax && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Sales tax</Text>
                <Text style={s.totalsValue}>{fmt(flow.totals.tax)}</Text>
              </View>
            )}
            {flow.oneTime.map((o) => (
              <View key={o.label} style={s.totalsRow}>
                <Text style={s.totalsLabel}>{o.label} (one-time, first invoice)</Text>
                <Text style={s.totalsValue}>{fmt(o.amount)}</Text>
              </View>
            ))}
            <View style={s.totalsDivider} />
            <View style={s.totalsRow}>
              <Text style={s.totalGrandLabel}>Total over term</Text>
              <Text style={s.totalGrandValue}>{fmt(flow.totals.total)}</Text>
            </View>
          </View>
        </View>

        {data.notes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        <View style={[s.table, { marginTop: 8 }]} break={flow.rows.length > 18}>
          <Text style={[s.infoBoxTitle, { marginBottom: 6 }]}>Payment Schedule</Text>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, { width: '16%' }]}>Month</Text>
            <Text style={[s.tableHeaderCell, { width: '21%', textAlign: 'right' }]}>Payment</Text>
            <Text style={[s.tableHeaderCell, { width: '21%', textAlign: 'right' }]}>{hasTax ? 'Tax' : ''}</Text>
            <Text style={[s.tableHeaderCell, { width: '21%', textAlign: 'right' }]}>Total</Text>
            <Text style={[s.tableHeaderCell, { width: '21%', textAlign: 'right' }]}>Remaining</Text>
          </View>
          {flow.rows.map((r, i) => {
            const step = i > 0 && flow.tiers.some((t) => t.fromMonth === r.month)
            return (
              <View
                key={r.month}
                style={[
                  s.tableRow,
                  i % 2 === 1 ? s.tableRowAlt : {},
                  step ? { borderTopWidth: 1, borderTopColor: '#2563eb' } : {},
                  { paddingVertical: 3 },
                ]}
                wrap={false}
              >
                <Text style={[s.tableCell, { width: '16%' }]}>
                  {r.month}
                  {step ? '  (new rate)' : ''}
                </Text>
                <Text style={[s.tableCell, { width: '21%', textAlign: 'right' }]}>{fmt(r.payment)}</Text>
                <Text style={[s.tableCell, { width: '21%', textAlign: 'right' }]}>{hasTax ? fmt(r.tax) : ''}</Text>
                <Text style={[s.tableCellBold, { width: '21%', textAlign: 'right' }]}>{fmt(r.total)}</Text>
                <Text style={[s.tableCell, { width: '21%', textAlign: 'right', color: '#6b7280' }]}>{fmt(r.remaining)}</Text>
              </View>
            )
          })}
          <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 6 }}>
            Equipment remains the property of VFXNow and is returned at the end of the term.
          </Text>
        </View>

        <View style={s.signatureSection} wrap={false}>
          <Text style={s.signatureTitle}>Approved by:</Text>
          {signatureDataUrl ? (
            <View>
              <Image src={signatureDataUrl} style={s.signatureImage} />
              <Text style={s.signedByText}>{signerName}</Text>
              <Text style={s.signedAtText}>Signed: {signedAt}</Text>
            </View>
          ) : approvalStamp ? (
            <View>
              <Text style={s.signedByText}>{approvalStamp.signerName}</Text>
              <Text style={s.signedAtText}>
                {approvalStamp.method} · {approvalStamp.signedAt}
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

        <View style={{ paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#d1d5db', marginTop: 12 }} wrap={false}>
          <Text style={{ fontSize: 6, color: '#9ca3af', lineHeight: 1.3 }}>
            All amounts are in USD. Signing this quote accepts the Flow Subscription Terms below and the VFXnow Rental Terms &
            Conditions they amend.
          </Text>
        </View>
        {terms && <FlowTermsPdfSection terms={terms} autopay={autopay} />}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </Text>
          <Text style={s.footerText}>{data.number} - Flow Subscription Quote</Text>
        </View>
      </Page>
    </Document>
  )
}
