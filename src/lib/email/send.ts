import { getResend, isEmailConfigured, EMAIL_FROM } from './client'

/**
 * Where every outbound email goes instead of its real recipient.
 *
 * This instance runs on a restored copy of the live database: 49 real client
 * addresses, and staff addresses configured as notification recipients. Turning
 * a Resend key on without this means the first person to press "Send quote" on
 * a test order emails an actual customer a quote from a half-built system.
 *
 * So while EMAIL_TEST_REDIRECT is set, nothing reaches its addressee. The mail
 * is still composed, still sent, still visible in Resend — only the To: is
 * swapped, and the original recipient is named in the subject and in a banner
 * at the top of the body, so a test tells you exactly who would have received
 * it in production.
 *
 * Unset it to send for real. That is deliberately a change to the environment
 * rather than a checkbox in the UI: nothing about clicking around the app
 * should be able to start mailing customers.
 */
function redirectTo(): string | null {
  const value = process.env.EMAIL_TEST_REDIRECT?.trim()
  return value ? value : null
}

function describe(to: string | string[]): string {
  return Array.isArray(to) ? to.join(', ') : to
}

const BANNER_STYLE =
  'background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 14px;margin:0 0 16px;font:14px/1.5 system-ui,sans-serif;color:#78350f'

/** Says who this would have gone to, at the top of the message. */
function banner(originalTo: string | string[]): string {
  return `<div style="${BANNER_STYLE}"><strong>Test send.</strong> In production this would have gone to <strong>${describe(
    originalTo,
  )}</strong>. It was redirected here because EMAIL_TEST_REDIRECT is set on this instance.</div>`
}

/**
 * Apply the redirect to one message. Returns it unchanged when no redirect is
 * configured, so the production path costs nothing.
 */
export function applyTestRedirect<T extends { to: string | string[]; subject: string; html: string }>(
  message: T,
): T {
  const target = redirectTo()
  if (!target) return message
  return {
    ...message,
    to: target,
    subject: `[test → ${describe(message.to)}] ${message.subject}`,
    html: banner(message.to) + message.html,
  }
}

export type EmailAttachment = {
  filename: string
  content: Buffer | string
  contentType?: string
}

export type SendEmailParams = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: EmailAttachment[]
}

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  // Outbound email is switched off in this instance by design; say so and let
  // the caller carry on rather than throwing through it.
  if (!isEmailConfigured()) {
    console.warn(`Email not sent (no RESEND_API_KEY): "${params.subject}"`)
    return { success: false, error: 'Outbound email is switched off in this instance.' }
  }

  const routed = applyTestRedirect({
    to: params.to,
    subject: params.subject,
    html: params.html,
  })

  try {
    const { error } = await getResend().emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(routed.to) ? routed.to : [routed.to],
      subject: routed.subject,
      html: routed.html,
      text: params.text,
      replyTo: params.replyTo,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content as any,
        contentType: a.contentType,
      })),
    })

    if (error) {
      console.error('Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    console.error('Email send failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export type BatchMessage = {
  from?: string
  to: string | string[]
  subject: string
  html: string
}

/**
 * Send several messages in one call, with the same protection.
 *
 * `lib/actions/notifications` reached for `getResend().batch.send` directly in
 * eight places, which meant it went around `sendEmail` entirely — and so around
 * the "is email even configured" check and, more to the point, around the test
 * redirect. Every one of those eight is a notification addressed to real staff
 * recipients read out of the restored database. A guard that only covers
 * `sendEmail` is not a guard.
 */
export async function sendBatch(
  messages: BatchMessage[],
): Promise<{ success: boolean; error?: string }> {
  if (messages.length === 0) return { success: true }

  if (!isEmailConfigured()) {
    console.warn(
      `Batch not sent (no RESEND_API_KEY): ${messages.length} × "${messages[0].subject}"`,
    )
    return { success: false, error: 'Outbound email is switched off in this instance.' }
  }

  // Redirected messages all land at the same address, so a batch of six
  // notifications becomes six copies to the tester. That is the intent: the
  // point of a test send is seeing what each recipient would have got.
  const routed = messages.map((message) => ({
    from: message.from ?? EMAIL_FROM,
    ...applyTestRedirect(message),
  }))

  try {
    const { error } = await getResend().batch.send(routed)
    if (error) {
      console.error('Resend batch error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    console.error('Batch send failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
