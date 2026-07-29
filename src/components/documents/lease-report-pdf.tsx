import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

// ─── Single Lease Report ────────────────────────────────────────────

export type LeaseReportData = {
  leaseName: string
  leaseNumber: string
  status: string
  lender: string
  monthlyPayment: number
  interestRate: number
  totalAmount: number
  payoffAmount: number | null
  termMonths: number
  startDate: string
  endDate: string
  notes?: string | null
  units: {
    assetName: string
    barcode: string
    category: string
    location: string
    revenue: number
  }[]
  revenue?: {
    totalRevenue: number
    totalPaymentsMade: number
    coverageRatio: number
    netPosition: number
    projectedPayoffDate?: string | null
  } | null
  amortization?: {
    month: number
    payment: number
    principal: number
    interest: number
    balance: number
  }[]
}

type SingleProps = {
  data: LeaseReportData
  logoDataUri?: string
}

export function LeaseReportPDF({ data, logoDataUri }: SingleProps) {
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
            <Text style={s.documentTitle}>Lease Report</Text>
            <Text style={s.documentNumber}>{data.leaseNumber}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Status: {data.status}
            </Text>
          </View>
        </View>

        {/* Lease Terms */}
        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Lease Details</Text>
            <Text style={s.infoBoxTextBold}>{data.leaseName}</Text>
            <Text style={s.infoBoxText}>Lender: {data.lender}</Text>
            <Text style={s.infoBoxText}>Term: {data.termMonths} months</Text>
            <Text style={s.infoBoxText}>
              {formatDate(data.startDate)} - {formatDate(data.endDate)}
            </Text>
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Financial</Text>
            <Text style={s.infoBoxText}>Monthly Payment: {formatCurrency(data.monthlyPayment)}</Text>
            <Text style={s.infoBoxText}>Interest Rate: {formatPercent(Number(data.interestRate) * 100)}</Text>
            <Text style={s.infoBoxText}>Total Amount: {formatCurrency(data.totalAmount)}</Text>
            <Text style={s.infoBoxText}>
              Payoff: {data.payoffAmount ? formatCurrency(data.payoffAmount) : '-'}
            </Text>
          </View>
        </View>

        {/* Revenue Analysis */}
        {data.revenue && (
          <View style={{ marginBottom: 16, padding: 12, backgroundColor: '#f0fdf4', borderRadius: 4, borderWidth: 1, borderColor: '#bbf7d0' }} wrap={false}>
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#166534', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8 }}>
              Revenue Analysis
            </Text>
            <View style={{ flexDirection: 'row' as const, gap: 20 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>Total Revenue</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#166534' }}>
                  {formatCurrency(data.revenue.totalRevenue)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>Payments Made</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>
                  {formatCurrency(data.revenue.totalPaymentsMade)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>Coverage Ratio</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: data.revenue.coverageRatio >= 1 ? '#166534' : '#b45309' }}>
                  {data.revenue.coverageRatio === Infinity ? 'N/A' : `${data.revenue.coverageRatio}x`}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>Net Position</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: data.revenue.netPosition >= 0 ? '#166534' : '#dc2626' }}>
                  {formatCurrency(data.revenue.netPosition)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Linked Assets Table */}
        {data.units.length > 0 && (
          <View style={s.table}>
            <View style={s.tableHeader} fixed>
              <Text style={[s.tableHeaderCell, { width: '30%' }]}>Asset</Text>
              <Text style={[s.tableHeaderCell, { width: '15%' }]}>Barcode</Text>
              <Text style={[s.tableHeaderCell, { width: '20%' }]}>Category</Text>
              <Text style={[s.tableHeaderCell, { width: '20%' }]}>Location</Text>
              <Text style={[s.tableHeaderCell, { width: '15%', textAlign: 'right' as const }]}>Revenue</Text>
            </View>
            {data.units.map((unit, index) => (
              <View key={index} style={index % 2 === 0 ? s.tableRow : s.tableRowAlt} wrap={false}>
                <Text style={[s.tableCell, { width: '30%' }]}>{unit.assetName}</Text>
                <Text style={[s.tableCell, { width: '15%', fontFamily: 'Courier' }]}>{unit.barcode}</Text>
                <Text style={[s.tableCell, { width: '20%' }]}>{unit.category}</Text>
                <Text style={[s.tableCell, { width: '20%' }]}>{unit.location}</Text>
                <Text style={[s.tableCellBold, { width: '15%', textAlign: 'right' as const }]}>
                  {formatCurrency(unit.revenue)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Notes */}
        {data.notes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Amortization Schedule */}
        {data.amortization && data.amortization.length > 0 && (
          <View style={s.table} break>
            <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 8, color: '#1e293b' }}>
              Amortization Schedule
            </Text>
            <View style={s.tableHeader} fixed>
              <Text style={[s.tableHeaderCell, { width: '12%' }]}>Month</Text>
              <Text style={[s.tableHeaderCell, { width: '22%', textAlign: 'right' as const }]}>Payment</Text>
              <Text style={[s.tableHeaderCell, { width: '22%', textAlign: 'right' as const }]}>Principal</Text>
              <Text style={[s.tableHeaderCell, { width: '22%', textAlign: 'right' as const }]}>Interest</Text>
              <Text style={[s.tableHeaderCell, { width: '22%', textAlign: 'right' as const }]}>Balance</Text>
            </View>
            {data.amortization.map((entry, index) => (
              <View key={index} style={index % 2 === 0 ? s.tableRow : s.tableRowAlt} wrap={false}>
                <Text style={[s.tableCell, { width: '12%' }]}>{entry.month}</Text>
                <Text style={[s.tableCell, { width: '22%', textAlign: 'right' as const }]}>
                  {formatCurrency(entry.payment)}
                </Text>
                <Text style={[s.tableCell, { width: '22%', textAlign: 'right' as const }]}>
                  {formatCurrency(entry.principal)}
                </Text>
                <Text style={[s.tableCell, { width: '22%', textAlign: 'right' as const, color: '#6b7280' }]}>
                  {formatCurrency(entry.interest)}
                </Text>
                <Text style={[s.tableCellBold, { width: '22%', textAlign: 'right' as const }]}>
                  {formatCurrency(entry.balance)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </Text>
          <Text style={s.footerText}>{data.leaseNumber} - Lease Report</Text>
        </View>
      </Page>
    </Document>
  )
}

// ─── Lease Summary (All Leases) ─────────────────────────────────────

export type LeaseSummaryData = {
  stats: {
    activeCount: number
    paidOffCount: number
    totalMonthlyObligation: number
    totalOutstanding: number
  }
  leases: {
    leaseName: string
    leaseNumber: string
    status: string
    lender: string
    monthlyPayment: number
    totalAmount: number
    payoffAmount: number | null
    startDate: string
    endDate: string
    unitCount: number
    totalRevenue: number
  }[]
}

type SummaryProps = {
  data: LeaseSummaryData
  logoDataUri?: string
}

export function LeaseSummaryPDF({ data, logoDataUri }: SummaryProps) {
  const totalMonthly = data.leases.reduce((sum, l) => sum + Number(l.monthlyPayment), 0)
  const totalRevenue = data.leases.reduce((sum, l) => sum + l.totalRevenue, 0)

  return (
    <Document>
      <Page size="LETTER" style={[s.page, { paddingBottom: 60 }]} orientation="landscape">
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
            <Text style={s.documentTitle}>Lease Summary</Text>
            <Text style={s.documentNumber}>{data.leases.length} lease{data.leases.length !== 1 ? 's' : ''}</Text>
          </View>
        </View>

        {/* Summary Stats */}
        <View style={{ flexDirection: 'row' as const, gap: 12, marginBottom: 16 }} wrap={false}>
          {[
            { label: 'Active Leases', value: String(data.stats.activeCount) },
            { label: 'Monthly Obligation', value: formatCurrency(data.stats.totalMonthlyObligation) },
            { label: 'Outstanding Balance', value: formatCurrency(data.stats.totalOutstanding) },
            { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
          ].map((stat, i) => (
            <View key={i} style={{ flex: 1, padding: 10, backgroundColor: '#f8fafc', borderRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 7, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 2 }}>
                {stat.label}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold' }}>{stat.value}</Text>
            </View>
          ))}
        </View>

        {/* Leases Table */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.tableHeaderCell, { width: '18%' }]}>Lease Name</Text>
            <Text style={[s.tableHeaderCell, { width: '9%' }]}>Number</Text>
            <Text style={[s.tableHeaderCell, { width: '8%' }]}>Status</Text>
            <Text style={[s.tableHeaderCell, { width: '13%' }]}>Lender</Text>
            <Text style={[s.tableHeaderCell, { width: '10%', textAlign: 'right' as const }]}>Monthly</Text>
            <Text style={[s.tableHeaderCell, { width: '10%', textAlign: 'right' as const }]}>Total</Text>
            <Text style={[s.tableHeaderCell, { width: '10%', textAlign: 'right' as const }]}>Payoff</Text>
            <Text style={[s.tableHeaderCell, { width: '7%', textAlign: 'center' as const }]}>Units</Text>
            <Text style={[s.tableHeaderCell, { width: '10%', textAlign: 'right' as const }]}>Revenue</Text>
          </View>
          {data.leases.map((lease, index) => (
            <View key={index} style={index % 2 === 0 ? s.tableRow : s.tableRowAlt} wrap={false}>
              <Text style={[s.tableCellBold, { width: '18%' }]}>{lease.leaseName}</Text>
              <Text style={[s.tableCell, { width: '9%', fontFamily: 'Courier', fontSize: 8 }]}>{lease.leaseNumber}</Text>
              <Text style={[s.tableCell, { width: '8%' }]}>{lease.status}</Text>
              <Text style={[s.tableCell, { width: '13%' }]}>{lease.lender}</Text>
              <Text style={[s.tableCell, { width: '10%', textAlign: 'right' as const }]}>
                {formatCurrency(Number(lease.monthlyPayment))}
              </Text>
              <Text style={[s.tableCell, { width: '10%', textAlign: 'right' as const }]}>
                {formatCurrency(Number(lease.totalAmount))}
              </Text>
              <Text style={[s.tableCell, { width: '10%', textAlign: 'right' as const }]}>
                {lease.payoffAmount ? formatCurrency(Number(lease.payoffAmount)) : '-'}
              </Text>
              <Text style={[s.tableCell, { width: '7%', textAlign: 'center' as const }]}>{lease.unitCount}</Text>
              <Text style={[s.tableCellBold, { width: '10%', textAlign: 'right' as const }]}>
                {formatCurrency(lease.totalRevenue)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={s.totalsSection} wrap={false}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Total Monthly Payments</Text>
              <Text style={s.totalsValue}>{formatCurrency(totalMonthly)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Total Revenue</Text>
              <Text style={s.totalsValue}>{formatCurrency(totalRevenue)}</Text>
            </View>
            <View style={s.totalsDivider} />
            <View style={s.totalsRow}>
              <Text style={s.totalGrandLabel}>Net</Text>
              <Text style={[s.totalGrandValue, { color: totalRevenue - totalMonthly >= 0 ? '#166534' : '#dc2626' }]}>
                {formatCurrency(totalRevenue - totalMonthly)}
              </Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </Text>
          <Text style={s.footerText}>Lease Summary Report</Text>
        </View>
      </Page>
    </Document>
  )
}
