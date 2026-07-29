import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { groupRowsWithBreakdown } from '@/lib/utils/item-rows'

// Proposal page types
export type ProposalPageType = 'cover' | 'scope' | 'concept' | 'upload' | 'quote' | 'review'

export type ProposalCoverData = {
  type: 'cover'
  clientLogo?: string // base64 data URI
  projectTitle: string
  clientName: string
  companyName?: string
  date: string
  projectDates?: string
  tagline?: string
}

export type ProposalScopeData = {
  type: 'scope'
  title: string
  content: string
}

export type ConceptSection = {
  title: string
  description: string
  imageDataUri?: string
}

export type ProposalConceptData = {
  type: 'concept'
  title: string
  sections: ConceptSection[]
}

export type ProposalUploadData = {
  type: 'upload'
  label: string
  imageDataUri: string // full-page image
}

export type QuoteItem = {
  description: string
  quantity: number
  pricingType: string
  rate: number
  amount: number
  category: string
  isComponent?: boolean
  configuredTotal?: number
}

export type ProposalQuoteData = {
  type: 'quote'
  title: string
  items: QuoteItem[]
  subtotal: number
  discountLabel?: string
  discountAmount?: number
  taxRate?: number
  taxAmount: number
  total: number
  notes?: string
}

export type ProposalReviewData = {
  type: 'review'
  title: string
  terms: string
  validityPeriod?: string
}

export type ProposalPageData =
  | ProposalCoverData
  | ProposalScopeData
  | ProposalConceptData
  | ProposalUploadData
  | ProposalQuoteData
  | ProposalReviewData

export type ProposalData = {
  pages: ProposalPageData[]
  companyLogo?: string // company logo data URI
  accentColor?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

const s = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  // Cover page
  coverPage: {
    padding: 0,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
  },
  coverTopBar: {
    height: 8,
    backgroundColor: '#2563eb',
  },
  coverContent: {
    flex: 1,
    padding: 60,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  coverLogos: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 60,
  },
  coverLogo: {
    width: 100,
    height: 70,
    objectFit: 'contain',
  },
  coverClientLogo: {
    width: 120,
    height: 80,
    objectFit: 'contain',
  },
  coverTitle: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 12,
    lineHeight: 1.2,
  },
  coverTagline: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 40,
    lineHeight: 1.5,
  },
  coverMeta: {
    borderTopWidth: 2,
    borderTopColor: '#2563eb',
    paddingTop: 20,
  },
  coverMetaText: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  coverMetaBold: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  // Scope page
  scopeTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingBottom: 10,
  },
  scopeContent: {
    fontSize: 11,
    lineHeight: 1.7,
    color: '#334155',
  },
  // Concept page
  conceptTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingBottom: 10,
  },
  conceptSection: {
    marginBottom: 20,
  },
  conceptSectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  conceptSectionDesc: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#475569',
    marginBottom: 8,
  },
  conceptImage: {
    maxWidth: '100%',
    maxHeight: 320,
    objectFit: 'contain',
    marginBottom: 8,
  },
  // Upload page
  uploadImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  // Quote page
  quoteTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
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
  colDesc: { width: '40%' },
  colQty: { width: '10%', textAlign: 'center' },
  colType: { width: '12%', textAlign: 'center' },
  colRate: { width: '18%', textAlign: 'right' },
  colAmount: { width: '20%', textAlign: 'right' },
  categoryRow: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  categoryText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  totalsSection: {
    alignItems: 'flex-end',
    marginTop: 16,
  },
  totalsBox: {
    width: 220,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 9,
    color: '#6b7280',
  },
  totalsValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  totalsDivider: {
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    marginVertical: 4,
  },
  totalGrandLabel: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  totalGrandValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#2563eb',
  },
  quoteNotes: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fffbeb',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  quoteNotesTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#92400e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  quoteNotesText: {
    fontSize: 9,
    color: '#78350f',
    lineHeight: 1.4,
  },
  // Review page
  reviewTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 6,
  },
  reviewTerms: {
    fontSize: 7,
    lineHeight: 1.4,
    color: '#6b7280',
    marginBottom: 12,
  },
  reviewValidity: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
    marginBottom: 20,
  },
  signatureSection: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 14,
  },
  signatureTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 24,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    marginBottom: 4,
    height: 30,
  },
  signatureLabel: {
    fontSize: 7,
    color: '#6b7280',
    marginBottom: 12,
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: '#9ca3af',
  },
})

