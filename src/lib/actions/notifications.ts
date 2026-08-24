'use server'

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import type { EmailAttachment } from '@/lib/email/send'
// getResend() throws when no key is configured; every call below sits inside a
// try/catch, so a switched-off integration degrades to a logged failure.
import { getResend, EMAIL_FROM } from '@/lib/email/client'
import { overdueReminderEmail, systemAlertEmail, newLeadEmail, reservationConfirmedStaffEmail, purchaseOrderSubmittedEmail, insightsDigestEmail, weeklyReportEmail, dailyDigestEmail, dailyTrafficReportEmail, coverageExpiryEmail, type NewLeadEmailData, type ReservationConfirmedEmailData, type PurchaseOrderSubmittedEmailData, type InsightsDigestData, type WeeklyReportData, type DailyDigestData, type DailyOrderRow, type DailyTrafficReportData, type TrafficReportClientGroup, type TrafficReportUnit, type CoverageExpiryEmailData } from '@/lib/email/templates'
import { coverageTypeLabels } from '@/lib/types'
import { requireAdmin, requireAuth } from '@/lib/auth-utils'

/**
 * Send overdue reminder emails to clients with overdue invoices.
 * Queries all invoices with status OVERDUE and sends a reminder
 * to each client that has an email address on file.
 */
export async function sendOverdueReminders(): Promise<{ sent: number }> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: 'OVERDUE',
    },
    include: {
      client: true,
    },
  })

  let sent = 0

  for (const invoice of overdueInvoices) {
    if (!invoice.client.email) {
      continue
    }

    const daysOverdue = Math.floor(
      (Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
    )
    const amountDue = Number(invoice.total) - Number(invoice.amountPaid)

    const template = overdueReminderEmail(
      invoice.client.name,
      invoice.invoiceNumber,
      `$${amountDue.toFixed(2)}`,
      daysOverdue,
    )

    try {
      await sendEmail({
        to: invoice.client.email,
        subject: template.subject,
        html: template.html,
      })
      sent++
    } catch (error) {
      console.error(
        `Failed to send overdue reminder for invoice ${invoice.invoiceNumber}:`,
        error
      )
    }
  }

  return { sent }
}

/**
 * Send a system alert email to all admin users.
 */
export async function sendSystemAlert(title: string, message: string): Promise<void> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  const admins = await prisma.user.findMany({
    where: {
      role: 'ADMIN',
    },
    select: {
      email: true,
    },
  })

  const template = systemAlertEmail(title, message)

  for (const admin of admins) {
    try {
      await sendEmail({
        to: admin.email,
        subject: template.subject,
        html: template.html,
      })
    } catch (error) {
      console.error(`Failed to send system alert to ${admin.email}:`, error)
    }
  }
}

// ============================================
// NOTIFICATION RECIPIENT SETTINGS
// ============================================

export type NotificationRecipient = {
  email: string
  leads: boolean
  reservations: boolean
  insights: boolean
  traffic?: boolean
  purchaseOrders?: boolean
}

const NOTIFICATION_RECIPIENTS_KEY = 'notification_recipients'

export async function getNotificationRecipients(): Promise<NotificationRecipient[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const setting = await prisma.setting.findUnique({
    where: { key: NOTIFICATION_RECIPIENTS_KEY },
  })

  return (setting?.value as NotificationRecipient[] | null) ?? []
}

export async function saveNotificationRecipients(recipients: NotificationRecipient[]): Promise<void> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error)

  await prisma.setting.upsert({
    where: { key: NOTIFICATION_RECIPIENTS_KEY },
    update: { value: recipients as any },
    create: { key: NOTIFICATION_RECIPIENTS_KEY, value: recipients as any },
  })
}

/**
 * Collect emails for a given notification category.
 * Only returns recipients explicitly configured in Settings > Notifications
 * that have the given category enabled. System users are NOT included —
 * add their email (or a distribution list) to the notification settings
 * if they should receive these emails.
 */
