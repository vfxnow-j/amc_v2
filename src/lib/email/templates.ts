import { formatPeriodCount, isSinglePeriod } from '@/lib/pricing/periods'
import { moneyExact } from '@/lib/format'
import {
  bullets,
  callout,
  cell,
  code,
  email,
  escapeHtml,
  facts,
  fallbackLink,
  greeting,
  link,
  paragraph,
  quoted,
  section,
  stats,
  strong,
  table,
  type Fact,
  type RenderedEmail,
  type Tone,
} from './layout'

/**
 * Every outbound message, drawn in the one layout in `./layout`.
 *
 * Each template returns `{ subject, html, text }`. Subjects are plain strings —
 * they used to be run through `escapeHtml`, which put a literal "&amp;" into
 * the subject line of any account with an ampersand in its name. Only the
 * HTML body is escaped.
 *
 * Two audiences, and the frame says which: **staff** mail links into the app
 * and says where to change what arrives; **client** mail never links into the
 * app (a client has no account) and invites a reply instead.
 */

export { escapeHtml }
export type { RenderedEmail }

const money = (value: number) => moneyExact(value)

/** Security mail is not a notification anyone can switch off; say why it came. */
const SECURITY_FOOTER =
  'A security message from VFXNow AMC about your account. You can&rsquo;t turn these off — if you didn&rsquo;t expect it, tell an administrator.'

// ============================================
// SECURITY EMAILS
// ============================================

export function mfaOtpEmail(name: string, otp: string) {
  return email(`${otp} is your VFXNow verification code`, {
    audience: 'staff',
    preheader: `Your verification code is ${otp}. It expires in 10 minutes.`,
    eyebrow: 'Sign-in',
    title: 'Your verification code',
    body: [
      greeting(name),
      paragraph('Enter this code to finish signing in:'),
      code(otp),
      paragraph('It expires in 10 minutes. If you did not try to sign in, ignore this email and consider changing your password.', { muted: true, small: true }),
    ].join(''),
    footer: SECURITY_FOOTER,
  })
}

export function passwordResetEmail(name: string, resetToken: string) {
  const url = `/reset-password?token=${encodeURIComponent(resetToken)}`
  return email('Reset your VFXNow password', {
    audience: 'staff',
    preheader: 'Someone asked to reset your password. The link works for one hour.',
    eyebrow: 'Account',
    title: 'Reset your password',
    body: [
      greeting(name),
      paragraph('We received a request to reset your password. Use the button below to choose a new one.'),
    ].join(''),
    cta: { label: 'Reset password', url },
    footer: `${paragraph('This link expires in 1 hour. If you did not ask for it, you can ignore this email — your password has not changed.', { muted: true, small: true })}${fallbackLink(url)}${SECURITY_FOOTER}`,
  })
}

export function mfaEnabledEmail(name: string) {
  return email('Two-factor authentication enabled', {
    audience: 'staff',
    preheader: 'Two-factor authentication is now on for your VFXNow account.',
    eyebrow: 'Security',
    title: 'Two-factor authentication is on',
    body: [
      greeting(name),
      paragraph('Two-factor authentication has been enabled on your account. From now on you will be asked for a code, sent to this address, each time you sign in.'),
      callout('If you did not make this change, contact your administrator immediately.', { tone: 'warning' }),
    ].join(''),
    footer: SECURITY_FOOTER,
  })
}

export function mfaDisabledEmail(name: string) {
  return email('Two-factor authentication disabled', {
    audience: 'staff',
    preheader: 'Two-factor authentication was turned off for your VFXNow account.',
    eyebrow: 'Security',
    title: 'Two-factor authentication is off',
    body: [
      greeting(name),
      paragraph('Two-factor authentication has been disabled on your account. It is now protected by your password alone.'),
      callout('If you did not make this change, contact your administrator immediately and change your password.', { tone: 'danger' }),
    ].join(''),
    footer: SECURITY_FOOTER,
  })
}

export function accountInviteEmail(name: string, setupToken: string, roleName: string) {
  const url = `/setup-account?token=${encodeURIComponent(setupToken)}`
  return email("You've been invited to VFXNow AMC", {
    audience: 'staff',
    preheader: `An account has been created for you as ${roleName}. Set your password to get started.`,
    eyebrow: 'Welcome',
    title: 'Welcome to VFXNow AMC',
    body: [
      greeting(name),
      paragraph(`An account has been created for you with the role of ${strong(roleName)}. Set up your password and secure your account to get started.`),
    ].join(''),
    cta: { label: 'Set up your account', url },
    footer: `${paragraph('This link expires in 72 hours. If you weren&rsquo;t expecting an invitation, you can ignore this email.', { muted: true, small: true })}${fallbackLink(url)}`,
  })
}

// ============================================
// CLIENT NOTIFICATION EMAILS
// ============================================

export function invoiceCreatedEmail(clientName: string, invoiceNumber: string, total: string, dueDate: string) {
  return email(`Invoice ${invoiceNumber} from VFXNow`, {
    audience: 'client',
    preheader: `Invoice ${invoiceNumber} for ${total}, due ${dueDate}.`,
    eyebrow: 'Invoice',
    title: `Invoice ${invoiceNumber}`,
    body: [
      greeting(clientName),
      paragraph('A new invoice has been issued on your account.'),
      facts([
        { label: 'Invoice', value: invoiceNumber },
        { label: 'Amount', value: total },
        { label: 'Due', value: dueDate },
      ]),
      paragraph('Reply to this email if you have any questions about it.', { muted: true, small: true }),
    ].join(''),
  })
}

function orderDates(startDate: string, endDate: string, reservationType?: string): Fact[] {
  return reservationType === 'SALE'
    ? [{ label: 'Date', value: startDate }]
    : [
        { label: 'Start', value: startDate },
        { label: 'End', value: endDate },
      ]
}

export function reservationConfirmedEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  return email(`Reservation ${reservationNumber} confirmed`, {
    audience: 'client',
    preheader: `Your equipment is reserved from ${startDate}.`,
    eyebrow: 'Order confirmed',
    title: 'Your reservation is confirmed',
    subtitle: reservationNumber,
    body: [
      greeting(clientName),
      paragraph('Your order is confirmed and the equipment is reserved for you.'),
      facts([{ label: 'Order', value: reservationNumber }, ...orderDates(startDate, endDate, reservationType)]),
      paragraph('Reply to this email if you need to change anything.', { muted: true, small: true }),
    ].join(''),
  })
}

