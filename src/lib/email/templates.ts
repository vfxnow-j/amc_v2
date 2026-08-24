import { APP_URL } from './client'
import { formatPeriodCount, isSinglePeriod } from '@/lib/pricing/periods'
import { formatCurrency } from '@/lib/utils/format'

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; padding: 40px 0; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #18181b; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600;">VFXNow AMC</h1>
    </div>
    <div style="padding: 32px 24px;">
      ${content}
    </div>
    <div style="padding: 16px 24px; background: #f4f4f5; text-align: center; font-size: 12px; color: #71717a;">
      VFXNow Asset Management &amp; Control
    </div>
  </div>
</body>
</html>`
}

// ============================================
// SECURITY EMAILS
// ============================================

export function mfaOtpEmail(name: string, code: string) {
  const safeName = escapeHtml(name)
  const safeCode = escapeHtml(code)
  return {
    subject: `${safeCode} is your VFXNow verification code`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Verification Code</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Your one-time verification code is:</p>
      <div style="text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #18181b; background: #f4f4f5; padding: 12px 24px; border-radius: 8px; display: inline-block;">${safeCode}</span>
      </div>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        This code expires in 10 minutes. If you did not request this, please ignore this email.
      </p>
    `),
  }
}

export function passwordResetEmail(name: string, resetToken: string) {
  const safeName = escapeHtml(name)
  const safeToken = encodeURIComponent(resetToken)
  const resetUrl = `${APP_URL}/reset-password?token=${safeToken}`
  return {
    subject: 'Reset your VFXNow password',
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Password Reset</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">We received a request to reset your password. Click the button below to set a new one:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${resetUrl}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        This link expires in 1 hour. If you did not request this, you can safely ignore this email.
      </p>
      <p style="color: #a1a1aa; font-size: 12px; word-break: break-all; line-height: 1.6;">
        ${escapeHtml(resetUrl)}
      </p>
    `),
  }
}

export function mfaEnabledEmail(name: string) {
  const safeName = escapeHtml(name)
  return {
    subject: 'Two-factor authentication enabled',
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">MFA Enabled</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Two-factor authentication has been successfully enabled on your VFXNow account. You will now be required to enter a verification code sent to your email each time you sign in.</p>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        If you did not make this change, please contact your administrator immediately.
      </p>
    `),
  }
}

export function mfaDisabledEmail(name: string) {
  const safeName = escapeHtml(name)
  return {
    subject: 'Two-factor authentication disabled',
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">MFA Disabled</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Two-factor authentication has been disabled on your VFXNow account. Your account is now protected by password only.</p>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        If you did not make this change, please contact your administrator immediately and change your password.
      </p>
    `),
  }
}

export function accountInviteEmail(name: string, setupToken: string, roleName: string) {
  const safeName = escapeHtml(name)
  const safeRole = escapeHtml(roleName)
  const setupUrl = `${APP_URL}/setup-account?token=${encodeURIComponent(setupToken)}`
  return {
    subject: 'You\'ve been invited to VFXNow AMC',
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Welcome to VFXNow AMC</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">
        An account has been created for you with the role of <strong>${safeRole}</strong>.
        Click the button below to set up your password and secure your account.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${setupUrl}" style="display: inline-block; background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
          Set Up Your Account
        </a>
      </div>
      <p style="color: #71717a; font-size: 13px; line-height: 1.5;">
        This link will expire in 72 hours. If you did not expect this invitation,
        you can safely ignore this email.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.5;">
        If the button doesn't work, copy and paste this URL into your browser:<br>
        <a href="${setupUrl}" style="color: #3b82f6; word-break: break-all;">${setupUrl}</a>
      </p>
    `),
  }
}

// ============================================
// CLIENT NOTIFICATION EMAILS
// ============================================

export function invoiceCreatedEmail(clientName: string, invoiceNumber: string, total: string, dueDate: string) {
  const safeName = escapeHtml(clientName)
  const safeInvoice = escapeHtml(invoiceNumber)
  const safeTotal = escapeHtml(total)
  const safeDue = escapeHtml(dueDate)
  return {
    subject: `Invoice ${safeInvoice} from VFXNow`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Invoice ${safeInvoice}</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">A new invoice has been generated for your account.</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Invoice Number</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeInvoice}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Total Amount</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeTotal}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Due Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeDue}</td>
        </tr>
      </table>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        Please contact us if you have any questions about this invoice.
      </p>
    `),
  }
}

export function reservationConfirmedEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  const safeName = escapeHtml(clientName)
  const safeRes = escapeHtml(reservationNumber)
  const safeStart = escapeHtml(startDate)
  const safeEnd = escapeHtml(endDate)
  const isSale = reservationType === 'SALE'
  const endDateRow = isSale ? '' : `
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">End Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeEnd}</td>
        </tr>`
  return {
    subject: `Reservation ${safeRes} confirmed`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Reservation Confirmed</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Your reservation has been confirmed and equipment is reserved for you.</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Reservation</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeRes}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Start Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeStart}</td>
        </tr>${endDateRow}
      </table>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        Please contact us if you need to make any changes.
      </p>
    `),
  }
}