export async function getRecipientsForCategory(category: keyof Pick<NotificationRecipient, 'leads' | 'reservations' | 'insights' | 'traffic' | 'purchaseOrders'>): Promise<string[]> {
  const setting = await prisma.setting.findUnique({
    where: { key: NOTIFICATION_RECIPIENTS_KEY },
  })

  const configured = (setting?.value as NotificationRecipient[] | null) ?? []
  const emails = new Set<string>()
  for (const r of configured) {
    if (r[category] && r.email) {
      emails.add(r.email.toLowerCase().trim())
    }
  }

  return Array.from(emails)
}

// ============================================
// NEW LEAD NOTIFICATION
// ============================================

/**
 * Send a new-lead notification to configured 'leads' recipients only.
 * Called from lead creation paths (server actions, API, webhooks).
 * No auth check — this is an internal helper, not a user-facing action.
 */
export async function notifyNewLead(lead: NewLeadEmailData): Promise<void> {
  try {
    const emails = await getRecipientsForCategory('leads')
    if (emails.length === 0) return

    const template = newLeadEmail(lead)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (new lead notification):', error)
    }
  } catch (error) {
    console.error('Failed to send new lead notifications:', error)
  }
}

// ============================================
// RESERVATION CONFIRMED NOTIFICATION
// ============================================

/**
 * Send a reservation-confirmed notification to configured 'reservations' recipients only.
 * Tells engineering/staff what equipment to prep.
 * No auth check — called from confirmReservation server action.
 */
export async function notifyReservationConfirmed(data: ReservationConfirmedEmailData): Promise<void> {
  try {
    const emails = await getRecipientsForCategory('reservations')
    if (emails.length === 0) return

    const template = reservationConfirmedStaffEmail(data)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (reservation confirmed notification):', error)
    }
  } catch (error) {
    console.error('Failed to send reservation confirmed notifications:', error)
  }
}

// ============================================
// PURCHASE ORDER SUBMITTED NOTIFICATION
// ============================================

/**
 * Send a PO-submitted notification to configured 'purchaseOrders' recipients only
 * (e.g. accounting@). No auth check — called from the submitPurchaseOrder action.
 */
export async function notifyPurchaseOrderSubmitted(
  data: PurchaseOrderSubmittedEmailData,
  attachments?: EmailAttachment[]
): Promise<void> {
  try {
    const emails = await getRecipientsForCategory('purchaseOrders')
    if (emails.length === 0) return

    const template = purchaseOrderSubmittedEmail(data)

    // Resend's batch endpoint does not support attachments, so when we have a
    // PDF to attach we send one message per recipient via the single-send API.
    if (attachments && attachments.length > 0) {
      for (const email of emails) {
        const { success, error } = await sendEmail({
          to: email,
          subject: template.subject,
          html: template.html,
          attachments,
        })
        if (!success) {
          console.error(`Failed to send PO notification to ${email}:`, error)
        }
      }
      return
    }

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (purchase order submitted notification):', error)
    }
  } catch (error) {
    console.error('Failed to send purchase order submitted notifications:', error)
  }
}

// ============================================
// INSIGHTS DIGEST EMAIL
// ============================================

/**
 * Generate and send the insights digest email.
 * Sends only to configured 'insights' recipients.
 * No auth check — this is called from cron or internal triggers.
 */