export function orderPreparingEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  const isSale = reservationType === 'SALE'
  return email(`Order ${reservationNumber} — now being prepared`, {
    audience: 'client',
    preheader: `We're preparing order ${reservationNumber}.`,
    eyebrow: 'In preparation',
    title: 'Your order is being prepared',
    subtitle: reservationNumber,
    body: [
      greeting(clientName),
      paragraph(`Our team is preparing your order now. We&rsquo;ll let you know when it&rsquo;s ready${isSale ? '' : ' for delivery'}.`),
      facts([{ label: 'Order', value: reservationNumber }, ...orderDates(startDate, endDate, reservationType)]),
    ].join(''),
  })
}

export function orderShippedEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  const isSale = reservationType === 'SALE'
  const label = isSale ? 'shipped' : 'shipped and ready'
  return email(`Order ${reservationNumber} — ${isSale ? 'Shipped' : 'Shipped / Ready'}`, {
    audience: 'client',
    preheader: `Order ${reservationNumber} has ${label}.`,
    eyebrow: 'On its way',
    title: 'Your order is on its way',
    subtitle: reservationNumber,
    body: [
      greeting(clientName),
      paragraph(`Your order has been ${label}. Every item has been checked out and is on its way.`),
      facts([{ label: 'Order', value: reservationNumber }, ...orderDates(startDate, endDate, reservationType)]),
    ].join(''),
  })
}

export function overdueReminderEmail(clientName: string, invoiceNumber: string, amountDue: string, daysOverdue: number) {
  return email(`Overdue: invoice ${invoiceNumber} — ${daysOverdue} days past due`, {
    audience: 'client',
    preheader: `${amountDue} on invoice ${invoiceNumber} is ${daysOverdue} days past due.`,
    eyebrow: 'Payment reminder',
    title: 'A payment is overdue',
    body: [
      greeting(clientName),
      paragraph(`This is a reminder that the invoice below is ${strong(`${daysOverdue} days past due`)}.`),
      facts([
        { label: 'Invoice', value: invoiceNumber },
        { label: 'Amount due', value: amountDue, tone: 'danger' },
      ]),
      paragraph('Please arrange payment at your earliest convenience, or reply to this email if something is wrong.'),
    ].join(''),
  })
}

// ============================================
// RESERVATION QUOTE EMAIL
// ============================================

export type QuoteEmailData = {
  clientName: string
  reservationNumber: string
  startDate: string
  endDate: string
  reservationType?: string
  itemsByCategory: {
    category: string
    items: {
      name: string
      quantity: number
      pricingType: string
      rate: number
      subtotal: number
    }[]
  }[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  notes?: string
  projectName?: string
}

export function reservationQuoteEmail(data: QuoteEmailData) {
  const rows: (string[] | { group: string })[] = []
  for (const group of data.itemsByCategory) {
    rows.push({ group: group.category })
    for (const item of group.items) {
      const unit = item.pricingType.toLowerCase()
      // Show the period count when the subtotal reflects a multi-period charge.
      // Terms rarely land on whole periods (a 6-week rental is 1.38 months), so
      // this keeps the fraction rather than rounding it away.
      const single = item.rate * item.quantity
      const periods = single > 0 ? item.subtotal / single : 1
      const perUnitTerm = item.quantity > 0 ? item.subtotal / item.quantity : item.subtotal
      const note = isSinglePeriod(periods)
        ? null
        : `${unit} rate × ${formatPeriodCount(periods)} — ${money(perUnitTerm)} each`
      rows.push([
        cell(item.name, { sub: note }),
        cell(String(item.quantity)),
        cell(`${money(item.rate)}/${unit}`),
        cell(money(item.subtotal), { bold: true }),
      ])
    }
  }

  return email(`Quote ${data.reservationNumber} from VFXNow`, {
    audience: 'client',
    wide: true,
    preheader: `Your quote totals ${money(data.total)}${data.projectName ? ` for ${data.projectName}` : ''}.`,
    eyebrow: 'Quote',
    title: 'Your equipment quote',
    subtitle: data.reservationNumber,
    body: [
      greeting(data.clientName),
      paragraph('Thank you for your interest. Your rental quote is below.'),
      facts([
        ...orderDates(data.startDate, data.endDate, data.reservationType),
        data.projectName ? { label: 'Project', value: data.projectName } : null,
      ]),
      table(
        [
          { label: 'Item' },
          { label: 'Qty', align: 'center', width: '48px' },
          { label: 'Rate', align: 'right' },
          { label: 'Subtotal', align: 'right' },
        ],
        rows,
      ),
      facts([
        { label: 'Subtotal', value: money(data.subtotal) },
        data.taxRate > 0 ? { label: `Tax (${data.taxRate}%)`, value: money(data.taxAmount) } : null,
        { label: 'Total', value: money(data.total), tone: 'accent' },
      ]),
      data.notes ? callout(quoted(data.notes), { title: 'Notes' }) : '',
      paragraph('This quote is an estimate and subject to change. Reply to confirm your reservation or with any questions.', { muted: true, small: true }),
    ].join(''),
  })
}

// ============================================
// QUOTE PAGE LINK
// ============================================

export function quotePageLinkEmail(data: {
  clientName: string
  reservationNumber: string
  quoteUrl: string
  startDate: string
  endDate: string
  total: number
  projectName?: string
  message?: string
  reservationType?: string
  validUntil?: string
  packages?: Array<{ name: string; total: number; itemCount: number }>
}) {
  const multiple = !!data.packages && data.packages.length > 1
  return email(`Quote ${data.reservationNumber} — review & approve`, {
    audience: 'client',
    preheader: `Your quote for ${money(data.total)} is ready to review and approve online.`,
    eyebrow: 'Quote',
    title: 'Your quote is ready',
    subtitle: data.reservationNumber,
    body: [
      greeting(data.clientName),
      paragraph(`We&rsquo;ve prepared a quote for your review.${multiple ? ' It includes more than one package for you to choose from.' : ''} You can see the full details and approve it online.`),
      data.message ? callout(quoted(data.message), { tone: 'accent' }) : '',
      facts([
        ...orderDates(data.startDate, data.endDate, data.reservationType),
        data.projectName ? { label: 'Project', value: data.projectName } : null,
        data.validUntil ? { label: 'Valid until', value: data.validUntil } : null,
      ]),
      multiple
        ? section('Package options') +
          table(
            [{ label: 'Package' }, { label: 'Items', align: 'center', width: '60px' }, { label: 'Total', align: 'right' }],
            data.packages!.map((pkg) => [cell(pkg.name, { bold: true }), cell(String(pkg.itemCount)), cell(money(pkg.total))]),
          )
        : '',
      facts([{ label: 'Estimated total', value: money(data.total), tone: 'accent' }]),
    ].join(''),
    cta: { label: 'View & approve quote', url: data.quoteUrl },
    footer: `You can review the details, approve with your signature, or ask for changes — all from the link above. Reply to this email and it reaches our team.`,
  })
}

export function quoteChangesRequestedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  changeNotes: string
}) {
  return email(`Action required: ${data.clientName} requested changes on ${data.reservationNumber}`, {
    audience: 'staff',
    preheader: `${data.clientName} reviewed the quote and asked for changes.`,
    eyebrow: 'Quote',
    title: 'Changes requested',
    subtitle: data.reservationNumber,
    body: [
      paragraph(`${strong(data.clientName)} has reviewed the quote and is asking for changes:`),
      callout(quoted(data.changeNotes), { tone: 'warning' }),
    ].join(''),
    cta: { label: 'Open the order', url: `/dashboard/orders/${encodeURIComponent(data.reservationId)}` },
  })
}

