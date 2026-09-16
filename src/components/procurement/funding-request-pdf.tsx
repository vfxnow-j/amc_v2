import React from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  FieldSet,
  TextInput,
} from '@react-pdf/renderer'
import { pdfStyles as s } from '@/components/documents/pdf-styles'

/**
 * The equipment funding request as a document — v1's paper form, ported.
 *
 * Unchanged from v1 apart from the styles import and one line: the ROI band is
 * labelled as estimates. Sections 3 and the approval box are fillable fields,
 * named after the columns they map back to, because accounting completes them
 * in a PDF reader and returns the file.
 */
function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export type FundingRequestPdfData = {
  requestNumber: string
  status: string

  // 1. Request & purpose
  requestedBy: string
  requestDate: string | Date
  neededByDate?: string | Date | null
  amountRequested: number
  businessPurpose?: string | null

  // 2. Equipment & customer
  purchaseType?: string | null
  equipmentSummary?: string | null
  items: { description: string; quantity: number; unitCost: number; amount: number }[]
  totalEquipmentCost: number
  customer?: string | null
  customerCommitment?: string | null
  customerRentalRate?: number | null
  billableUnits?: number | null
  customerRentalCharge?: number | null
  expectedInitialRevenue?: number | null
  rentalPeriod?: string | null
  paymentTerms?: string | null

  // 3. Financing terms
  lender?: string | null
  amountBorrowed?: number | null
  /** Percent, e.g. 6.5 */
  interestRatePercent?: number | null
  termMonths?: number | null
  monthlyPayment?: number | null
  financingFees?: number | null
  estimatedTotalInterest?: number | null
  firstPaymentDate?: string | Date | null
  expectedPayoffDate?: string | Date | null

  // 4. Payback & asset plan
  expectedGrossProfit?: number | null
  estimatedPaybackMonths?: number | null
  expectedAnnualUtilization?: number | null
  expectedHoldMonths?: number | null
  expectedAnnualRevenue?: number | null
  estimatedResaleValue?: number | null
  exitPlan?: string | null

  // 5. Key risk / approval rationale
  alternateUsePlan?: string | null
  borrowRationale?: string | null

  // ROI markers
  metrics?: {
    allInCost: number
    financingCost: number
    debtServiceCoverage: number | null
    paybackMonths: number | null
    projectedRevenue: number | null
    projectedNet: number | null
    breakEvenMonths: number | null
    neverBreaksEven: boolean
  } | null

  // Supporting trail
  supportingPOs: { poNumber: string; vendorName: string; status: string; total: number }[]
  supportingQuotes: { reservationNumber: string; clientName: string; status: string; total: number }[]
  lease?: { leaseNumber: string; leaseName: string; lender: string } | null

  // Approval
  operationsApprovedBy?: string | null
  financeApprovedBy?: string | null
  executiveApprovedBy?: string | null
  approvalDate?: string | Date | null

  notes?: string | null
}

const f = StyleSheet.create({
  sectionHeader: {
    backgroundColor: '#eff6ff',
    borderLeftWidth: 3,
    borderLeftColor: '#2563eb',
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  field: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 9.5,
    color: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    paddingBottom: 3,
    minHeight: 13,
  },
  blockValue: {
    fontSize: 9,
    color: '#111827',
    lineHeight: 1.45,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 3,
    padding: 7,
    minHeight: 26,
  },
  section: {
    marginBottom: 12,
  },
  metricsBand: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  metricBox: {
    flex: 1,
    padding: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 3,
  },
  metricLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  metricValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#14532d',
  },
  approvalBox: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 3,
    padding: 10,
    marginTop: 4,
  },
  ruleText: {
    fontSize: 7.5,
    color: '#6b7280',
    lineHeight: 1.4,
  },
  // Accounting fills these in their PDF reader, so they read as input boxes
  // rather than as the underlined static values around them.
  fillableInput: {
    height: 15,
    fontSize: 9.5,
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 2,
    backgroundColor: '#eff6ff',
  },
  fillableNote: {
    fontSize: 6.5,
    color: '#2563eb',
    marginBottom: 6,
  },
})

/**
 * Values destined for a fillable box are written plainly — no currency symbol,
 * no thousands separators, dates as MM/DD/YYYY — so whatever comes back can be
 * parsed without unpicking display formatting.
 */
function amount(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toFixed(2)
}

function inputDate(v: string | Date | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={f.field}>
      <Text style={f.fieldLabel}>{label}</Text>
      <Text style={f.fieldValue}>{value}</Text>
    </View>
  )
}