function CoverPage({ data, companyLogo }: { data: ProposalCoverData; companyLogo?: string }) {
  return (
    <Page size="LETTER" style={s.coverPage}>
      <View style={s.coverTopBar} />
      <View style={s.coverContent}>
        <View style={s.coverLogos}>
          {companyLogo ? (
            <Image src={companyLogo} style={s.coverLogo} />
          ) : (
            <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', color: '#2563eb' }}>AMC</Text>
          )}
          {data.clientLogo && (
            <Image src={data.clientLogo} style={s.coverClientLogo} />
          )}
        </View>
        <Text style={s.coverTitle}>{data.projectTitle || 'Project Proposal'}</Text>
        {data.tagline && <Text style={s.coverTagline}>{data.tagline}</Text>}
        <View style={s.coverMeta}>
          <Text style={s.coverMetaText}>Prepared for</Text>
          <Text style={s.coverMetaBold}>{data.clientName}</Text>
          {data.companyName && <Text style={s.coverMetaText}>{data.companyName}</Text>}
          {data.projectDates && <Text style={[s.coverMetaBold, { marginTop: 12 }]}>{data.projectDates}</Text>}
          <Text style={[s.coverMetaText, { marginTop: 10 }]}>{data.date}</Text>
        </View>
      </View>
    </Page>
  )
}

function ScopePage({ data }: { data: ProposalScopeData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.scopeTitle}>{data.title || 'Project Scope'}</Text>
      <Text style={s.scopeContent}>{data.content}</Text>
      <View style={s.footer} fixed>
        <Text style={s.footerText}>Proposal</Text>
        <Text style={s.footerText} render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </Page>
  )
}

function ConceptPage({ data }: { data: ProposalConceptData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.conceptTitle}>{data.title || 'Concept Breakdown'}</Text>
      {data.sections.map((section, i) => (
        <View key={i} style={s.conceptSection}>
          <Text style={s.conceptSectionTitle}>{section.title}</Text>
          <Text style={s.conceptSectionDesc}>{section.description}</Text>
          {section.imageDataUri && (
            <Image src={section.imageDataUri} style={s.conceptImage} />
          )}
        </View>
      ))}
      <View style={s.footer} fixed>
        <Text style={s.footerText}>Proposal</Text>
        <Text style={s.footerText} render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </Page>
  )
}

function UploadPage({ data }: { data: ProposalUploadData }) {
  return (
    <Page size="LETTER" style={{ padding: 20 }}>
      <Image src={data.imageDataUri} style={s.uploadImage} />
    </Page>
  )
}