export function quoteApprovedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  signerName: string
  total: number
  selectedPackageName?: string
}) {
  return email(`Quote approved: ${data.clientName} approved ${data.reservationNumber}`, {
    audience: 'staff',
    preheader: `${data.signerName} signed for ${money(data.total)}.`,
    eyebrow: 'Quote',
    title: 'Quote approved',
    subtitle: data.reservationNumber,
    body: [
      callout(`${strong(data.clientName)} approved this quote. Signed by ${strong(data.signerName)}.`, { tone: 'success' }),
      facts([
        data.selectedPackageName ? { label: 'Package', value: data.selectedPackageName } : null,
        { label: 'Total', value: money(data.total) },
      ]),
    ].join(''),
    cta: { label: 'Open the order', url: `/dashboard/orders/${encodeURIComponent(data.reservationId)}` },
  })
}

export function quoteDeniedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  reason?: string
}) {
  return email(`Quote declined: ${data.clientName} declined ${data.reservationNumber}`, {
    audience: 'staff',
    preheader: `${data.clientName} declined the quote${data.reason ? `: ${data.reason}` : '.'}`,
    eyebrow: 'Quote',
    title: 'Quote declined',
    subtitle: data.reservationNumber,
    body: [
      paragraph(`${strong(data.clientName)} has declined this quote.`),
      data.reason ? callout(quoted(data.reason), { tone: 'danger', title: 'Their reason' }) : '',
    ].join(''),
    cta: { label: 'Open the order', url: `/dashboard/orders/${encodeURIComponent(data.reservationId)}` },
  })
}

/** A proposal PDF sent to a client. Was inline, unescaped HTML in `actions/proposals`. */
export function proposalEmail(data: {
  clientName: string
  projectName: string
  reservationNumber: string
  message?: string | null
}) {
  return email(`Proposal: ${data.projectName}`, {
    audience: 'client',
    preheader: `Our proposal for ${data.projectName} is attached.`,
    eyebrow: 'Proposal',
    title: 'Your project proposal',
    subtitle: data.projectName,
    body: [
      greeting(data.clientName),
      data.message ? paragraph(quoted(data.message)) : paragraph('Please find our proposal attached for your review.'),
      facts([{ label: 'Project', value: data.projectName }]),
      paragraph('We look forward to working with you.'),
      paragraph(`Prepared from order ${escapeHtml(data.reservationNumber)}.`, { muted: true, small: true }),
    ].join(''),
  })
}

// ============================================
// STAFF NOTIFICATIONS
// ============================================

export type NewLeadEmailData = {
  name: string
  email?: string | null
  phone?: string | null
  companyName?: string | null
  source: string
  channel?: string | null
  salesRep?: string | null
  estimatedValue?: number | { toNumber(): number } | null
}

export function newLeadEmail(data: NewLeadEmailData) {
  return email(`New lead: ${data.name}`, {
    audience: 'staff',
    preheader: `${data.name}${data.companyName ? ` (${data.companyName})` : ''} came in via ${data.source}.`,
    eyebrow: 'New lead',
    title: data.name,
    subtitle: data.companyName ?? undefined,
    body: [
      paragraph('A new lead has been added to the pipeline.'),
      facts([
        { label: 'Source', value: data.source },
        data.channel ? { label: 'Channel', value: data.channel } : null,
        data.salesRep ? { label: 'Sales rep', value: data.salesRep } : null,
        data.companyName ? { label: 'Company', value: data.companyName } : null,
        data.email ? { label: 'Email', value: data.email } : null,
        data.phone ? { label: 'Phone', value: data.phone } : null,
        data.estimatedValue != null ? { label: 'Estimated value', value: money(Number(data.estimatedValue)) } : null,
      ]),
    ].join(''),
    cta: { label: 'Open leads', url: `/dashboard/leads?search=${encodeURIComponent(data.name)}` },
  })
}

// ============================================
// PURCHASE ORDER SUBMITTED — STAFF NOTIFICATION
// ============================================

export type PurchaseOrderSubmittedEmailData = {
  poNumber: string
  vendorName: string
  orderType?: string | null
  orderDate: string
  expectedDate?: string | null
  total: string
  purchaseMethod?: string | null
  itemCount: number
  submittedBy?: string | null
  poId: string
}