export async function notifyInsights(): Promise<{ sent: number; insights: number }> {
  try {
    const emails = await getRecipientsForCategory('insights')
    if (emails.length === 0) return { sent: 0, insights: 0 }

    // Gather business summary data
    const [
      assetData,
      reservationCount,
      checkoutCounts,
      invoiceData,
      leadCount,
    ] = await Promise.all([
      prisma.asset.findMany({
        where: { totalQuantity: { gt: 0 } },
        select: {
          totalQuantity: true,
          units: {
            where: { status: { not: 'RETIRED' } },
            select: { status: true },
          },
        },
      }),
      prisma.reservation.count({
        where: { status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] } },
      }),
      Promise.all([
        prisma.checkout.count({ where: { status: 'ACTIVE' } }),
        prisma.checkout.count({ where: { status: 'OVERDUE' } }),
      ]),
      prisma.invoice.findMany({
        select: { status: true, total: true, amountPaid: true },
      }),
      prisma.lead.count({
        where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROSPECT'] } },
      }),
    ])

    const totalAssets = assetData.length
    const totalUnits = assetData.reduce((s, a) => s + a.units.length, 0)
    const availableUnits = assetData.reduce((s, a) => s + a.units.filter(u => u.status === 'AVAILABLE').length, 0)
    const [activeCheckouts, overdueCheckouts] = checkoutCounts
    const totalRevenue = invoiceData
      .filter(i => i.status === 'PAID')
      .reduce((s, i) => s + Number(i.total), 0)
    const totalOutstanding = invoiceData
      .filter(i => ['SENT', 'OVERDUE', 'PARTIAL'].includes(i.status))
      .reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0)

    const $ = (n: number) => n ? `$${n.toLocaleString()}` : '$0'

    // Get insights (bypass auth for cron context)
    const { getInsightsInternal } = await import('@/lib/analytics/insights')
    const insights = await getInsightsInternal()

    const digestData: InsightsDigestData = {
      insights: insights.map(i => ({
        title: i.title,
        priority: i.priority,
        description: i.description,
        link: i.link,
        type: i.type,
      })),
      summary: {
        totalAssets,
        availableUnits,
        totalUnits,
        activeReservations: reservationCount,
        activeCheckouts,
        overdueCheckouts,
        revenue: $(totalRevenue),
        outstanding: $(totalOutstanding),
        leadsInPipeline: leadCount,
      },
    }

    const template = insightsDigestEmail(digestData)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (insights digest):', error)
    }

    return { sent: emails.length, insights: insights.length }
  } catch (error) {
    console.error('Failed to send insights digest:', error)
    return { sent: 0, insights: 0 }
  }
}

// ============================================
// DAILY DIGEST EMAIL
// ============================================

/**
 * Generate and send the daily digest — "day at a glance".
 * Shows today's reservations, shipping, returns due, action items, and top 3 insights.
 * Sends to configured 'insights' recipients.
 * No auth check — called from cron.
 */