function QuotePage({ data }: { data: ProposalQuoteData }) {
  // Group items by category
  const groups: { category: string; items: QuoteItem[] }[] = []
  const catMap = new Map<string, QuoteItem[]>()
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
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.quoteTitle}>{data.title || 'Quote'}</Text>
      <View>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, s.colDesc]}>Description</Text>
          <Text style={[s.tableHeaderCell, s.colQty]}>Qty</Text>
          <Text style={[s.tableHeaderCell, s.colType]}>Type</Text>
          <Text style={[s.tableHeaderCell, s.colRate]}>Rate</Text>
          <Text style={[s.tableHeaderCell, s.colAmount]}>Amount</Text>
        </View>
        {groups.map((group) => (
          <View key={group.category}>
            {hasCategories && (
              <View style={s.categoryRow}>
                <Text style={s.categoryText}>{group.category}</Text>
              </View>
            )}
            {groupRowsWithBreakdown(group.items).map(({ item, breakdown }) => {
              const idx = rowIdx++
              const showConfigured = item.configuredTotal != null && item.configuredTotal !== item.amount && breakdown.length === 0
              const alt = idx % 2 !== 0
              return (
                <View
                  key={idx}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: '#e2e8f0',
                    ...(alt ? { backgroundColor: '#f8fafc' } : {}),
                  }}
                >
                  <View style={{ flexDirection: 'row' }}>
                    <Text style={[s.tableCell, s.colDesc]}>
                      {item.isComponent ? `     ↳ ${item.description}` : item.description}
                    </Text>
                    <Text style={[s.tableCell, s.colQty]}>{item.quantity}</Text>
                    <Text style={[s.tableCell, s.colType]}>{item.pricingType}</Text>
                    <Text style={[s.tableCell, s.colRate]}>{formatCurrency(item.rate)}</Text>
                    <Text style={[s.tableCellBold, s.colAmount]}>{formatCurrency(item.amount)}</Text>
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
                      <Text style={[s.tableCell, s.colDesc, { fontSize: 8, color: '#6b7280', fontStyle: 'italic' }]}>
                        Configured total
                      </Text>
                      <Text style={[s.tableCell, s.colQty]}></Text>
                      <Text style={[s.tableCell, s.colType]}></Text>
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
        ))}
      </View>

      <View style={s.totalsSection}>
        <View style={s.totalsBox}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Subtotal</Text>
            <Text style={s.totalsValue}>{formatCurrency(data.subtotal)}</Text>
          </View>
          {data.discountAmount != null && data.discountAmount > 0 && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{data.discountLabel || 'Discount'}</Text>
              <Text style={[s.totalsValue, { color: '#16a34a' }]}>-{formatCurrency(data.discountAmount)}</Text>
            </View>
          )}
          {data.taxAmount > 0 && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Tax{data.taxRate ? ` (${data.taxRate}%)` : ''}</Text>
              <Text style={s.totalsValue}>{formatCurrency(data.taxAmount)}</Text>
            </View>
          )}
          <View style={s.totalsDivider} />
          <View style={s.totalsRow}>
            <Text style={s.totalGrandLabel}>Total</Text>
            <Text style={s.totalGrandValue}>{formatCurrency(data.total)}</Text>
          </View>
        </View>
      </View>

      {data.notes && (
        <View style={s.quoteNotes}>
          <Text style={s.quoteNotesTitle}>Notes</Text>
          <Text style={s.quoteNotesText}>{data.notes}</Text>
        </View>
      )}

      <View style={s.footer} fixed>
        <Text style={s.footerText}>Proposal</Text>
        <Text style={s.footerText} render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </Page>
  )
}

function ReviewPage({ data }: { data: ProposalReviewData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={s.reviewTitle}>{data.title || 'Terms & Acceptance'}</Text>
      <Text style={s.reviewTerms}>{data.terms}</Text>
      {data.validityPeriod && (
        <Text style={s.reviewValidity}>
          This proposal is valid for {data.validityPeriod}.
        </Text>
      )}
      <View style={s.signatureSection}>
        <Text style={s.signatureTitle}>Accepted and agreed to by:</Text>
        <View style={s.signatureLine} />
        <Text style={s.signatureLabel}>Signature</Text>
        <View style={[s.signatureLine, { height: 20 }]} />
        <Text style={s.signatureLabel}>Print Name</Text>
        <View style={[s.signatureLine, { height: 20 }]} />
        <Text style={s.signatureLabel}>Date</Text>
      </View>
      <View style={s.footer} fixed>
        <Text style={s.footerText}>Proposal</Text>
        <Text style={s.footerText} render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </Page>
  )
}

export function ProposalPDF({ data }: { data: ProposalData }) {
  return (
    <Document>
      {data.pages.map((page, i) => {
        switch (page.type) {
          case 'cover':
            return <CoverPage key={i} data={page} companyLogo={data.companyLogo} />
          case 'scope':
            return <ScopePage key={i} data={page} />
          case 'concept':
            return <ConceptPage key={i} data={page} />
          case 'upload':
            return <UploadPage key={i} data={page} />
          case 'quote':
            return <QuotePage key={i} data={page} />
          case 'review':
            return <ReviewPage key={i} data={page} />
          default:
            return null
        }
      })}
    </Document>
  )
}