export function purchaseOrderSubmittedEmail(data: PurchaseOrderSubmittedEmailData) {
  return email(`Purchase order submitted: ${data.poNumber}`, {
    audience: 'staff',
    preheader: `${data.poNumber} to ${data.vendorName} for ${data.total}${data.submittedBy ? `, submitted by ${data.submittedBy}` : ''}.`,
    eyebrow: 'Purchase order',
    title: `${data.poNumber} was submitted`,
    subtitle: data.vendorName,
    body: [
      paragraph('A purchase order has been submitted to the vendor and is ready for processing.'),
      facts([
        { label: 'Vendor', value: data.vendorName },
        data.orderType ? { label: 'Order type', value: data.orderType } : null,
        { label: 'Order date', value: data.orderDate },
        data.expectedDate ? { label: 'Expected delivery', value: data.expectedDate } : null,
        data.purchaseMethod ? { label: 'Purchase method', value: data.purchaseMethod } : null,
        { label: 'Line items', value: String(data.itemCount) },
        { label: 'Total', value: data.total },
        data.submittedBy ? { label: 'Submitted by', value: data.submittedBy } : null,
      ]),
    ].join(''),
    cta: { label: 'Open the purchase order', url: `/dashboard/purchase-orders/${data.poId}` },
  })
}

// ============================================
// RESERVATION CONFIRMED — STAFF NOTIFICATION
// ============================================

export type ReservationConfirmedEmailData = {
  reservationNumber: string
  clientName: string
  startDate: string
  endDate: string
  reservationType?: string
  projectName?: string
  deliveryMethod?: string
  items: { name: string; quantity: number; category?: string }[]
  total: string
}

export function reservationConfirmedStaffEmail(data: ReservationConfirmedEmailData) {
  const byCategory = new Map<string, { name: string; quantity: number }[]>()
  for (const item of data.items) {
    const category = item.category || 'Other'
    const list = byCategory.get(category) ?? []
    list.push({ name: item.name, quantity: item.quantity })
    byCategory.set(category, list)
  }
  const rows: (string[] | { group: string })[] = []
  for (const [category, items] of byCategory) {
    rows.push({ group: category })
    for (const item of items) rows.push([cell(item.name), cell(`${item.quantity}×`, { bold: true })])
  }
  const totalItems = data.items.reduce((sum, item) => sum + item.quantity, 0)
  const itemsLabel = `${totalItems} item${totalItems !== 1 ? 's' : ''}`

  return email(`Reservation ${data.reservationNumber} confirmed — ${itemsLabel} to prep`, {
    audience: 'staff',
    preheader: `${data.clientName}: ${itemsLabel} to prepare from ${data.startDate}.`,
    eyebrow: 'Order confirmed',
    title: `${itemsLabel} to prepare`,
    subtitle: `${data.reservationNumber} · ${data.clientName}`,
    body: [
      facts([
        { label: 'Client', value: data.clientName },
        { label: 'Dates', value: data.reservationType === 'SALE' ? data.startDate : `${data.startDate} — ${data.endDate}` },
        data.projectName ? { label: 'Project', value: data.projectName } : null,
        data.deliveryMethod ? { label: 'Delivery', value: data.deliveryMethod } : null,
        { label: 'Total', value: data.total },
      ]),
      section('Equipment to prepare', itemsLabel),
      table([{ label: 'Item' }, { label: 'Qty', align: 'right', width: '60px' }], rows),
    ].join(''),
    cta: { label: 'Open orders', url: '/dashboard/orders' },
  })
}

// ============================================
// INSIGHTS
// ============================================
//
// v1 sent this under its AI assistant's name, over a robot avatar, billed as
// an AI-powered report. Nothing in it was ever AI: every line is computed from
// the database by the rules in lib/analytics/insights. That assistant is
// dropped in v2, so the digest keeps the work and loses the costume — claiming
// an assistant that does not exist is the kind of thing somebody replies to.

export type InsightEmailData = {
  title: string
  priority: 'high' | 'medium' | 'low'
  description: string
  link?: string
  type: string
}

export type InsightsDigestData = {
  insights: InsightEmailData[]
  summary: {
    totalAssets: number
    availableUnits: number
    totalUnits: number
    activeReservations: number
    activeCheckouts: number
    overdueCheckouts: number
    revenue: string
    outstanding: string
    leadsInPipeline: number
  }
}

const PRIORITY: Record<InsightEmailData['priority'], { tone: Tone; label: string }> = {
  high: { tone: 'danger', label: 'High priority' },
  medium: { tone: 'warning', label: 'Attention' },
  low: { tone: 'success', label: 'Info' },
}

function insightBlocks(insights: InsightEmailData[]): string {
  return insights
    .map((insight) => {
      const priority = PRIORITY[insight.priority] ?? PRIORITY.medium
      const more = insight.link ? ` ${link('View →', insight.link)}` : ''
      return callout(`${strong(insight.title)}<br>${escapeHtml(insight.description)}${more}`, {
        tone: priority.tone,
        title: priority.label,
      })
    })
    .join('')
}

function snapshotFacts(s: InsightsDigestData['summary']): string {
  return facts([
    { label: 'Equipment', value: `${s.totalAssets} types, ${s.availableUnits}/${s.totalUnits} available` },
    { label: 'Orders', value: `${s.activeReservations} active` },
    { label: 'Checkouts', value: `${s.activeCheckouts} active${s.overdueCheckouts > 0 ? `, ${s.overdueCheckouts} overdue` : ''}`, tone: s.overdueCheckouts > 0 ? 'danger' : undefined },
    { label: 'Revenue (paid)', value: s.revenue },
    { label: 'Outstanding', value: s.outstanding, tone: s.outstanding !== '$0' ? 'danger' : undefined },
    { label: 'Leads', value: `${s.leadsInPipeline} in pipeline` },
  ])
}

export function insightsDigestEmail(data: InsightsDigestData) {
  const count = data.insights.length
  return email(`AMC insights — ${count} to act on`, {
    audience: 'staff',
    preheader: count > 0 ? `${count} insight${count !== 1 ? 's' : ''} flagged from today's data.` : 'Nothing flagged today.',
    eyebrow: 'Insights',
    title: 'What the data flagged',
    body: [
      section('Snapshot'),
      snapshotFacts(data.summary),
      count > 0 ? section('To act on', String(count)) + insightBlocks(data.insights) : callout('All clear — nothing to act on right now.', { tone: 'success' }),
      paragraph('Every figure is read straight off the database by the rules in Insights; nothing here is estimated.', { muted: true, small: true }),
    ].join(''),
    cta: { label: 'Open the dashboard', url: '/dashboard' },
  })
}