export async function notifyDailyDigest(): Promise<{ sent: number }> {
  try {
    const emails = await getRecipientsForCategory('insights')
    if (emails.length === 0) return { sent: 0 }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)

    const $ = (n: number) => n ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0'

    const [
      startingToday,
      shippingToday,
      returnsDueToday,
      overdueCheckouts,
      needsPrep,
      overdueInvoiceCount,
      draftInvoiceCount,
      // Snapshot
      assetData,
      reservationCount,
      activeCheckoutCount,
      overdueCheckoutCount,
      invoiceOutstanding,
    ] = await Promise.all([
      // Reservations starting today
      prisma.reservation.findMany({
        where: {
          startDate: { gte: todayStart, lt: todayEnd },
          status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] },
        },
        select: {
          id: true,
          reservationNumber: true,
          total: true,
          projectName: true,
          client: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { startDate: 'asc' },
      }),

      // Shipping / delivering today
      prisma.reservation.findMany({
        where: {
          deliveryDate: { gte: todayStart, lt: todayEnd },
          status: { in: ['PREPARING', 'SHIPPED', 'APPROVED'] },
        },
        select: {
          id: true,
          reservationNumber: true,
          total: true,
          projectName: true,
          client: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { deliveryDate: 'asc' },
      }),

      // Returns due today (reservations ending today with active checkouts)
      prisma.reservation.findMany({
        where: {
          endDate: { gte: todayStart, lt: todayEnd },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          reservationNumber: true,
          total: true,
          projectName: true,
          client: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { endDate: 'asc' },
      }),

      // Overdue checkouts
      prisma.checkout.count({ where: { status: 'OVERDUE' } }),

      // Needs prep (APPROVED or PREPARING, starting within 3 days)
      prisma.reservation.count({
        where: {
          status: { in: ['APPROVED', 'PREPARING'] },
          startDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 3 * 24 * 60 * 60 * 1000) },
        },
      }),

      // Overdue invoices
      prisma.invoice.count({ where: { status: 'OVERDUE' } }),

      // Draft invoices pending send
      prisma.invoice.count({ where: { status: 'DRAFT' } }),

      // Snapshot: asset availability
      prisma.asset.findMany({
        where: { totalQuantity: { gt: 0 } },
        select: {
          units: {
            where: { status: { not: 'RETIRED' } },
            select: { status: true },
          },
        },
      }),
      prisma.reservation.count({
        where: { status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] } },
      }),
      prisma.checkout.count({ where: { status: 'ACTIVE' } }),
      prisma.checkout.count({ where: { status: 'OVERDUE' } }),
      prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'OVERDUE', 'PARTIAL'] } },
        select: { total: true, amountPaid: true },
      }),
    ])

    const totalUnits = assetData.reduce((s, a) => s + a.units.length, 0)
    const availableUnits = assetData.reduce((s, a) => s + a.units.filter(u => u.status === 'AVAILABLE').length, 0)
    const totalOutstanding = invoiceOutstanding.reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0)

    const toOrderRow = (r: typeof startingToday[number]): DailyOrderRow => ({
      reservationNumber: r.reservationNumber,
      clientName: r.client.name,
      projectName: r.projectName ?? undefined,
      total: `$${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      itemCount: r._count.items,
      link: `/dashboard/reservations/${r.id}`,
    })

    // De-duplicate shipping that also appears in starting (same reservation)
    const startingIds = new Set(startingToday.map(r => r.id))
    const dedupedShipping = shippingToday.filter(r => !startingIds.has(r.id))

    // Get top 3 high-priority insights
    const { getInsightsInternal } = await import('@/lib/analytics/insights')
    const allInsights = await getInsightsInternal()
    const topInsights = allInsights
      .filter(i => i.priority === 'high')
      .slice(0, 3)

    const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

    const digestData: DailyDigestData = {
      dateLabel,
      reservationsStarting: startingToday.map(toOrderRow),
      shipping: dedupedShipping.map(toOrderRow),
      returnsDue: returnsDueToday.map(toOrderRow),
      actionItems: [
        { label: 'Overdue checkouts', count: overdueCheckouts, urgent: true, link: '/dashboard/reservations' },
        { label: 'Orders to prep (next 3 days)', count: needsPrep, link: '/dashboard/reservations' },
        { label: 'Overdue invoices', count: overdueInvoiceCount, urgent: overdueInvoiceCount > 0, link: '/dashboard/settings/audit-log' },
        { label: 'Draft invoices to send', count: draftInvoiceCount, link: '/dashboard/settings/audit-log' },
      ],
      snapshot: {
        activeReservations: reservationCount,
        activeCheckouts: activeCheckoutCount,
        overdueCheckouts: overdueCheckoutCount,
        availableUnits,
        totalUnits,
        outstanding: $(totalOutstanding),
      },
      topInsights: topInsights.map(i => ({
        title: i.title,
        priority: i.priority,
        description: i.description,
        link: i.link,
        type: i.type,
      })),
    }

    const template = dailyDigestEmail(digestData)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (daily digest):', error)
    }

    return { sent: emails.length }
  } catch (error) {
    console.error('Failed to send daily digest:', error)
    return { sent: 0 }
  }
}

// ============================================
// DAILY TRAFFIC REPORT (5pm PT)
// ============================================

/**
 * Compute "today" boundaries in America/Los_Angeles, returning UTC Date
 * objects suitable for Prisma `gte`/`lt` queries. Handles both PST and PDT
 * automatically — never hardcode a fixed offset for Pacific time.
 */
function pacificDayBounds(now: Date = new Date()): { start: Date; end: Date; dateLabel: string; windowLabel: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  // The instant `now` rendered as Pacific local time, then re-parsed as if it
  // were UTC, gives us a value whose distance from `now` is the Pacific offset.
  const pacificAsUtc = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`).getTime()
  const offsetMs = pacificAsUtc - now.getTime()
  const startMs = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`).getTime() - offsetMs

  const dateLabel = now.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'short', day: 'numeric',
  })
  const nowPacificTime = now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const tzAbbrev = now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short',
  }).split(' ').pop() // "PST" or "PDT"
  const windowLabel = `12:00 AM – ${nowPacificTime} ${tzAbbrev || 'PT'}`

  return {
    start: new Date(startMs),
    end: new Date(startMs + 24 * 60 * 60 * 1000),
    dateLabel,
    windowLabel,
  }
}

function formatPacificTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/**
 * Send the daily traffic report — what was checked out and checked in today
 * (Pacific time), grouped by client. Sends to recipients with the 'traffic'
 * notification category enabled. Triggered by cron at 5:00 PM PT.
 */
export async function notifyDailyTrafficReport(): Promise<{ sent: number; outCount: number; inCount: number }> {
  try {
    const emails = await getRecipientsForCategory('traffic')
    if (emails.length === 0) return { sent: 0, outCount: 0, inCount: 0 }

    const { start, end, dateLabel, windowLabel } = pacificDayBounds()

    // Checkouts created today (RESERVATION workflow only — these are real
    // physical movements tied to an order)
    const [checkedOutToday, returnedToday] = await Promise.all([
      prisma.checkout.findMany({
        where: {
          checkoutDate: { gte: start, lt: end },
          workflowType: 'RESERVATION',
        },
        select: {
          id: true,
          checkoutDate: true,
          assetUnit: { select: { barcode: true, asset: { select: { name: true } } } },
          client: { select: { id: true, name: true, companyName: true } },
          reservation: { select: { id: true, reservationNumber: true } },
        },
        orderBy: { checkoutDate: 'asc' },
      }),
      prisma.checkout.findMany({
        where: {
          actualReturn: { gte: start, lt: end },
          workflowType: 'RESERVATION',
        },
        select: {
          id: true,
          actualReturn: true,
          assetUnit: { select: { barcode: true, asset: { select: { name: true } } } },
          client: { select: { id: true, name: true, companyName: true } },
          reservation: { select: { id: true, reservationNumber: true } },
        },
        orderBy: { actualReturn: 'asc' },
      }),
    ])

    // Group by client (use companyName when available, fall back to name)
    const groupByClient = (
      rows: Array<{
        assetUnit: { barcode: string | null; asset: { name: string } | null } | null
        client: { id: string; name: string; companyName: string | null }
        reservation: { id: string; reservationNumber: string } | null
        checkoutDate?: Date
        actualReturn?: Date | null
      }>,
      timeField: 'checkoutDate' | 'actualReturn'
    ): TrafficReportClientGroup[] => {
      const map = new Map<string, TrafficReportClientGroup>()
      for (const row of rows) {
        if (!row.reservation || !row.assetUnit) continue
        const clientLabel = row.client.companyName || row.client.name
        const ts = (row[timeField] as Date | null | undefined) ?? null
        if (!ts) continue
        const unit: TrafficReportUnit = {
          barcode: row.assetUnit.barcode || '—',
          assetName: row.assetUnit.asset?.name || 'Unknown asset',
          time: formatPacificTime(ts),
          reservationNumber: row.reservation.reservationNumber,
          reservationId: row.reservation.id,
        }
        const existing = map.get(row.client.id)
        if (existing) {
          existing.units.push(unit)
        } else {
          map.set(row.client.id, { clientName: clientLabel, units: [unit] })
        }
      }
      // Stable order: clients with the most activity first
      return Array.from(map.values()).sort((a, b) => b.units.length - a.units.length)
    }

    const out = groupByClient(checkedOutToday, 'checkoutDate')
    const back = groupByClient(returnedToday, 'actualReturn')

    const clientsTouched = new Set<string>()
    for (const c of checkedOutToday) clientsTouched.add(c.client.id)
    for (const c of returnedToday) clientsTouched.add(c.client.id)

    const data: DailyTrafficReportData = {
      dateLabel,
      windowLabel,
      out,
      back,
      totals: {
        clientsTouched: clientsTouched.size,
        unitsOut: checkedOutToday.length,
        unitsIn: returnedToday.length,
      },
    }

    const template = dailyTrafficReportEmail(data)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )
    if (error) {
      console.error('Resend batch error (daily traffic report):', error)
    }

    return { sent: emails.length, outCount: checkedOutToday.length, inCount: returnedToday.length }
  } catch (error) {
    console.error('Failed to send daily traffic report:', error)
    return { sent: 0, outCount: 0, inCount: 0 }
  }
}

// ============================================
// WEEKLY REPORT EMAIL
// ============================================

/**
 * Generate and send the weekly report email.
 * Includes last week's metrics (with WoW change), the week ahead, and insights.
 * Sends to configured 'insights' recipients.
 * No auth check — called from cron.
 */
export async function notifyWeeklyReport(): Promise<{ sent: number; insights: number }> {
  try {
    const emails = await getRecipientsForCategory('insights')
    if (emails.length === 0) return { sent: 0, insights: 0 }

    const now = new Date()

    // Week boundaries (Mon–Sun)
    const dayOfWeek = now.getDay() // 0=Sun
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    // Last week: Mon–Sun
    const lastWeekEnd = new Date(now)
    lastWeekEnd.setDate(now.getDate() - daysSinceMonday)
    lastWeekEnd.setHours(0, 0, 0, 0) // start of this Monday = end of last week

    const lastWeekStart = new Date(lastWeekEnd)
    lastWeekStart.setDate(lastWeekEnd.getDate() - 7)

    // Prior week (for comparison)
    const priorWeekStart = new Date(lastWeekStart)
    priorWeekStart.setDate(lastWeekStart.getDate() - 7)
    const priorWeekEnd = new Date(lastWeekStart)

    // This coming week
    const nextWeekEnd = new Date(lastWeekEnd)
    nextWeekEnd.setDate(lastWeekEnd.getDate() + 7)

    const $ = (n: number) => n ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0'
    const pctChange = (prev: number, curr: number) => prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null

    // ---- Query all weekly data in parallel ----
    const [
      lastWeekRevenue,
      priorWeekRevenue,
      lastWeekNewReservations,
      priorWeekNewReservations,
      lastWeekCheckouts,
      priorWeekCheckouts,
      lastWeekCheckins,
      priorWeekCheckins,
      lastWeekNewLeads,
      priorWeekNewLeads,
      lastWeekInvoices,
      priorWeekInvoices,
      upcomingReservations,
      returnsDue,
      overdueItems,
      // Snapshot data
      assetData,
      reservationCount,
      checkoutCounts,
      invoiceData,
      leadCount,
    ] = await Promise.all([
      // Last week revenue (payments received)
      prisma.payment.aggregate({
        where: { paymentDate: { gte: lastWeekStart, lt: lastWeekEnd } },
        _sum: { amount: true },
      }),
      // Prior week revenue (payments received)
      prisma.payment.aggregate({
        where: { paymentDate: { gte: priorWeekStart, lt: priorWeekEnd } },
        _sum: { amount: true },
      }),
      // Last week new reservations
      prisma.reservation.count({
        where: { createdAt: { gte: lastWeekStart, lt: lastWeekEnd } },
      }),
      // Prior week new reservations
      prisma.reservation.count({
        where: { createdAt: { gte: priorWeekStart, lt: priorWeekEnd } },
      }),
      // Last week checkouts
      prisma.checkout.count({
        where: { checkoutDate: { gte: lastWeekStart, lt: lastWeekEnd } },
      }),
      // Prior week checkouts
      prisma.checkout.count({
        where: { checkoutDate: { gte: priorWeekStart, lt: priorWeekEnd } },
      }),
      // Last week checkins (returns)
      prisma.checkout.count({
        where: { actualReturn: { gte: lastWeekStart, lt: lastWeekEnd } },
      }),
      // Prior week checkins
      prisma.checkout.count({
        where: { actualReturn: { gte: priorWeekStart, lt: priorWeekEnd } },
      }),
      // Last week new leads
      prisma.lead.count({
        where: { createdAt: { gte: lastWeekStart, lt: lastWeekEnd } },
      }),
      // Prior week new leads
      prisma.lead.count({
        where: { createdAt: { gte: priorWeekStart, lt: priorWeekEnd } },
      }),
      // Last week invoices generated
      prisma.invoice.count({
        where: { createdAt: { gte: lastWeekStart, lt: lastWeekEnd } },
      }),
      // Prior week invoices generated
      prisma.invoice.count({
        where: { createdAt: { gte: priorWeekStart, lt: priorWeekEnd } },
      }),
      // Upcoming: reservations starting this week
      prisma.reservation.count({
        where: {
          startDate: { gte: lastWeekEnd, lt: nextWeekEnd },
          status: { in: ['APPROVED', 'PREPARING', 'SHIPPED'] },
        },
      }),
      // Upcoming: returns due this week
      prisma.checkout.count({
        where: {
          expectedReturn: { gte: lastWeekEnd, lt: nextWeekEnd },
          status: 'ACTIVE',
        },
      }),
      // Currently overdue
      prisma.checkout.count({ where: { status: 'OVERDUE' } }),
      // Snapshot queries
      prisma.asset.findMany({
        where: { totalQuantity: { gt: 0 } },
        select: {
          totalQuantity: true,
          units: {
            where: { status: { not: 'RETIRED' } },
            select: { status: true },
          },
        },
      }),
      prisma.reservation.count({
        where: { status: { in: ['APPROVED', 'PREPARING', 'SHIPPED', 'ACTIVE'] } },
      }),
      Promise.all([
        prisma.checkout.count({ where: { status: 'ACTIVE' } }),
        prisma.checkout.count({ where: { status: 'OVERDUE' } }),
      ]),
      prisma.invoice.findMany({
        select: { status: true, total: true, amountPaid: true },
      }),
      prisma.lead.count({
        where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROSPECT'] } },
      }),
    ])

    // Compute metrics
    const lwRevenue = Number(lastWeekRevenue._sum.amount || 0)
    const pwRevenue = Number(priorWeekRevenue._sum.amount || 0)

    const lastWeekMetrics = [
      { label: 'Revenue Collected', value: $(lwRevenue), change: pctChange(pwRevenue, lwRevenue) ?? undefined },
      { label: 'New Orders', value: String(lastWeekNewReservations), change: pctChange(priorWeekNewReservations, lastWeekNewReservations) ?? undefined },
      { label: 'Checkouts', value: String(lastWeekCheckouts), change: pctChange(priorWeekCheckouts, lastWeekCheckouts) ?? undefined },
      { label: 'Returns', value: String(lastWeekCheckins), change: pctChange(priorWeekCheckins, lastWeekCheckins) ?? undefined },
      { label: 'New Leads', value: String(lastWeekNewLeads), change: pctChange(priorWeekNewLeads, lastWeekNewLeads) ?? undefined },
      { label: 'Invoices Generated', value: String(lastWeekInvoices), change: pctChange(priorWeekInvoices, lastWeekInvoices) ?? undefined },
    ]

    const upcomingItems = [
      { label: 'Reservations starting', count: upcomingReservations, link: '/dashboard/reservations' },
      { label: 'Returns due', count: returnsDue, link: '/dashboard/reservations' },
      { label: 'Currently overdue', count: overdueItems, link: '/dashboard/reservations' },
    ]

    // Build snapshot
    const totalAssets = assetData.length
    const totalUnits = assetData.reduce((s, a) => s + a.units.length, 0)
    const availableUnits = assetData.reduce((s, a) => s + a.units.filter(u => u.status === 'AVAILABLE').length, 0)
    const [activeCheckouts, overdueCheckouts] = checkoutCounts
    const totalRevenue = invoiceData
      .filter(i => i.status === 'PAID')
      .reduce((s, i) => s + Number(i.total), 0)
    const totalOutstanding = invoiceData
      .filter(i => ['SENT', 'OVERDUE', 'PARTIAL'].includes(i.status))
      .reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0)

    // Get insights
    const { getInsightsInternal } = await import('@/lib/analytics/insights')
    const insights = await getInsightsInternal()

    // Format week label
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const lastSunday = new Date(lastWeekEnd)
    lastSunday.setDate(lastWeekEnd.getDate() - 1)
    const weekLabel = `${fmt(lastWeekStart)} – ${fmt(lastSunday)}, ${lastSunday.getFullYear()}`

    const reportData: WeeklyReportData = {
      weekLabel,
      lastWeek: lastWeekMetrics,
      upcoming: upcomingItems,
      insights: insights.map(i => ({
        title: i.title,
        priority: i.priority,
        description: i.description,
        link: i.link,
        type: i.type,
      })),
      snapshot: {
        totalAssets,
        availableUnits,
        totalUnits,
        activeReservations: reservationCount,
        activeCheckouts,
        overdueCheckouts,
        revenue: $(totalRevenue),
        outstanding: $(totalOutstanding),
        leadsInPipeline: leadCount,
      },
    }

    const template = weeklyReportEmail(reportData)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (weekly report):', error)
    }

    return { sent: emails.length, insights: insights.length }
  } catch (error) {
    console.error('Failed to send weekly report:', error)
    return { sent: 0, insights: 0 }
  }
}

// ============================================
// COVERAGE EXPIRY NOTIFICATION
// ============================================

/**
 * Check for service coverages expiring within 30 days and send
 * notification emails to 'reservations' category recipients.
 * Uses notifiedAt to avoid duplicate sends (re-notifies weekly).
 * No auth check — called from cron.
 */
export async function sendCoverageExpiryNotifications(): Promise<{ sent: number; coverages: number }> {
  try {
    const emails = await getRecipientsForCategory('reservations')
    if (emails.length === 0) return { sent: 0, coverages: 0 }

    const now = new Date()
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const expiringCoverages = await prisma.serviceCoverage.findMany({
      where: {
        endDate: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
        OR: [
          { notifiedAt: null },
          { notifiedAt: { lt: sevenDaysAgo } },
        ],
        unit: {
          status: { not: 'RETIRED' },
        },
      },
      include: {
        unit: {
          include: {
            asset: { select: { name: true } },
          },
        },
      },
      orderBy: { endDate: 'asc' },
    })

    if (expiringCoverages.length === 0) return { sent: 0, coverages: 0 }

    const emailData: CoverageExpiryEmailData = {
      items: expiringCoverages.map((cov) => ({
        unitBarcode: cov.unit.barcode,
        assetName: cov.unit.asset.name,
        coverageName: cov.name,
        coverageType: coverageTypeLabels[cov.type as keyof typeof coverageTypeLabels] || cov.type,
        provider: cov.provider,
        endDate: cov.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        daysRemaining: Math.ceil((cov.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      })),
    }

    const template = coverageExpiryEmail(emailData)

    const { error } = await getResend().batch.send(
      emails.map((email) => ({
        from: EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html,
      }))
    )

    if (error) {
      console.error('Resend batch error (coverage expiry):', error)
    }

    // Mark all as notified to prevent duplicates
    await prisma.serviceCoverage.updateMany({
      where: { id: { in: expiringCoverages.map((c) => c.id) } },
      data: { notifiedAt: now },
    })

    return { sent: emails.length, coverages: expiringCoverages.length }
  } catch (error) {
    console.error('Failed to send coverage expiry notifications:', error)
    return { sent: 0, coverages: 0 }
  }
}