export function orderPreparingEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  const safeName = escapeHtml(clientName)
  const safeRes = escapeHtml(reservationNumber)
  const safeStart = escapeHtml(startDate)
  const safeEnd = escapeHtml(endDate)
  const isSale = reservationType === 'SALE'
  const endDateRow = isSale ? '' : `
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">End Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeEnd}</td>
        </tr>`
  return {
    subject: `Order ${safeRes} — Now Being Prepared`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Order In Preparation</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Your order is now being prepared by our team. We'll notify you when it's ready${isSale ? '.' : ' for delivery.'}</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Order</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeRes}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Start Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeStart}</td>
        </tr>${endDateRow}
      </table>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        Please contact us if you have any questions.
      </p>
    `),
  }
}

export function orderShippedEmail(clientName: string, reservationNumber: string, startDate: string, endDate: string, reservationType?: string) {
  const safeName = escapeHtml(clientName)
  const safeRes = escapeHtml(reservationNumber)
  const safeStart = escapeHtml(startDate)
  const safeEnd = escapeHtml(endDate)
  const isSale = reservationType === 'SALE'
  const readyLabel = isSale ? 'Shipped' : 'Shipped / Ready'
  const endDateRow = isSale ? '' : `
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">End Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeEnd}</td>
        </tr>`
  return {
    subject: `Order ${safeRes} — ${readyLabel}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Order ${readyLabel}</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Your order has been ${isSale ? 'shipped' : 'shipped and is ready'}. All items have been checked out and are on their way.</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Order</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeRes}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Start Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeStart}</td>
        </tr>${endDateRow}
      </table>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        Please contact us if you have any questions.
      </p>
    `),
  }
}

export function overdueReminderEmail(clientName: string, invoiceNumber: string, amountDue: string, daysOverdue: number) {
  const safeName = escapeHtml(clientName)
  const safeInvoice = escapeHtml(invoiceNumber)
  const safeAmount = escapeHtml(amountDue)
  return {
    subject: `Overdue: Invoice ${safeInvoice} - ${daysOverdue} days past due`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #dc2626; font-size: 20px;">Payment Overdue</h2>
      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">This is a reminder that the following invoice is <strong>${daysOverdue} days past due</strong>:</p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Invoice Number</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeInvoice}</td>
        </tr>
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Amount Due</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">${safeAmount}</td>
        </tr>
      </table>
      <p style="color: #3f3f46; line-height: 1.6;">
        Please arrange payment at your earliest convenience. Contact us if you have any questions.
      </p>
    `),
  }
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
  const safeName = escapeHtml(data.clientName)
  const safeRes = escapeHtml(data.reservationNumber)
  const safeStart = escapeHtml(data.startDate)
  const safeEnd = escapeHtml(data.endDate)

  // Build items table grouped by category
  let itemsHtml = ''
  for (const group of data.itemsByCategory) {
    const safeCat = escapeHtml(group.category)
    itemsHtml += `
      <tr>
        <td colspan="4" style="padding: 10px 8px 4px; font-weight: 600; color: #18181b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e4e4e7;">
          ${safeCat}
        </td>
      </tr>`

    for (const item of group.items) {
      const safeName = escapeHtml(item.name)
      const pricingLabel = escapeHtml(item.pricingType.toLowerCase())
      // Show the period count when the subtotal reflects a multi-period charge.
      // Terms rarely land on whole periods (a 6-week rental is 1.38 months), so this
      // keeps the fraction rather than rounding it away.
      const singlePeriod = item.rate * item.quantity
      const periods = singlePeriod > 0 ? item.subtotal / singlePeriod : 1
      const perUnitTerm = item.quantity > 0 ? item.subtotal / item.quantity : item.subtotal
      const periodNote = isSinglePeriod(periods)
        ? ''
        : ` &times; ${formatPeriodCount(periods)} &mdash; ${escapeHtml(formatCurrency(perUnitTerm))} each`
      itemsHtml += `
      <tr style="border-bottom: 1px solid #f4f4f5;">
        <td style="padding: 8px; color: #3f3f46; font-size: 14px;">${safeName}${periodNote ? `<br><span style="color:#71717a;font-size:12px;">${pricingLabel} rate${periodNote}</span>` : ''}</td>
        <td style="padding: 8px; color: #3f3f46; font-size: 14px; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; color: #3f3f46; font-size: 14px; text-align: right;">$${item.rate.toFixed(2)}/${pricingLabel}</td>
        <td style="padding: 8px; color: #3f3f46; font-size: 14px; text-align: right;">$${item.subtotal.toFixed(2)}</td>
      </tr>`
    }
  }

  // Totals section
  let totalsHtml = `
    <tr style="border-top: 2px solid #e4e4e7;">
      <td colspan="3" style="padding: 8px; text-align: right; color: #71717a; font-size: 14px;">Subtotal</td>
      <td style="padding: 8px; text-align: right; color: #18181b; font-size: 14px;">$${data.subtotal.toFixed(2)}</td>
    </tr>`

  if (data.taxRate > 0) {
    totalsHtml += `
    <tr>
      <td colspan="3" style="padding: 4px 8px; text-align: right; color: #71717a; font-size: 14px;">Tax (${data.taxRate}%)</td>
      <td style="padding: 4px 8px; text-align: right; color: #18181b; font-size: 14px;">$${data.taxAmount.toFixed(2)}</td>
    </tr>`
  }

  totalsHtml += `
    <tr>
      <td colspan="3" style="padding: 8px; text-align: right; font-weight: 700; color: #18181b; font-size: 16px;">Total</td>
      <td style="padding: 8px; text-align: right; font-weight: 700; color: #18181b; font-size: 16px;">$${data.total.toFixed(2)}</td>
    </tr>`

  const projectHtml = data.projectName
    ? `<tr style="border-top: 1px solid #e4e4e7;">
        <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Project</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.projectName)}</td>
      </tr>`
    : ''

  const notesHtml = data.notes
    ? `<div style="margin-top: 20px; padding: 12px; background: #f4f4f5; border-radius: 6px;">
        <p style="margin: 0 0 4px; font-weight: 600; color: #18181b; font-size: 13px;">Notes</p>
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.5;">${escapeHtml(data.notes)}</p>
      </div>`
    : ''

  return {
    subject: `Quote ${safeRes} from VFXNow`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Quote / Estimate</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px;">${safeRes}</p>

      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">Thank you for your interest. Please find your equipment rental quote below.</p>

      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Start Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeStart}</td>
        </tr>
        ${data.reservationType !== 'SALE' ? `<tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">End Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeEnd}</td>
        </tr>` : ''}
        ${projectHtml}
      </table>

      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #18181b;">
            <th style="padding: 8px; text-align: left; color: #18181b; font-size: 13px; font-weight: 600;">Item</th>
            <th style="padding: 8px; text-align: center; color: #18181b; font-size: 13px; font-weight: 600;">Qty</th>
            <th style="padding: 8px; text-align: right; color: #18181b; font-size: 13px; font-weight: 600;">Rate</th>
            <th style="padding: 8px; text-align: right; color: #18181b; font-size: 13px; font-weight: 600;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          ${totalsHtml}
        </tbody>
      </table>

      ${notesHtml}

      <p style="color: #3f3f46; line-height: 1.6; margin-top: 24px;">
        This quote is an estimate and subject to change. Please contact us to confirm your reservation or if you have any questions.
      </p>
    `),
  }
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
  const safeName = escapeHtml(data.clientName)
  const safeRes = escapeHtml(data.reservationNumber)
  const safeUrl = escapeHtml(data.quoteUrl)

  const projectHtml = data.projectName
    ? `<tr style="border-top: 1px solid #e4e4e7;">
        <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Project</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.projectName)}</td>
      </tr>`
    : ''

  const validUntilHtml = data.validUntil
    ? `<tr style="border-top: 1px solid #e4e4e7;">
        <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Valid Until</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.validUntil)}</td>
      </tr>`
    : ''

  const messageHtml = data.message
    ? `<div style="margin: 20px 0; padding: 16px; background: #f4f4f5; border-radius: 8px; border-left: 4px solid #18181b;">
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(data.message)}</p>
      </div>`
    : ''

  const packagesHtml = data.packages && data.packages.length > 1
    ? `<div style="margin: 20px 0;">
        <p style="color: #71717a; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px;">Package Options</p>
        ${data.packages.map((pkg) => `
          <div style="padding: 12px 16px; border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #18181b; font-size: 14px;">${escapeHtml(pkg.name)}</span>
            </div>
            <p style="margin: 4px 0 0; color: #71717a; font-size: 13px;">${pkg.itemCount} items — $${pkg.total.toFixed(2)}</p>
          </div>
        `).join('')}
      </div>`
    : ''

  const totalLabel = 'Estimated Total'

  return {
    subject: `Quote ${safeRes} — Review & Approve`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Equipment Quote</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px;">${safeRes}</p>

      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">We've prepared a quote for your review.${data.packages && data.packages.length > 1 ? ' We\'ve included multiple package options for you to choose from.' : ''} You can view the full details and approve it online.</p>

      ${messageHtml}

      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Start Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.startDate)}</td>
        </tr>
        ${data.reservationType !== 'SALE' ? `<tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">End Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.endDate)}</td>
        </tr>` : ''}
        ${projectHtml}
        ${validUntilHtml}
      </table>

      ${packagesHtml}

      <table style="width: 100%; margin: 0 0 20px; border-collapse: collapse;">
        <tr style="border-top: 1px solid #e4e4e7;">
          <td style="padding: 8px 0; color: #71717a; font-size: 14px;">${totalLabel}</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #18181b; font-size: 16px;">$${data.total.toFixed(2)}</td>
        </tr>
      </table>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${safeUrl}" style="background: #18181b; color: #ffffff; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; font-size: 15px;">
          View &amp; Approve Quote
        </a>
      </div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.5; text-align: center;">
        You can review the quote details, approve with your signature, or request changes — all from the link above.
      </p>
    `),
  }
}