export function systemAlertEmail(title: string, message: string) {
  return email(`[VFXNow alert] ${title}`, {
    audience: 'staff',
    preheader: message,
    eyebrow: 'System alert',
    title,
    body: callout(quoted(message), { tone: 'warning' }),
  })
}

// ============================================
// WEEKLY REPORT — WEEK AT A GLANCE
// ============================================

export type CoverageExpiryEmailData = {
  items: {
    unitBarcode: string
    assetName: string
    coverageName: string
    coverageType: string
    provider: string | null
    endDate: string
    daysRemaining: number
  }[]
}

export type WeeklyReportMetric = {
  label: string
  value: string
  change?: number // percentage change vs prior week (positive = up)
  prefix?: string // e.g. "$"
}

export type WeeklyReportUpcoming = {
  label: string
  count: number
  link?: string
}

export type WeeklyReportData = {
  weekLabel: string // e.g. "Feb 23 – Mar 1, 2026"
  lastWeek: WeeklyReportMetric[]
  upcoming: WeeklyReportUpcoming[]
  insights: InsightEmailData[]
  snapshot: InsightsDigestData['summary']
}

export function weeklyReportEmail(data: WeeklyReportData) {
  const metrics = data.lastWeek.map((metric) => {
    const change =
      metric.change != null && metric.change !== 0
        ? ` <span style="font-size:12px;color:${metric.change > 0 ? '#067647' : '#b42318'};">${metric.change > 0 ? '+' : ''}${Math.round(metric.change)}%</span>`
        : ''
    return { label: metric.label, value: `${escapeHtml(metric.value)}${change}`, html: true } satisfies Fact
  })
  const upcoming = data.upcoming.filter((item) => item.count > 0)

  return email(`Weekly report — ${data.weekLabel}`, {
    audience: 'staff',
    preheader: `Last week in figures, the week ahead, and what to act on.`,
    eyebrow: 'Weekly report',
    title: 'The week at a glance',
    subtitle: data.weekLabel,
    body: [
      section('Last week', 'change vs the week before'),
      facts(metrics),
      upcoming.length ? section('Week ahead') + facts(upcoming.map((item) => ({ label: item.label, value: String(item.count) }))) : '',
      section('Snapshot'),
      snapshotFacts(data.snapshot),
      data.insights.length ? section('Insights') + insightBlocks(data.insights.slice(0, 6)) : '',
    ].join(''),
    cta: { label: 'Open the dashboard', url: '/dashboard' },
  })
}

// ============================================
// DAILY DIGEST — DAY AT A GLANCE
// ============================================

export type DailyOrderRow = {
  reservationNumber: string
  clientName: string
  projectName?: string
  total: string
  itemCount: number
  link: string
}

export type DailyActionItem = {
  label: string
  count: number
  urgent?: boolean
  link?: string
}

export type DailyDigestData = {
  dateLabel: string // e.g. "Monday, Mar 2"
  reservationsStarting: DailyOrderRow[]
  shipping: DailyOrderRow[]
  returnsDue: DailyOrderRow[]
  actionItems: DailyActionItem[]
  snapshot: {
    activeReservations: number
    activeCheckouts: number
    overdueCheckouts: number
    availableUnits: number
    totalUnits: number
    outstanding: string
  }
  topInsights: InsightEmailData[] // max 3
}

function orderTable(orders: DailyOrderRow[]): string {
  return table(
    [{ label: 'Order' }, { label: 'Client' }, { label: 'Items', align: 'center', width: '50px' }, { label: 'Total', align: 'right' }],
    orders.map((order) => [
      cell(order.reservationNumber, { href: order.link, sub: order.projectName }),
      cell(order.clientName),
      cell(String(order.itemCount)),
      cell(order.total, { bold: true }),
    ]),
  )
}

export function dailyDigestEmail(data: DailyDigestData) {
  const s = data.snapshot
  const actions = data.actionItems.filter((item) => item.count > 0)
  return email(`Daily digest — ${data.dateLabel}`, {
    audience: 'staff',
    wide: true,
    preheader: `${data.reservationsStarting.length} starting, ${data.shipping.length} shipping, ${data.returnsDue.length} due back today.`,
    eyebrow: 'Day at a glance',
    title: 'Today',
    subtitle: data.dateLabel,
    body: [
      stats([
        { label: 'Active orders', value: String(s.activeReservations) },
        { label: 'Checkouts', value: String(s.activeCheckouts), sub: s.overdueCheckouts > 0 ? `${s.overdueCheckouts} overdue` : undefined, tone: s.overdueCheckouts > 0 ? 'danger' : undefined },
        { label: 'Available', value: `${s.availableUnits}/${s.totalUnits}` },
        { label: 'Outstanding', value: s.outstanding, tone: s.outstanding !== '$0' ? 'danger' : undefined },
      ]),
      data.reservationsStarting.length ? section('Starting today') + orderTable(data.reservationsStarting) : '',
      data.shipping.length ? section('Shipping or delivering today') + orderTable(data.shipping) : '',
      data.returnsDue.length ? section('Due back today') + orderTable(data.returnsDue) : '',
      actions.length
        ? section('To act on') + facts(actions.map((item) => ({ label: item.label, value: String(item.count), tone: item.urgent ? 'danger' : undefined })))
        : '',
      data.topInsights.length ? section('Top insights') + insightBlocks(data.topInsights.slice(0, 3)) : '',
    ].join(''),
    cta: { label: 'Open the dashboard', url: '/dashboard' },
  })
}

// ============================================
// DAILY TRAFFIC REPORT
// ============================================

export type TrafficReportUnit = {
  barcode: string
  assetName: string
  time: string // e.g. "10:32 AM"
  reservationNumber: string
  reservationId: string
}

export type TrafficReportClientGroup = {
  clientName: string
  units: TrafficReportUnit[]
}