/**
 * A field accounting completes in their PDF reader. `name` is the Prisma column
 * it maps back to, namespaced by the enclosing FieldSet (e.g. `financing.lender`),
 * so a returned PDF can be read straight back into the record.
 *
 * `value` is what the viewer shows; the same figure goes to `defaultValue` so a
 * reader's "reset form" restores what the system had rather than blanking it.
 */
function FillableField({
  label,
  name,
  value,
}: {
  label: string
  name: string
  value?: string | number | null
}) {
  const filled = value === null || value === undefined ? '' : String(value)
  return (
    <View style={f.field}>
      <Text style={f.fieldLabel}>{label}</Text>
      <TextInput
        name={name}
        value={filled}
        defaultValue={filled}
        fontSize={9}
        style={f.fillableInput}
      />
    </View>
  )
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={f.fieldLabel}>{label}</Text>
      <Text style={f.blockValue}>{value}</Text>
    </View>
  )
}

function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <View style={f.sectionHeader}>
      <Text style={f.sectionHeaderText}>
        {n}   {title}
      </Text>
    </View>
  )
}

type Props = {
  data: FundingRequestPdfData
  logoDataUri?: string
}

export function FundingRequestPDF({ data, logoDataUri }: Props) {
  const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—')
  const m = data.metrics

  return (
    <Document>
      <Page size="LETTER" style={[s.page, { paddingBottom: 56 }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoDataUri ? (
              <Image src={logoDataUri} style={s.logo} />
            ) : (
              <Text style={s.documentTitle}>VFXNOW</Text>
            )}
          </View>
          <View style={s.headerRight}>
            <Text style={s.documentTitle}>Equipment Funding Request</Text>
            <Text style={s.documentNumber}>{data.requestNumber}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Status: {data.status}
            </Text>
          </View>
        </View>

        <Text style={{ fontSize: 8.5, color: '#6b7280', marginBottom: 12 }}>
          Complete before committing to financing, drawing on a line of credit, or purchasing
          financed rental equipment.
        </Text>

        {/* 1. Request & Purpose */}
        <View style={f.section}>
          <SectionHeader n={1} title="Request & Purpose" />
          <View style={f.fieldRow}>
            <Field label="Purchase Type" value={dash(data.purchaseType)} />
            <Field label="Requested By" value={dash(data.requestedBy)} />
            <Field label="Request Date" value={formatDate(data.requestDate)} />
            <Field label="Funding Needed By" value={formatDate(data.neededByDate)} />
            <Field label="Amount Requested" value={formatCurrency(data.amountRequested)} />
          </View>
          <Block
            label="Business Purpose / Why Funds Are Needed"
            value={dash(data.businessPurpose)}
          />
        </View>

        {/* 2. Equipment & Customer */}
        <View style={f.section}>
          <SectionHeader n={2} title="Equipment & Customer" />

          {data.items.length > 0 ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={f.fieldLabel}>Equipment Being Purchased</Text>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderCell, { width: '52%' }]}>Item</Text>
                <Text style={[s.tableHeaderCell, { width: '12%', textAlign: 'center' }]}>Qty</Text>
                <Text style={[s.tableHeaderCell, { width: '18%', textAlign: 'right' }]}>
                  Unit Cost
                </Text>
                <Text style={[s.tableHeaderCell, { width: '18%', textAlign: 'right' }]}>Amount</Text>
              </View>
              {data.items.map((item, i) => (
                <View key={i} style={i % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                  <Text style={[s.tableCell, { width: '52%' }]}>{item.description}</Text>
                  <Text style={[s.tableCell, { width: '12%', textAlign: 'center' }]}>
                    {item.quantity}
                  </Text>
                  <Text style={[s.tableCell, { width: '18%', textAlign: 'right' }]}>
                    {formatCurrency(item.unitCost)}
                  </Text>
                  <Text style={[s.tableCellBold, { width: '18%', textAlign: 'right' }]}>
                    {formatCurrency(item.amount)}
                  </Text>
                </View>
              ))}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 9, color: '#6b7280' }}>Total Equipment Cost</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#2563eb' }}>
                  {formatCurrency(data.totalEquipmentCost)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={f.fieldRow}>
              <View style={{ flex: 2 }}>
                <Text style={f.fieldLabel}>Equipment Being Purchased (Item / Qty / Cost)</Text>
                <Text style={f.blockValue}>{dash(data.equipmentSummary)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Total Equipment Cost"
                  value={formatCurrency(data.totalEquipmentCost)}
                />
              </View>
            </View>
          )}

          {data.items.length > 0 && data.equipmentSummary ? (
            <Block label="Equipment Notes" value={data.equipmentSummary} />
          ) : null}

          <View style={f.fieldRow}>
            <Field label="Customer / Project" value={dash(data.customer)} />
            <Field label="Customer Commitment" value={dash(data.customerCommitment)} />
          </View>
          <View style={f.fieldRow}>
            <Field
              label="Customer Rental Charge"
              value={
                data.customerRentalCharge
                  ? `${formatCurrency(data.customerRentalCharge)}/mo${
                      data.customerRentalRate && data.billableUnits
                        ? ` (${data.billableUnits} × ${formatCurrency(data.customerRentalRate)})`
                        : ''
                    }`
                  : '—'
              }
            />
            <Field
              label="Expected Initial Revenue"
              value={
                data.expectedInitialRevenue ? formatCurrency(data.expectedInitialRevenue) : '—'
              }
            />
            <Field label="Rental Period / Timeframe" value={dash(data.rentalPeriod)} />
            <Field label="Payment Terms" value={dash(data.paymentTerms)} />
          </View>
        </View>

        {/* 3. Financing Terms — accounting completes this in their reader. */}
        <View style={f.section} wrap={false}>
          <SectionHeader n={3} title="Financing Terms" />
          <Text style={f.fillableNote}>
            Blue fields are fillable — complete them in your PDF reader, save, and return the file.
            Amounts in dollars, no symbols; dates as MM/DD/YYYY.
          </Text>
          <FieldSet name="financing">
            <View style={f.fieldRow}>
              <FillableField label="Lender / Source" name="lender" value={data.lender} />
              <FillableField
                label="Amount Borrowed ($)"
                name="amountBorrowed"
                value={amount(data.amountBorrowed)}
              />
              <FillableField
                label="Interest Rate (%)"
                name="interestRate"
                value={
                  data.interestRatePercent !== null && data.interestRatePercent !== undefined
                    ? data.interestRatePercent.toFixed(2)
                    : null
                }
              />
              <FillableField label="Term (Months)" name="termMonths" value={data.termMonths} />
              <FillableField
                label="Monthly Payment ($)"
                name="monthlyPayment"
                value={amount(data.monthlyPayment)}
              />
            </View>
            <View style={f.fieldRow}>
              <FillableField
                label="Origination / Other Fees ($)"
                name="financingFees"
                value={amount(data.financingFees)}
              />
              <FillableField
                label="Estimated Total Interest ($)"
                name="estimatedTotalInterest"
                value={amount(data.estimatedTotalInterest)}
              />
              <FillableField
                label="First Payment Date"
                name="firstPaymentDate"
                value={inputDate(data.firstPaymentDate)}
              />
              <FillableField
                label="Expected Payoff Date"
                name="expectedPayoffDate"
                value={inputDate(data.expectedPayoffDate)}
              />
            </View>
          </FieldSet>
        </View>

        {/* 4. Payback & Asset Plan */}
        <View style={f.section} wrap={false}>
          <SectionHeader n={4} title="Payback & Asset Plan" />
          <View style={f.fieldRow}>
            <Field
              label="Expected Gross Profit - Initial Rental"
              value={data.expectedGrossProfit ? formatCurrency(data.expectedGrossProfit) : '—'}
            />
            <Field
              label="Estimated Payback (Months)"
              value={data.estimatedPaybackMonths ? String(data.estimatedPaybackMonths) : '—'}
            />
            <Field
              label="Expected Annual Utilization"
              value={
                data.expectedAnnualUtilization !== null &&
                data.expectedAnnualUtilization !== undefined
                  ? `${data.expectedAnnualUtilization}%`
                  : '—'
              }
            />
            <Field
              label="Expected Hold Period"
              value={data.expectedHoldMonths ? `${data.expectedHoldMonths} months` : '—'}
            />
          </View>
          <View style={f.fieldRow}>
            <Field
              label="Expected Ongoing Annual Rental Revenue"
              value={data.expectedAnnualRevenue ? formatCurrency(data.expectedAnnualRevenue) : '—'}
            />
            <Field
              label="Estimated Resale Value"
              value={data.estimatedResaleValue ? formatCurrency(data.estimatedResaleValue) : '—'}
            />
            <Field label="Exit Plan" value={dash(data.exitPlan)} />
          </View>
        </View>

        {/* ROI markers. Arithmetic over the requester's own figures, and the
            page says so: a printed "14 mo payback" is otherwise read as a result. */}
        {m && (
          <Text style={[f.ruleText, { marginBottom: 4 }]}>
            Estimates computed from the figures on this request — not measured returns.
          </Text>
        )}
        {m && (
          <View style={f.metricsBand} wrap={false}>
            <View style={f.metricBox}>
              <Text style={f.metricLabel}>All-In Cost</Text>
              <Text style={f.metricValue}>{formatCurrency(m.allInCost)}</Text>
              <Text style={{ fontSize: 7, color: '#166534', marginTop: 2 }}>
                incl. {formatCurrency(m.financingCost)} financing
              </Text>
            </View>
            <View style={f.metricBox}>
              <Text style={f.metricLabel}>Payback</Text>
              <Text style={f.metricValue}>
                {m.paybackMonths !== null ? `${m.paybackMonths} mo` : '—'}
              </Text>
              <Text style={{ fontSize: 7, color: '#166534', marginTop: 2 }}>rentals only</Text>
            </View>
            <View style={f.metricBox}>
              <Text style={f.metricLabel}>Rental vs. Payment</Text>
              <Text style={f.metricValue}>
                {m.debtServiceCoverage !== null ? `${m.debtServiceCoverage.toFixed(2)}x` : '—'}
              </Text>
            </View>
            <View style={f.metricBox}>
              <Text style={f.metricLabel}>Break-Even</Text>
              <Text style={f.metricValue}>
                {m.breakEvenMonths !== null
                  ? `${m.breakEvenMonths} mo`
                  : m.neverBreaksEven
                    ? 'never'
                    : '—'}
              </Text>
              <Text style={{ fontSize: 7, color: '#166534', marginTop: 2 }}>
                {m.neverBreaksEven
                  ? 'rentals + resale short of cost'
                  : `incl. resale · net ${m.projectedNet !== null ? formatCurrency(m.projectedNet) : '—'}`}
              </Text>
            </View>
          </View>
        )}

        {/* 5. Key Risk / Approval Rationale */}
        <View style={f.section} wrap={false}>
          <SectionHeader n={5} title="Key Risk / Approval Rationale" />
          <Block
            label="If the initial customer cancels, what is the alternate use / customer for this equipment?"
            value={dash(data.alternateUsePlan)}
          />
          <Block
            label="Why buy with borrowed funds instead of renting / leasing / using existing inventory?"
            value={dash(data.borrowRationale)}
          />
        </View>

        {/* Supporting documents */}
        {(data.supportingPOs.length > 0 ||
          data.supportingQuotes.length > 0 ||
          data.lease) && (
          <View style={f.section} wrap={false}>
            <SectionHeader n={6} title="Supporting Documents" />
            {data.supportingPOs.length > 0 && (
              <View style={{ marginBottom: 6 }}>
                <Text style={f.fieldLabel}>Purchase Orders</Text>
                {data.supportingPOs.map((po) => (
                  <Text key={po.poNumber} style={{ fontSize: 9, lineHeight: 1.5 }}>
                    {po.poNumber} — {po.vendorName} · {po.status} · {formatCurrency(po.total)}
                  </Text>
                ))}
              </View>
            )}
            {data.supportingQuotes.length > 0 && (
              <View style={{ marginBottom: 6 }}>
                <Text style={f.fieldLabel}>Client Quotes / Orders</Text>
                {data.supportingQuotes.map((q) => (
                  <Text key={q.reservationNumber} style={{ fontSize: 9, lineHeight: 1.5 }}>
                    {q.reservationNumber} — {q.clientName} · {q.status} · {formatCurrency(q.total)}
                  </Text>
                ))}
              </View>
            )}
            {data.lease && (
              <View>
                <Text style={f.fieldLabel}>Funded By</Text>
                <Text style={{ fontSize: 9, lineHeight: 1.5 }}>
                  {data.lease.leaseNumber} — {data.lease.leaseName} · {data.lease.lender}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Notes */}
        {data.notes ? (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        ) : null}

        {/* Approval — signed off in the reader, same as section 3. */}
        <View style={f.approvalBox} wrap={false}>
          <Text style={[f.fieldLabel, { fontSize: 8, marginBottom: 2 }]}>Approval</Text>
          <Text style={f.fillableNote}>Fillable — type each approver&apos;s name and the date.</Text>
          <FieldSet name="approval">
            <View style={f.fieldRow}>
              <FillableField
                label="Operations"
                name="operationsApprovedBy"
                value={data.operationsApprovedBy}
              />
              <FillableField
                label="Finance"
                name="financeApprovedBy"
                value={data.financeApprovedBy}
              />
              <FillableField
                label="Executive"
                name="executiveApprovedBy"
                value={data.executiveApprovedBy}
              />
              <FillableField
                label="Approval Date"
                name="approvalDate"
                value={inputDate(data.approvalDate)}
              />
            </View>
          </FieldSet>
        </View>

        <Text style={[f.ruleText, { marginTop: 10 }]}>
          Finance tracking rule: tie the Funding ID to the loan/LOC draw, vendor invoices, fixed
          assets, and supporting customer/project.
        </Text>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            VFXNow Equipment Funding Request · {data.requestNumber}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