export function quoteChangesRequestedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  changeNotes: string
}) {
  const safeName = escapeHtml(data.clientName)
  const safeRes = escapeHtml(data.reservationNumber)
  const safeNotes = escapeHtml(data.changeNotes)
  const reservationUrl = `${APP_URL}/dashboard/orders/${encodeURIComponent(data.reservationId)}`

  return {
    subject: `Action Required: ${safeName} requested changes on ${safeRes}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Quote Change Request</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px;">${safeRes}</p>

      <p style="color: #3f3f46; line-height: 1.6;"><strong>${safeName}</strong> has reviewed the quote and is requesting changes:</p>

      <div style="margin: 20px 0; padding: 16px; background: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;">
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${safeNotes}</p>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(reservationUrl)}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Reservation
        </a>
      </div>
    `),
  }
}

export function quoteApprovedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  signerName: string
  total: number
  selectedPackageName?: string
}) {
  const safeName = escapeHtml(data.clientName)
  const safeRes = escapeHtml(data.reservationNumber)
  const safeSigner = escapeHtml(data.signerName)
  const reservationUrl = `${APP_URL}/dashboard/orders/${encodeURIComponent(data.reservationId)}`

  const packageHtml = data.selectedPackageName
    ? `<p style="margin: 8px 0 0; color: #3f3f46; font-size: 14px;">
          Selected Package: <strong>${escapeHtml(data.selectedPackageName)}</strong>
        </p>`
    : ''

  return {
    subject: `Quote Approved: ${safeName} approved ${safeRes}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Quote Approved</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px;">${safeRes}</p>

      <div style="margin: 20px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
          <strong>${safeName}</strong> has approved this quote. Signed by <strong>${safeSigner}</strong>.
        </p>
        ${packageHtml}
        <p style="margin: 8px 0 0; color: #3f3f46; font-size: 14px;">
          Total: <strong>$${data.total.toFixed(2)}</strong>
        </p>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(reservationUrl)}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Reservation
        </a>
      </div>
    `),
  }
}

export function quoteDeniedEmail(data: {
  clientName: string
  reservationNumber: string
  reservationId: string
  reason?: string
}) {
  const safeName = escapeHtml(data.clientName)
  const safeRes = escapeHtml(data.reservationNumber)
  const reservationUrl = `${APP_URL}/dashboard/orders/${encodeURIComponent(data.reservationId)}`

  const reasonHtml = data.reason
    ? `<div style="margin: 20px 0; padding: 16px; background: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;">
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(data.reason)}</p>
      </div>`
    : ''

  return {
    subject: `Quote Declined: ${safeName} declined ${safeRes}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Quote Declined</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px;">${safeRes}</p>

      <p style="color: #3f3f46; line-height: 1.6;"><strong>${safeName}</strong> has declined this quote.</p>

      ${reasonHtml}

      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(reservationUrl)}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Reservation
        </a>
      </div>
    `),
  }
}