export type DailyTrafficReportData = {
  dateLabel: string // e.g. "Monday, Apr 8"
  windowLabel: string // e.g. "12:00 AM – 5:00 PM PT"
  out: TrafficReportClientGroup[] // checked out today
  back: TrafficReportClientGroup[] // checked in today
  totals: {
    clientsTouched: number
    unitsOut: number
    unitsIn: number
  }
}

function trafficTable(groups: TrafficReportClientGroup[], empty: string): string {
  if (groups.length === 0) return paragraph(empty, { muted: true, small: true })
  const rows: (string[] | { group: string; meta?: string })[] = []
  for (const group of groups) {
    rows.push({ group: group.clientName, meta: `${group.units.length} unit${group.units.length === 1 ? '' : 's'}` })
    for (const unit of group.units) {
      rows.push([
        cell(unit.time),
        cell(unit.barcode, { mono: true }),
        cell(unit.assetName),
        cell(unit.reservationNumber, { href: `/dashboard/orders/${unit.reservationId}` }),
      ])
    }
  }
  return table([{ label: 'Time', width: '70px' }, { label: 'Unit' }, { label: 'Item' }, { label: 'Order', align: 'right' }], rows, { dense: true })
}

export function dailyTrafficReportEmail(data: DailyTrafficReportData) {
  return email(`Daily traffic report — ${data.dateLabel}`, {
    audience: 'staff',
    wide: true,
    preheader: `${data.totals.unitsOut} out, ${data.totals.unitsIn} back, across ${data.totals.clientsTouched} clients today.`,
    eyebrow: 'Traffic report',
    title: 'What moved today',
    subtitle: `${data.dateLabel} · ${data.windowLabel}`,
    body: [
      stats([
        { label: 'Clients', value: String(data.totals.clientsTouched) },
        { label: 'Checked out', value: String(data.totals.unitsOut), tone: 'success' },
        { label: 'Checked in', value: String(data.totals.unitsIn), tone: 'accent' },
      ]),
      section('Checked out'),
      trafficTable(data.out, 'Nothing went out in this window.'),
      section('Returned'),
      trafficTable(data.back, 'Nothing came back in this window.'),
    ].join(''),
    cta: { label: 'Open the traffic report', url: '/dashboard/reports/traffic' },
  })
}

// ============================================
// CLIENT REQUIREMENTS REQUEST
// ============================================

export function clientRequirementsRequestEmail(data: {
  clientName: string
  requirementTypes: string[]
  uploadUrl: string
  message?: string
}) {
  const wanted = data.requirementTypes
    .map((kind) =>
      kind === 'ID' ? 'Photo ID (front and back)' : kind === 'COI' ? 'Certificate of insurance (COI)' : kind === 'AGREEMENT' ? 'Rental agreement (review and sign)' : null,
    )
    .filter((line): line is NonNullable<typeof line> => !!line)

  return email('VFXNow — documents needed', {
    audience: 'client',
    preheader: `We need ${wanted.length === 1 ? 'one document' : `${wanted.length} documents`} to complete your file.`,
    eyebrow: 'Documents',
    title: 'A few documents, please',
    body: [
      greeting(data.clientName),
      paragraph('We need the following to complete your file:'),
      bullets(wanted),
      data.message ? callout(quoted(data.message), { tone: 'accent' }) : '',
      paragraph('Use the secure link below to upload them. It expires in 30 days.'),
    ].join(''),
    cta: { label: 'Upload documents', url: data.uploadUrl },
    footer: 'This is a secure link for your account only — please don&rsquo;t forward it. Reply to this email and it reaches our team.',
  })
}

export function coverageExpiryEmail(data: CoverageExpiryEmailData) {
  const count = data.items.length
  return email(`Coverage alert: ${count} service coverage${count !== 1 ? 's' : ''} expiring soon`, {
    audience: 'staff',
    preheader: `${count} coverage${count !== 1 ? 's' : ''} end within 30 days.`,
    eyebrow: 'Service coverage',
    title: 'Coverage ending soon',
    body: [
      paragraph('These service coverages end within 30 days. Renew them, or let them lapse on purpose.'),
      table(
        [{ label: 'Unit' }, { label: 'Coverage' }, { label: 'Ends', align: 'right' }],
        data.items.map((item) => [
          cell(item.assetName, { bold: true, sub: item.unitBarcode }),
          cell(item.coverageName, { sub: `${item.coverageType}${item.provider ? ` — ${item.provider}` : ''}` }),
          cell(`${item.daysRemaining} day${item.daysRemaining !== 1 ? 's' : ''}`, {
            bold: true,
            tone: item.daysRemaining <= 7 ? 'danger' : item.daysRemaining <= 14 ? 'warning' : undefined,
            sub: item.endDate,
          }),
        ]),
      ),
    ].join(''),
    cta: { label: 'Open service coverage', url: '/dashboard/service/coverage' },
  })
}

// ============================================
// FLOW TASK EMAILS
// ============================================

const TASK_PRIORITY_TONE: Record<string, Tone> = { LOW: 'success', MEDIUM: 'accent', HIGH: 'warning', URGENT: 'danger' }

export function taskAssignedEmail(assigneeName: string, taskTitle: string, taskId: string, priority: string, dueDate?: string) {
  return email(`Task assigned: ${taskTitle}`, {
    audience: 'staff',
    preheader: `${taskTitle} — ${priority.toLowerCase()} priority${dueDate ? `, due ${dueDate}` : ''}.`,
    eyebrow: 'Task',
    title: 'A task is yours',
    body: [
      greeting(assigneeName),
      paragraph('This task has been assigned to you:'),
      callout(strong(taskTitle), { tone: 'accent' }),
      facts([
        { label: 'Priority', value: priority, tone: TASK_PRIORITY_TONE[priority] ?? 'accent' },
        dueDate ? { label: 'Due', value: dueDate } : null,
      ]),
    ].join(''),
    cta: { label: 'Open the task', url: `/dashboard/flow?task=${encodeURIComponent(taskId)}` },
  })
}

