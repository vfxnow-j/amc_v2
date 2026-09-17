'use server'

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email/send'
import { overdueReminderEmail, systemAlertEmail } from '@/lib/email/templates'
import { requireAdmin, requireAuth } from '@/lib/auth-utils'
import { readRecipients } from '@/lib/notifications/recipients'
import type { NotificationRecipient } from '@/lib/notifications/recipients-schema'

/**
 * The notification actions a signed-in person can call.
 *
 * Only what checks a session lives here. The senders that mail the configured
 * recipient lists — new lead, order confirmed, PO and funding submitted, the
 * digests and reports — moved to `lib/notifications/outbound.ts` on
 * 2026-09-16: as exports of a `"use server"` file they were public POST
 * endpoints that took no session.
 */

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

/**
 * The recipient list, for a signed-in reader. Writing it is
 * `saveRecipientsAction` in `notification-settings.ts` (admin only).
 */
export async function getNotificationRecipients(): Promise<NotificationRecipient[]> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)
  return readRecipients()
}