// ============================================
// SYSTEM ALERTS
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
  const safeName = escapeHtml(data.name)
  const safeSource = escapeHtml(data.source)
  const searchUrl = `${APP_URL}/dashboard/leads?search=${encodeURIComponent(data.name)}`

  let detailsHtml = `
    <tr>
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Source</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeSource}</td>
    </tr>`

  if (data.channel) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Channel</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.channel)}</td>
    </tr>`
  }

  if (data.salesRep) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Sales Rep</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.salesRep)}</td>
    </tr>`
  }

  if (data.companyName) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Company</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.companyName)}</td>
    </tr>`
  }

  if (data.email) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Email</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.email)}</td>
    </tr>`
  }

  if (data.phone) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Phone</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.phone)}</td>
    </tr>`
  }

  if (data.estimatedValue != null) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Estimated Value</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">$${Number(data.estimatedValue).toFixed(2)}</td>
    </tr>`
  }

  return {
    subject: `New Lead: ${safeName}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">New Lead Added</h2>
      <p style="color: #3f3f46; line-height: 1.6;">A new lead has been added to the pipeline:</p>
      <div style="margin: 20px 0; padding: 16px; background: #f4f4f5; border-radius: 8px;">
        <h3 style="margin: 0 0 4px; color: #18181b; font-size: 18px;">${safeName}</h3>
        ${data.companyName ? `<p style="margin: 0; color: #71717a; font-size: 14px;">${escapeHtml(data.companyName)}</p>` : ''}
      </div>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        ${detailsHtml}
      </table>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${searchUrl}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Lead
        </a>
      </div>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        This is an automated notification from VFXNow AMC.
      </p>
    `),
  }
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
  const safePoNumber = escapeHtml(data.poNumber)
  const safeVendor = escapeHtml(data.vendorName)
  const poUrl = `${APP_URL}/dashboard/purchase-orders/${data.poId}`

  let detailsHtml = `
    <tr>
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Vendor</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeVendor}</td>
    </tr>`

  if (data.orderType) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Order Type</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.orderType)}</td>
    </tr>`
  }

  detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Order Date</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.orderDate)}</td>
    </tr>`

  if (data.expectedDate) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Expected Delivery</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.expectedDate)}</td>
    </tr>`
  }

  if (data.purchaseMethod) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Purchase Method</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.purchaseMethod)}</td>
    </tr>`
  }

  detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Line Items</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${data.itemCount}</td>
    </tr>
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Total</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.total)}</td>
    </tr>`

  if (data.submittedBy) {
    detailsHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Submitted By</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.submittedBy)}</td>
    </tr>`
  }

  return {
    subject: `Purchase Order Submitted: ${safePoNumber}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">Purchase Order Submitted</h2>
      <p style="color: #3f3f46; line-height: 1.6;">A purchase order has been submitted and is ready for processing:</p>
      <div style="margin: 20px 0; padding: 16px; background: #f4f4f5; border-radius: 8px;">
        <h3 style="margin: 0 0 4px; color: #18181b; font-size: 18px;">${safePoNumber}</h3>
        <p style="margin: 0; color: #71717a; font-size: 14px;">${safeVendor}</p>
      </div>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        ${detailsHtml}
      </table>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${poUrl}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Purchase Order
        </a>
      </div>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6;">
        This is an automated notification from VFXNow AMC.
      </p>
    `),
  }
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
  const safeRes = escapeHtml(data.reservationNumber)
  const safeClient = escapeHtml(data.clientName)
  const safeStart = escapeHtml(data.startDate)
  const safeEnd = escapeHtml(data.endDate)
  const safeTotal = escapeHtml(data.total)

  // Group items by category
  const byCategory = new Map<string, { name: string; quantity: number }[]>()
  for (const item of data.items) {
    const cat = item.category || 'Other'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push({ name: item.name, quantity: item.quantity })
  }

  let itemsHtml = ''
  for (const [category, items] of byCategory) {
    itemsHtml += `
      <tr>
        <td colspan="2" style="padding: 10px 8px 4px; font-weight: 600; color: #18181b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e4e4e7;">
          ${escapeHtml(category)}
        </td>
      </tr>`
    for (const item of items) {
      itemsHtml += `
      <tr style="border-bottom: 1px solid #f4f4f5;">
        <td style="padding: 8px; color: #3f3f46; font-size: 14px;">${escapeHtml(item.name)}</td>
        <td style="padding: 8px; color: #3f3f46; font-size: 14px; text-align: center; font-weight: 600;">${item.quantity}x</td>
      </tr>`
    }
  }

  const totalItems = data.items.reduce((s, i) => s + i.quantity, 0)
  const resUrl = `${APP_URL}/dashboard/orders`

  let metaHtml = `
    <tr>
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Client</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeClient}</td>
    </tr>
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Dates</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${data.reservationType === 'SALE' ? safeStart : `${safeStart} — ${safeEnd}`}</td>
    </tr>`

  if (data.projectName) {
    metaHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Project</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.projectName)}</td>
    </tr>`
  }

  if (data.deliveryMethod) {
    metaHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Delivery</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${escapeHtml(data.deliveryMethod)}</td>
    </tr>`
  }

  metaHtml += `
    <tr style="border-top: 1px solid #e4e4e7;">
      <td style="padding: 8px 0; color: #71717a; font-size: 14px;">Total</td>
      <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #18181b;">${safeTotal}</td>
    </tr>`

  return {
    subject: `Reservation ${safeRes} Confirmed — ${totalItems} item${totalItems !== 1 ? 's' : ''} to prep`,
    html: baseLayout(`
      <div style="text-align: center; margin-bottom: 16px;">
        <div style="display: inline-block; background: #f0fdf4; border-radius: 50%; width: 48px; height: 48px; line-height: 48px; font-size: 24px;">✅</div>
      </div>
      <h2 style="margin: 0 0 4px; color: #18181b; font-size: 20px; text-align: center;">Reservation Confirmed</h2>
      <p style="color: #71717a; font-size: 14px; margin: 0 0 20px; text-align: center;">${safeRes}</p>

      <table style="width: 100%; margin: 0 0 20px; border-collapse: collapse;">
        ${metaHtml}
      </table>

      <h3 style="color: #18181b; font-size: 15px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #18181b;">Equipment to Prepare (${totalItems} item${totalItems !== 1 ? 's' : ''})</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="border-bottom: 1px solid #e4e4e7;">
            <th style="padding: 6px 8px; text-align: left; color: #71717a; font-size: 12px; font-weight: 600;">ITEM</th>
            <th style="padding: 6px 8px; text-align: center; color: #71717a; font-size: 12px; font-weight: 600;">QTY</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${resUrl}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Reservations
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 12px; text-align: center; line-height: 1.5; margin-top: 16px;">
        This is an automated notification from VFXNow AMC.<br>
        Manage notification settings in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
}

// ============================================
// INSIGHTS DIGEST EMAIL
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

export function insightsDigestEmail(data: InsightsDigestData) {
  const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: '#fef2f2', text: '#dc2626', label: 'High Priority' },
    medium: { bg: '#fffbeb', text: '#d97706', label: 'Attention' },
    low: { bg: '#f0fdf4', text: '#16a34a', label: 'Info' },
  }

  const typeIcons: Record<string, string> = {
    inventory: '📦',
    revenue: '📈',
    client: '👥',
    utilization: '📊',
    maintenance: '🔧',
    overdue: '⏰',
    seasonal: '🌡️',
    roi: '💰',
    pricing: '🏷️',
  }

  let insightsHtml = ''
  for (const insight of data.insights) {
    const colors = priorityColors[insight.priority] || priorityColors.medium
    const icon = typeIcons[insight.type] || '💡'
    const safeTitle = escapeHtml(insight.title)
    const safeDesc = escapeHtml(insight.description)

    insightsHtml += `
      <div style="margin-bottom: 16px; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden;">
        <div style="padding: 12px 16px; background: ${colors.bg}; border-bottom: 1px solid #e4e4e7;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">${icon}</span>
            <span style="font-weight: 600; color: #18181b; font-size: 15px;">${safeTitle}</span>
            <span style="margin-left: auto; background: ${colors.bg}; color: ${colors.text}; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${colors.text}33;">${colors.label}</span>
          </div>
        </div>
        <div style="padding: 12px 16px;">
          <p style="color: #3f3f46; font-size: 14px; line-height: 1.6; margin: 0;">${safeDesc}</p>
          ${insight.link ? `<a href="${APP_URL}${escapeHtml(insight.link)}" style="color: #2563eb; font-size: 13px; text-decoration: none; margin-top: 8px; display: inline-block;">View details &rarr;</a>` : ''}
        </div>
      </div>`
  }

  const s = data.summary

  return {
    subject: `AMC insights digest — ${data.insights.length} actionable insight${data.insights.length !== 1 ? 's' : ''}`,
    html: baseLayout(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #f0f9ff; border-radius: 50%; width: 56px; height: 56px; line-height: 56px; font-size: 28px; margin-bottom: 8px;">💡</div>
        <h2 style="margin: 0 0 4px; color: #18181b; font-size: 22px;">Insights digest</h2>
        <p style="color: #71717a; font-size: 14px; margin: 0;">What your AMC data flagged today</p>
      </div>

      <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Equipment</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.totalAssets} types, ${s.availableUnits}/${s.totalUnits} available</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Reservations</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.activeReservations} active</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Checkouts</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.activeCheckouts} active${s.overdueCheckouts > 0 ? `, <span style="color: #dc2626;">${s.overdueCheckouts} overdue</span>` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Revenue (paid)</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${escapeHtml(s.revenue)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Outstanding</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: ${s.outstanding !== '$0' ? '#dc2626' : '#18181b'}; font-size: 13px;">${escapeHtml(s.outstanding)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; color: #71717a; font-size: 13px;">Leads</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.leadsInPipeline} in pipeline</td>
          </tr>
        </table>
      </div>

      ${data.insights.length > 0 ? `
        <h3 style="color: #18181b; font-size: 16px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid #18181b;">Actionable Insights</h3>
        ${insightsHtml}
      ` : `
        <div style="text-align: center; padding: 24px; background: #f0fdf4; border-radius: 8px;">
          <p style="color: #16a34a; font-weight: 600; margin: 0;">All clear! No actionable insights at this time.</p>
        </div>
      `}

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${APP_URL}/dashboard" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          Open Dashboard
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 12px; text-align: center; line-height: 1.5; margin-top: 16px;">
        Generated from your VFXNow AMC data on a schedule &mdash; every figure above
        is read straight off the database.<br>
        Manage notification settings in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
}

export function systemAlertEmail(title: string, message: string) {
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  return {
    subject: `[VFXNow Alert] ${safeTitle}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #18181b; font-size: 20px;">${safeTitle}</h2>
      <p style="color: #3f3f46; line-height: 1.6;">${safeMessage}</p>
      <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin-top: 24px;">
        This is an automated system alert from VFXNow AMC.
      </p>
    `),
  }
}

// ============================================
// COVERAGE EXPIRY NOTIFICATION
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

// ============================================
// WEEKLY REPORT — WEEK AT A GLANCE
// ============================================

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
  snapshot: {
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

export function weeklyReportEmail(data: WeeklyReportData) {
  const safeWeekLabel = escapeHtml(data.weekLabel)

  // --- Last Week metrics ---
  let metricsHtml = ''
  for (const m of data.lastWeek) {
    const arrow = m.change != null && m.change !== 0
      ? m.change > 0
        ? `<span style="color: #16a34a; font-size: 12px; font-weight: 600;"> +${Math.round(m.change)}%</span>`
        : `<span style="color: #dc2626; font-size: 12px; font-weight: 600;"> ${Math.round(m.change)}%</span>`
      : ''
    metricsHtml += `
      <tr style="border-bottom: 1px solid #f4f4f5;">
        <td style="padding: 8px 12px; color: #71717a; font-size: 14px;">${escapeHtml(m.label)}</td>
        <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: #18181b; font-size: 14px;">
          ${escapeHtml(m.value)}${arrow}
        </td>
      </tr>`
  }

  // --- Week Ahead ---
  let upcomingHtml = ''
  for (const item of data.upcoming) {
    if (item.count === 0) continue
    const linkStart = item.link ? `<a href="${APP_URL}${escapeHtml(item.link)}" style="color: #2563eb; text-decoration: none;">` : ''
    const linkEnd = item.link ? '</a>' : ''
    upcomingHtml += `
      <tr style="border-bottom: 1px solid #f4f4f5;">
        <td style="padding: 8px 12px; color: #3f3f46; font-size: 14px;">${linkStart}${escapeHtml(item.label)}${linkEnd}</td>
        <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: #18181b; font-size: 14px;">${item.count}</td>
      </tr>`
  }

  // --- Insights (reuse from digest) ---
  const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: '#fef2f2', text: '#dc2626', label: 'High' },
    medium: { bg: '#fffbeb', text: '#d97706', label: 'Attention' },
    low: { bg: '#f0fdf4', text: '#16a34a', label: 'Info' },
  }
  const typeIcons: Record<string, string> = {
    inventory: '📦', revenue: '📈', client: '👥', utilization: '📊',
    maintenance: '🔧', overdue: '⏰', seasonal: '🌡️', roi: '💰', pricing: '🏷️',
  }

  let insightsHtml = ''
  for (const insight of data.insights.slice(0, 6)) {
    const colors = priorityColors[insight.priority] || priorityColors.medium
    const icon = typeIcons[insight.type] || '💡'
    insightsHtml += `
      <div style="margin-bottom: 12px; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden;">
        <div style="padding: 10px 14px; background: ${colors.bg};">
          <span style="font-size: 16px;">${icon}</span>
          <span style="font-weight: 600; color: #18181b; font-size: 14px; margin-left: 6px;">${escapeHtml(insight.title)}</span>
          <span style="float: right; background: ${colors.bg}; color: ${colors.text}; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${colors.text}33;">${colors.label}</span>
        </div>
        <div style="padding: 10px 14px;">
          <p style="color: #3f3f46; font-size: 13px; line-height: 1.5; margin: 0;">${escapeHtml(insight.description)}</p>
          ${insight.link ? `<a href="${APP_URL}${escapeHtml(insight.link)}" style="color: #2563eb; font-size: 12px; text-decoration: none; margin-top: 6px; display: inline-block;">View details &rarr;</a>` : ''}
        </div>
      </div>`
  }

  // --- Business Snapshot ---
  const s = data.snapshot

  return {
    subject: `Weekly Report — ${safeWeekLabel}`,
    html: baseLayout(`
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #eff6ff; border-radius: 50%; width: 56px; height: 56px; line-height: 56px; font-size: 28px; margin-bottom: 8px;">📊</div>
        <h2 style="margin: 0 0 4px; color: #18181b; font-size: 22px;">Weekly Report</h2>
        <p style="color: #71717a; font-size: 14px; margin: 0;">${safeWeekLabel}</p>
      </div>

      <!-- LAST WEEK -->
      <h3 style="color: #18181b; font-size: 15px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #18181b;">Last Week</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tbody>
          ${metricsHtml}
        </tbody>
      </table>

      ${upcomingHtml ? `
      <!-- WEEK AHEAD -->
      <h3 style="color: #18181b; font-size: 15px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #18181b;">Week Ahead</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tbody>
          ${upcomingHtml}
        </tbody>
      </table>
      ` : ''}

      <!-- BUSINESS SNAPSHOT -->
      <h3 style="color: #18181b; font-size: 15px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #18181b;">Business Snapshot</h3>
      <div style="background: #f4f4f5; border-radius: 8px; padding: 14px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Equipment</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.totalAssets} types, ${s.availableUnits}/${s.totalUnits} available</td>
          </tr>
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Reservations</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.activeReservations} active</td>
          </tr>
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Checkouts</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.activeCheckouts} active${s.overdueCheckouts > 0 ? `, <span style="color: #dc2626;">${s.overdueCheckouts} overdue</span>` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Revenue (paid)</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${escapeHtml(s.revenue)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Outstanding</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: ${s.outstanding !== '$0' ? '#dc2626' : '#18181b'}; font-size: 13px;">${escapeHtml(s.outstanding)}</td>
          </tr>
          <tr>
            <td style="padding: 5px 8px; color: #71717a; font-size: 13px;">Leads</td>
            <td style="padding: 5px 8px; text-align: right; font-weight: 600; color: #18181b; font-size: 13px;">${s.leadsInPipeline} in pipeline</td>
          </tr>
        </table>
      </div>

      ${insightsHtml ? `
      <!-- INSIGHTS -->
      <h3 style="color: #18181b; font-size: 15px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid #18181b;">Insights</h3>
      ${insightsHtml}
      ` : ''}

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${APP_URL}/dashboard" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          Open Dashboard
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 12px; text-align: center; line-height: 1.5; margin-top: 16px;">
        This is your automated weekly report from VFXNow AMC.<br>
        Manage notification settings in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
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

export function dailyDigestEmail(data: DailyDigestData) {
  const safeDate = escapeHtml(data.dateLabel)

  // Helper to render an order table
  const renderOrders = (orders: DailyOrderRow[], emptyMsg: string) => {
    if (orders.length === 0) {
      return `<p style="color: #a1a1aa; font-size: 13px; padding: 8px 0; margin: 0;">${escapeHtml(emptyMsg)}</p>`
    }
    let rows = ''
    for (const o of orders) {
      const project = o.projectName ? `<br><span style="color:#71717a;font-size:12px;">${escapeHtml(o.projectName)}</span>` : ''
      rows += `
        <tr style="border-bottom: 1px solid #f4f4f5;">
          <td style="padding: 8px 10px; font-size: 14px;">
            <a href="${APP_URL}${escapeHtml(o.link)}" style="color: #2563eb; text-decoration: none; font-weight: 600;">${escapeHtml(o.reservationNumber)}</a>
            ${project}
          </td>
          <td style="padding: 8px 10px; font-size: 14px; color: #3f3f46;">${escapeHtml(o.clientName)}</td>
          <td style="padding: 8px 10px; font-size: 14px; color: #3f3f46; text-align: center;">${o.itemCount}</td>
          <td style="padding: 8px 10px; font-size: 14px; color: #18181b; text-align: right; font-weight: 600;">${escapeHtml(o.total)}</td>
        </tr>`
    }
    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e4e4e7;">
            <th style="padding: 6px 10px; text-align: left; color: #71717a; font-size: 12px; font-weight: 600;">ORDER</th>
            <th style="padding: 6px 10px; text-align: left; color: #71717a; font-size: 12px; font-weight: 600;">CLIENT</th>
            <th style="padding: 6px 10px; text-align: center; color: #71717a; font-size: 12px; font-weight: 600;">ITEMS</th>
            <th style="padding: 6px 10px; text-align: right; color: #71717a; font-size: 12px; font-weight: 600;">TOTAL</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  // Action items
  let actionsHtml = ''
  const activeActions = data.actionItems.filter(a => a.count > 0)
  if (activeActions.length > 0) {
    for (const item of activeActions) {
      const color = item.urgent ? '#dc2626' : '#18181b'
      const linkStart = item.link ? `<a href="${APP_URL}${escapeHtml(item.link)}" style="color: ${color}; text-decoration: none;">` : ''
      const linkEnd = item.link ? '</a>' : ''
      actionsHtml += `
        <tr style="border-bottom: 1px solid #f4f4f5;">
          <td style="padding: 8px 10px; font-size: 14px;">${linkStart}${item.urgent ? '⚠️ ' : ''}${escapeHtml(item.label)}${linkEnd}</td>
          <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: ${color}; font-size: 14px;">${item.count}</td>
        </tr>`
    }
  }

  // Top insights (max 3)
  const priorityColors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#fef2f2', text: '#dc2626' },
    medium: { bg: '#fffbeb', text: '#d97706' },
    low: { bg: '#f0fdf4', text: '#16a34a' },
  }
  const typeIcons: Record<string, string> = {
    inventory: '📦', revenue: '📈', client: '👥', utilization: '📊',
    maintenance: '🔧', overdue: '⏰', seasonal: '🌡️', roi: '💰', pricing: '🏷️',
  }
  let insightsHtml = ''
  for (const insight of data.topInsights.slice(0, 3)) {
    const colors = priorityColors[insight.priority] || priorityColors.medium
    const icon = typeIcons[insight.type] || '💡'
    insightsHtml += `
      <div style="margin-bottom: 8px; padding: 10px 14px; background: ${colors.bg}; border-radius: 6px; border-left: 3px solid ${colors.text};">
        <span style="font-size: 14px;">${icon}</span>
        <span style="font-weight: 600; color: #18181b; font-size: 13px; margin-left: 4px;">${escapeHtml(insight.title)}</span>
        <p style="color: #3f3f46; font-size: 12px; line-height: 1.4; margin: 4px 0 0;">
          ${escapeHtml(insight.description)}
          ${insight.link ? ` <a href="${APP_URL}${escapeHtml(insight.link)}" style="color: #2563eb; text-decoration: none;">View &rarr;</a>` : ''}
        </p>
      </div>`
  }

  const s = data.snapshot

  return {
    subject: `Daily Digest — ${safeDate}`,
    html: baseLayout(`
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0 0 4px; color: #18181b; font-size: 20px;">Daily Digest</h2>
        <p style="color: #71717a; font-size: 14px; margin: 0;">${safeDate}</p>
      </div>

      <!-- QUICK STATS BAR -->
      <div style="background: #f4f4f5; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 3px 6px; color: #71717a; font-size: 12px;">Active Orders</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 600; color: #18181b; font-size: 12px;">${s.activeReservations}</td>
            <td style="padding: 3px 6px; color: #71717a; font-size: 12px;">Checkouts</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 600; color: #18181b; font-size: 12px;">${s.activeCheckouts}${s.overdueCheckouts > 0 ? ` <span style="color:#dc2626;">(${s.overdueCheckouts} overdue)</span>` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 3px 6px; color: #71717a; font-size: 12px;">Available</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 600; color: #18181b; font-size: 12px;">${s.availableUnits}/${s.totalUnits} units</td>
            <td style="padding: 3px 6px; color: #71717a; font-size: 12px;">Outstanding</td>
            <td style="padding: 3px 6px; text-align: right; font-weight: 600; color: ${s.outstanding !== '$0' ? '#dc2626' : '#18181b'}; font-size: 12px;">${escapeHtml(s.outstanding)}</td>
          </tr>
        </table>
      </div>

      ${data.reservationsStarting.length > 0 ? `
      <!-- STARTING TODAY -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid #18181b;">Orders Starting Today</h3>
      <div style="margin-bottom: 20px;">${renderOrders(data.reservationsStarting, 'None')}</div>
      ` : ''}

      ${data.shipping.length > 0 ? `
      <!-- SHIPPING TODAY -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid #2563eb;">Shipping / Delivering Today</h3>
      <div style="margin-bottom: 20px;">${renderOrders(data.shipping, 'None')}</div>
      ` : ''}

      ${data.returnsDue.length > 0 ? `
      <!-- RETURNS DUE -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid #d97706;">Returns Due Today</h3>
      <div style="margin-bottom: 20px;">${renderOrders(data.returnsDue, 'None')}</div>
      ` : ''}

      ${actionsHtml ? `
      <!-- ACTION ITEMS -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid #dc2626;">Action Items</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tbody>${actionsHtml}</tbody>
      </table>
      ` : ''}

      ${insightsHtml ? `
      <!-- TOP INSIGHTS -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid #18181b;">Top Insights</h3>
      <div style="margin-bottom: 20px;">${insightsHtml}</div>
      ` : ''}

      <div style="text-align: center; margin: 20px 0 8px;">
        <a href="${APP_URL}/dashboard" style="background: #18181b; color: #ffffff; padding: 10px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block; font-size: 14px;">
          Open Dashboard
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 11px; text-align: center; line-height: 1.4; margin-top: 12px;">
        Daily digest from VFXNow AMC. Manage in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
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

export function dailyTrafficReportEmail(data: DailyTrafficReportData) {
  const safeDate = escapeHtml(data.dateLabel)
  const safeWindow = escapeHtml(data.windowLabel)

  const renderClientSection = (groups: TrafficReportClientGroup[], emptyMsg: string) => {
    if (groups.length === 0) {
      return `<p style="color: #a1a1aa; font-size: 13px; padding: 8px 0; margin: 0;">${escapeHtml(emptyMsg)}</p>`
    }
    let html = ''
    for (const group of groups) {
      let rows = ''
      for (const u of group.units) {
        rows += `
          <tr style="border-bottom: 1px solid #f4f4f5;">
            <td style="padding: 6px 10px; font-size: 13px; color: #71717a; white-space: nowrap;">${escapeHtml(u.time)}</td>
            <td style="padding: 6px 10px; font-size: 13px; font-family: 'Courier New', monospace; color: #18181b; white-space: nowrap;">${escapeHtml(u.barcode)}</td>
            <td style="padding: 6px 10px; font-size: 13px; color: #3f3f46;">${escapeHtml(u.assetName)}</td>
            <td style="padding: 6px 10px; font-size: 13px; text-align: right;">
              <a href="${APP_URL}/dashboard/orders/${escapeHtml(u.reservationId)}" style="color: #2563eb; text-decoration: none; font-weight: 600;">${escapeHtml(u.reservationNumber)}</a>
            </td>
          </tr>`
      }
      html += `
        <div style="margin-bottom: 16px;">
          <div style="background: #f4f4f5; padding: 6px 10px; border-radius: 4px 4px 0 0;">
            <span style="font-weight: 600; color: #18181b; font-size: 13px;">${escapeHtml(group.clientName)}</span>
            <span style="color: #71717a; font-size: 12px; margin-left: 6px;">(${group.units.length} ${group.units.length === 1 ? 'unit' : 'units'})</span>
          </div>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #e4e4e7; border-top: none;">
            <tbody>${rows}</tbody>
          </table>
        </div>`
    }
    return html
  }

  return {
    subject: `Daily Traffic Report — ${safeDate}`,
    html: baseLayout(`
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="margin: 0 0 4px; color: #18181b; font-size: 20px;">Daily Traffic Report</h2>
        <p style="color: #71717a; font-size: 14px; margin: 0;">${safeDate}</p>
        <p style="color: #a1a1aa; font-size: 12px; margin: 2px 0 0;">${safeWindow}</p>
      </div>

      <!-- TOTALS BAR -->
      <div style="background: #f4f4f5; border-radius: 8px; padding: 12px 14px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #18181b;">${data.totals.clientsTouched}</div>
              <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Clients</div>
            </td>
            <td style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #16a34a;">${data.totals.unitsOut}</div>
              <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Checked Out</div>
            </td>
            <td style="text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #2563eb;">${data.totals.unitsIn}</div>
              <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Checked In</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- CHECK-OUTS -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 10px; padding-bottom: 5px; border-bottom: 2px solid #16a34a;">
        Items Checked Out Today
      </h3>
      <div style="margin-bottom: 24px;">${renderClientSection(data.out, 'No items checked out during this window.')}</div>

      <!-- CHECK-INS -->
      <h3 style="color: #18181b; font-size: 14px; margin: 0 0 10px; padding-bottom: 5px; border-bottom: 2px solid #2563eb;">
        Items Returned Today
      </h3>
      <div style="margin-bottom: 24px;">${renderClientSection(data.back, 'No items returned during this window.')}</div>

      <div style="text-align: center; margin: 20px 0 8px;">
        <a href="${APP_URL}/dashboard/reports/traffic" style="background: #18181b; color: #ffffff; padding: 10px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block; font-size: 14px;">
          Open Traffic Report
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 11px; text-align: center; line-height: 1.4; margin-top: 12px;">
        Sent daily at 5:00 PM PT. Manage recipients in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
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
  const safeName = escapeHtml(data.clientName)
  const safeUrl = escapeHtml(data.uploadUrl)

  const requirementsList = data.requirementTypes
    .map((t) => {
      if (t === 'ID') return '<li style="margin-bottom: 4px;">Photo ID (front and back)</li>'
      if (t === 'COI') return '<li style="margin-bottom: 4px;">Certificate of Insurance (COI)</li>'
      if (t === 'AGREEMENT') return '<li style="margin-bottom: 4px;">Rental Agreement (review &amp; sign)</li>'
      return ''
    })
    .join('')

  const messageHtml = data.message
    ? `<div style="margin: 20px 0; padding: 16px; background: #f4f4f5; border-radius: 8px; border-left: 4px solid #18181b;">
        <p style="margin: 0; color: #3f3f46; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(data.message)}</p>
      </div>`
    : ''

  return {
    subject: 'VFXNow — Document Upload Required',
    html: baseLayout(`
      <h2 style="margin: 0 0 8px; color: #18181b; font-size: 20px;">Documents Required</h2>

      <p style="color: #3f3f46; line-height: 1.6;">Hi ${safeName},</p>
      <p style="color: #3f3f46; line-height: 1.6;">We need the following documents to complete your file:</p>

      <ul style="color: #3f3f46; line-height: 1.8; padding-left: 20px; margin: 16px 0;">
        ${requirementsList}
      </ul>

      ${messageHtml}

      <p style="color: #3f3f46; line-height: 1.6;">Please use the secure link below to upload your documents. This link will expire in 30 days.</p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${safeUrl}" style="background: #18181b; color: #ffffff; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; font-size: 15px;">
          Upload Documents
        </a>
      </div>

      <p style="color: #a1a1aa; font-size: 12px; text-align: center; line-height: 1.5; margin-top: 16px;">
        This is a secure link. Do not share it with others.
      </p>
    `),
  }
}

export function coverageExpiryEmail(data: CoverageExpiryEmailData) {
  let itemsHtml = ''
  for (const item of data.items) {
    const safeBarcode = escapeHtml(item.unitBarcode)
    const safeAsset = escapeHtml(item.assetName)
    const safeName = escapeHtml(item.coverageName)
    const safeType = escapeHtml(item.coverageType)
    const safeEnd = escapeHtml(item.endDate)
    const urgencyColor = item.daysRemaining <= 7 ? '#dc2626' : item.daysRemaining <= 14 ? '#d97706' : '#71717a'

    itemsHtml += `
      <tr style="border-bottom: 1px solid #f4f4f5;">
        <td style="padding: 8px; font-size: 14px;">
          <span style="font-weight: 600; color: #18181b;">${safeAsset}</span>
          <br><span style="font-family: monospace; color: #71717a; font-size: 12px;">${safeBarcode}</span>
        </td>
        <td style="padding: 8px; font-size: 14px; color: #3f3f46;">
          ${safeName}
          <br><span style="color: #71717a; font-size: 12px;">${safeType}${item.provider ? ` &mdash; ${escapeHtml(item.provider)}` : ''}</span>
        </td>
        <td style="padding: 8px; font-size: 14px; text-align: right;">
          <span style="color: ${urgencyColor}; font-weight: 600;">${item.daysRemaining} day${item.daysRemaining !== 1 ? 's' : ''}</span>
          <br><span style="color: #71717a; font-size: 12px;">${safeEnd}</span>
        </td>
      </tr>`
  }

  return {
    subject: `Coverage Alert: ${data.items.length} service coverage${data.items.length !== 1 ? 's' : ''} expiring soon`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px; color: #d97706; font-size: 20px;">Service Coverage Expiring</h2>
      <p style="color: #3f3f46; line-height: 1.6;">
        The following service coverages are expiring within 30 days and may need renewal:
      </p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #18181b;">
            <th style="padding: 8px; text-align: left; color: #18181b; font-size: 13px; font-weight: 600;">Unit</th>
            <th style="padding: 8px; text-align: left; color: #18181b; font-size: 13px; font-weight: 600;">Coverage</th>
            <th style="padding: 8px; text-align: right; color: #18181b; font-size: 13px; font-weight: 600;">Remaining</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${APP_URL}/dashboard/assets" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Assets
        </a>
      </div>
      <p style="color: #a1a1aa; font-size: 12px; text-align: center; line-height: 1.5; margin-top: 16px;">
        This is an automated notification from VFXNow AMC.<br>
        Manage notification settings in Dashboard &rarr; Settings &rarr; Notifications.
      </p>
    `),
  }
}

// ============================================
// FLOW TASK EMAILS
// ============================================

export function taskAssignedEmail(
  assigneeName: string,
  taskTitle: string,
  taskId: string,
  priority: string,
  dueDate?: string,
) {
  const safeName = escapeHtml(assigneeName)
  const safeTitle = escapeHtml(taskTitle)
  const priorityColors: Record<string, string> = {
    LOW: '#22c55e',
    MEDIUM: '#3b82f6',
    HIGH: '#f59e0b',
    URGENT: '#ef4444',
  }
  const color = priorityColors[priority] || '#3b82f6'

  return {
    subject: `Task Assigned: ${taskTitle}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #18181b;">Task Assigned to You</h2>
      <p style="color: #52525b; line-height: 1.5;">Hi ${safeName},</p>
      <p style="color: #52525b; line-height: 1.5;">A task has been assigned to you:</p>
      <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #18181b;">${safeTitle}</p>
        <p style="margin: 0 0 4px; font-size: 13px; color: #71717a;">
          Priority: <span style="color: ${color}; font-weight: 600;">${escapeHtml(priority)}</span>
        </p>
        ${dueDate ? `<p style="margin: 0; font-size: 13px; color: #71717a;">Due: ${escapeHtml(dueDate)}</p>` : ''}
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${APP_URL}/dashboard/flow?task=${escapeHtml(taskId)}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Task
        </a>
      </div>
    `),
  }
}

export function taskStatusChangedEmail(
  recipientName: string,
  taskTitle: string,
  taskId: string,
  fromStatus: string,
  toStatus: string,
) {
  const safeName = escapeHtml(recipientName)
  const safeTitle = escapeHtml(taskTitle)
  const safeFrom = escapeHtml(fromStatus.replace(/_/g, ' '))
  const safeTo = escapeHtml(toStatus.replace(/_/g, ' '))

  return {
    subject: `Task Updated: ${taskTitle}`,
    html: baseLayout(`
      <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #18181b;">Task Update</h2>
      <p style="color: #52525b; line-height: 1.5;">Hi ${safeName},</p>
      <p style="color: #52525b; line-height: 1.5;">A task you're assigned to has been updated:</p>
      <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #18181b;">${safeTitle}</p>
        <p style="margin: 0; font-size: 13px; color: #71717a;">
          ${safeFrom} &rarr; <strong>${safeTo}</strong>
        </p>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${APP_URL}/dashboard/flow?task=${escapeHtml(taskId)}" style="background: #18181b; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          View Task
        </a>
      </div>
    `),
  }
}