export function taskStatusChangedEmail(recipientName: string, taskTitle: string, taskId: string, fromStatus: string, toStatus: string) {
  const from = fromStatus.replace(/_/g, ' ').toLowerCase()
  const to = toStatus.replace(/_/g, ' ').toLowerCase()
  return email(`Task updated: ${taskTitle}`, {
    audience: 'staff',
    preheader: `${taskTitle} moved from ${from} to ${to}.`,
    eyebrow: 'Task',
    title: 'A task moved',
    body: [
      greeting(recipientName),
      paragraph('A task you are assigned to has been updated:'),
      callout(`${strong(taskTitle)}<br>${escapeHtml(from)} &rarr; ${strong(to)}`, { tone: 'accent' }),
    ].join(''),
    cta: { label: 'Open the task', url: `/dashboard/flow?task=${encodeURIComponent(taskId)}` },
  })
}

// ============================================
// ONBOARDING
// ============================================

/**
 * The message that carries the onboarding form link to a prospect.
 *
 * Deliberately says nothing about price. This goes to an address nobody has
 * verified yet, which is exactly why the quote link is withheld until the form
 * comes back — a quote in an unverified inbox is the whole rate card in the
 * hands of whoever mistyped their email.
 *
 * The destination is a `Setting` row rather than a constant here, so the form
 * can move without a deploy.
 */
export function onboardingInviteEmail(data: { name: string; formUrl: string; companyName?: string | null }) {
  return email('Getting you set up with VFXNow', {
    audience: 'client',
    preheader: 'A short form before we put your quote together.',
    eyebrow: 'Getting started',
    title: `A few details before we quote${data.companyName ? ` for ${data.companyName}` : ''}`,
    body: [
      greeting(data.name),
      paragraph('Thanks for getting in touch. Before we can put a quote together we need a little information about you &mdash; billing details, where equipment would ship, and who to reach. The form takes a couple of minutes.'),
    ].join(''),
    cta: { label: 'Start onboarding', url: data.formUrl },
    footer: `${fallbackLink(data.formUrl)}Reply to this email if anything on the form doesn&rsquo;t apply to you.`,
  })
}

// ============================================
// FUNDING REQUEST SUBMITTED — ACCOUNTING NOTIFICATION
// ============================================

/**
 * Ported from v1 unchanged in content. The payback markers are phrased as the
 * request's own figures ("Payback in 14 months") because that is what they are:
 * arithmetic over what the requester typed, not a measured return. The email
 * says so once, above them, rather than letting accounting read a projection as
 * a result.
 */
export type FundingRequestSubmittedEmailData = {
  requestNumber: string
  requestedBy: string
  submittedBy?: string | null
  requestDate: string
  neededByDate?: string | null
  amountRequested: string
  equipmentCost: string
  equipmentSummary?: string | null
  purchaseType?: string | null
  itemCount: number
  customer?: string | null
  commitment?: string | null
  lender?: string | null
  monthlyPayment?: string | null
  customerRentalCharge?: string | null
  businessPurpose?: string | null
  paybackMonths?: number | null
  debtServiceCoverage?: number | null
  breakEvenMonths?: number | null
  neverBreaksEven?: boolean
  supportingPOs: string[]
  supportingQuotes: string[]
  requestId: string
}

export function fundingRequestSubmittedEmail(data: FundingRequestSubmittedEmailData) {
  const markers: string[] = []
  if (data.paybackMonths != null) markers.push(`Payback in ${strong(`${data.paybackMonths} months`)}`)
  if (data.debtServiceCoverage != null) markers.push(`Rental covers ${strong(`${data.debtServiceCoverage.toFixed(2)}×`)} the payment`)
  if (data.breakEvenMonths != null) markers.push(`Break-even at ${strong(`month ${data.breakEvenMonths}`)} including resale`)
  else if (data.neverBreaksEven) markers.push(`${strong('No break-even')} — rentals and resale do not cover cost`)

  const supporting: string[] = []
  if (data.supportingPOs.length) supporting.push(`Purchase orders: ${escapeHtml(data.supportingPOs.join(', '))}`)
  if (data.supportingQuotes.length) supporting.push(`Client quotes / orders: ${escapeHtml(data.supportingQuotes.join(', '))}`)

  return email(`Funding request: ${data.requestNumber} — ${data.amountRequested}`, {
    audience: 'staff',
    preheader: `${data.requestedBy} asks for ${data.amountRequested}${data.customer ? ` for ${data.customer}` : ''}. The form is attached.`,
    eyebrow: 'Funding request',
    title: `${data.requestNumber} — ${data.amountRequested}`,
    subtitle: data.customer || 'General inventory',
    body: [
      paragraph('A funding request has been submitted for accounting review. The complete request form is attached as a PDF.'),
      data.businessPurpose ? callout(quoted(data.businessPurpose), { title: 'Business purpose' }) : '',
      data.equipmentSummary ? callout(quoted(data.equipmentSummary), { title: 'Equipment' }) : '',
      facts([
        { label: 'Amount requested', value: data.amountRequested },
        data.purchaseType ? { label: 'Purchase type', value: data.purchaseType } : null,
        { label: 'Equipment cost', value: data.equipmentCost },
        { label: 'Line items', value: String(data.itemCount) },
        { label: 'Requested by', value: data.requestedBy },
        { label: 'Request date', value: data.requestDate },
        data.neededByDate ? { label: 'Funding needed by', value: data.neededByDate } : null,
        data.customer ? { label: 'Customer / project', value: data.customer } : null,
        data.commitment ? { label: 'Customer commitment', value: data.commitment } : null,
        data.customerRentalCharge ? { label: 'Customer rental charge', value: data.customerRentalCharge } : null,
        data.lender ? { label: 'Lender / source', value: data.lender } : null,
        data.monthlyPayment ? { label: 'Monthly payment', value: data.monthlyPayment } : null,
        data.submittedBy ? { label: 'Submitted by', value: data.submittedBy } : null,
      ]),
      markers.length
        ? callout(`<span style="font-size:13px;">Estimates from the figures on the request — not measured returns.</span><br>${markers.join('<br>')}`, { tone: 'success' })
        : '',
      supporting.length ? callout(supporting.join('<br>'), { title: 'Supporting documents' }) : '',
    ].join(''),
    cta: { label: 'Open the funding request', url: `/dashboard/funding/${encodeURIComponent(data.requestId)}` },
  })
}

// ============================================
// APPROVALS (docs/procurement.md, Phase 6)
// ============================================

export type ApprovalEmailFact = { label: string; value: string }

export type ApprovalRequestedEmailData = {
  recipientName: string
  /** "purchase order", "funding request", "quote". */
  noun: string
  recordLabel: string
  /** Vendor or client — who the money goes to or comes from. */
  party: ApprovalEmailFact | null
  amount: string
  requestedBy: string
  /** Why this was raised now: "Submit to the vendor", "Total changed from $X to $Y". */
  note: string | null
  /** The record's own words about why — PO notes, business purpose, project. */
  why: string | null
  facts: ApprovalEmailFact[]
  lines: string[]
  /** What approving it lets happen. */
  releases: string
  url: string
}

/**
 * The ask, addressed to one approver.
 *
 * Written to be decided from: what it is, who the money goes to, how much, why,
 * who asked, and the lines — so the approver can open the record already
 * knowing their answer. The decision itself is made in the app, where it is
 * recorded against the signed-in approver; a link in an email cannot prove who
 * clicked it, so there is no approve button here.
 */
export function approvalRequestedEmail(data: ApprovalRequestedEmailData) {
  const releases = data.releases.charAt(0).toLowerCase() + data.releases.slice(1)
  return email(`Approval needed: ${data.recordLabel} — ${data.amount}`, {
    audience: 'staff',
    preheader: `${data.requestedBy} needs a yes on ${data.recordLabel} at ${data.amount}.`,
    eyebrow: 'Approval needed',
    title: `A ${data.noun} is waiting on you`,
    subtitle: `${data.recordLabel} · ${data.amount}`,
    body: [
      greeting(data.recipientName),
      paragraph(`${escapeHtml(data.requestedBy)} needs an approver&rsquo;s yes on ${strong(data.recordLabel)}. Until one of you decides, it is held: ${escapeHtml(releases)} waits.`),
      data.note ? callout(quoted(data.note), { tone: 'accent', title: 'Asked because' }) : '',
      data.why ? callout(quoted(data.why), { title: 'What it is for' }) : '',
      facts([
        { label: 'Amount', value: data.amount },
        { label: 'Asked by', value: data.requestedBy },
        data.party ? { label: data.party.label, value: data.party.value } : null,
        ...data.facts.map((fact) => ({ label: fact.label, value: fact.value })),
      ]),
      data.lines.length ? section('Lines') + callout(data.lines.map((line) => escapeHtml(line)).join('<br>')) : '',
      paragraph(`Approve or deny it on the record. A denial needs a reason, and the reason goes back to ${escapeHtml(data.requestedBy)}.`, { muted: true, small: true }),
    ].join(''),
    cta: { label: `Review ${data.recordLabel}`, url: data.url },
  })
}

export type ApprovalDecidedEmailData = {
  recipientName: string
  noun: string
  recordLabel: string
  approved: boolean
  decidedBy: string
  amount: string
  reason: string | null
  /** What to do now: "Submit it to the vendor from the record." */
  next: string
  url: string
}

/** The answer, back to whoever asked. */
export function approvalDecidedEmail(data: ApprovalDecidedEmailData) {
  const verdict = data.approved ? 'approved' : 'denied'
  return email(`${data.approved ? 'Approved' : 'Denied'}: ${data.recordLabel} — ${data.amount}`, {
    audience: 'staff',
    preheader: `${data.decidedBy} ${verdict} ${data.recordLabel} at ${data.amount}.`,
    eyebrow: data.approved ? 'Approved' : 'Denied',
    title: `${data.recordLabel} was ${verdict}`,
    body: [
      greeting(data.recipientName),
      paragraph(`${escapeHtml(data.decidedBy)} ${verdict} the ${escapeHtml(data.noun)} you asked about, at ${strong(data.amount)}.`),
      data.reason ? callout(quoted(data.reason), { tone: data.approved ? 'success' : 'danger', title: data.approved ? 'Note' : 'Why' }) : '',
      paragraph(escapeHtml(data.next)),
    ].join(''),
    cta: { label: `Open ${data.recordLabel}`, url: data.url },
  })
}

// ============================================
// THE SPECIMEN — Settings → Notifications → Send a test email
// ============================================

/**
 * One message that uses every block, so a test send shows the whole layout in
 * the client it lands in. Its figures are labelled as samples on purpose: an
 * email that looks like a real report and carries invented numbers is exactly
 * the kind of thing that gets forwarded.
 */
export function layoutSpecimenEmail(data: { sentBy: string; sentAt: string; appUrl: string; from: string; redirect: string | null }) {
  return email('VFXNow AMC — test email', {
    audience: 'staff',
    preheader: 'A test of the email layout, sent from Settings → Notifications.',
    eyebrow: 'Test email',
    title: 'This is what our email looks like',
    subtitle: `Sent by ${data.sentBy} · ${data.sentAt}`,
    body: [
      paragraph('Every message the app sends — quotes, approvals, reports, digests — is drawn in this layout. This one uses each building block once so you can check how your mail client renders them.'),
      callout(`Every figure below is a ${strong('sample')}, not data.`, { tone: 'warning', title: 'Sample content' }),
      stats([
        { label: 'Sample', value: '128' },
        { label: 'Sample', value: '$4,200', tone: 'success' },
        { label: 'Sample', value: '3', tone: 'danger', sub: 'late' },
      ]),
      section('Details'),
      facts([
        { label: 'Sent from', value: data.from },
        { label: 'Links point at', value: data.appUrl },
        { label: 'Test redirect', value: data.redirect ?? 'off — mail goes to its real recipient', tone: data.redirect ? undefined : 'danger' },
      ]),
      section('A table'),
      table(
        [{ label: 'Item' }, { label: 'Qty', align: 'center', width: '50px' }, { label: 'Amount', align: 'right' }],
        [{ group: 'Sample group' }, [cell('Sample line', { sub: 'second line' }), cell('2'), cell('$0.00', { bold: true })], [cell('Another sample line'), cell('1'), cell('$0.00', { bold: true })]],
      ),
      callout('A success note.', { tone: 'success' }),
      callout('A problem that needs attention.', { tone: 'danger' }),
    ].join(''),
    cta: { label: 'Open notification settings', url: '/dashboard/settings/notifications' },
  })
}
