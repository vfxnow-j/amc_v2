import { getResend, isEmailConfigured, EMAIL_FROM } from './client'
import { htmlToText, LOGO_CID } from './layout'
import { approvalProblem, isStaffAddress } from './approval'

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
 * A label on every subject while this instance is a stand-in for the live one
 * ("AMC v2"), so v2 mail is never mistaken for v1's in an inbox. Unset it when
 * v2 becomes the production system.
 */
function subjectTag(): string | null {
  const value = process.env.EMAIL_SUBJECT_TAG?.trim()
  return value ? value : null
}

/**
 * Addresses that always get their mail for real, even while the redirect is on:
 * the people actually using this instance, who need their sign-in codes and
 * password resets delivered to them and not to the tester. A message goes direct
 * only if every one of its recipients is listed — one customer on the To: line
 * and the whole message is redirected. An entry like `@vfxnow.com` lists a whole
 * domain.
 */
function allDirect(to: string | string[]): boolean {
  const recipients = Array.isArray(to) ? to : [to]
  return (process.env.EMAIL_DIRECT_ALLOW ?? '').trim() !== '' && recipients.length > 0 && recipients.every(isStaffAddress)
}

/**
 * Apply the subject tag and the redirect to one message. Returns it unchanged
 * when neither is configured, so the production path costs nothing.
 */
export function applyTestRedirect<T extends { to: string | string[]; subject: string; html: string; text?: string }>(
  message: T,
): T {
  const tag = subjectTag()
  const tagged = tag ? `[${tag}] ${message.subject}` : message.subject
  const target = redirectTo()
  if (!target || allDirect(message.to)) return { ...message, subject: tagged }
  return {
    ...message,
    to: target,
    subject: `${tag ? `[${tag}] ` : ''}[test → ${describe(message.to)}] ${message.subject}`,
    html: withBanner(message.html, message.to),
    // The plain-text part says it too: a client that shows text only must not
    // read a redirected message as the real thing.
    ...(message.text !== undefined
      ? { text: `[Test send. In production this would have gone to ${describe(message.to)}.]\n\n${message.text}` }
      : {}),
  }
}

/**
 * Put the banner inside <body> rather than before <!DOCTYPE>. Every template is
 * a whole document now, and markup ahead of the doctype is invalid; it would
 * also be the first text in the message, so the inbox preview would show the
 * banner instead of the layout's preheader. After the preheader would hide it
 * from the preview entirely, which is wrong the other way — so it goes first
 * in the body, where the preview reads "Test send…" and says so.
 */
function withBanner(html: string, originalTo: string | string[]): string {
  const at = html.search(/<body[^>]*>/i)
  if (at === -1) return banner(originalTo) + html
  const end = html.indexOf('>', at) + 1
  return `${html.slice(0, end)}<div style="max-width:680px;margin:12px auto 0;padding:0 12px;">${banner(originalTo)}</div>${html.slice(end)}`
}

/** The plain-text part: what the caller gave, or derived from the HTML. */
function textFor(message: { html: string; text?: string }): string {
  return message.text ?? htmlToText(message.html)
}

export type EmailAttachment = {
  filename: string
  content: Buffer | string
  contentType?: string
  /** Makes it inline: referenced from the HTML as `cid:<contentId>`. */
  contentId?: string
}

/**
 * The header logo. It used to ride along as an inline (cid) attachment, and the
 * mail system at vfxnow.com dropped every message that carried one — sign-in
 * codes included — while the same message without it arrived. So nothing is
 * attached now:
 *
 *   - EMAIL_LOGO_URL set: the cid points at that URL, which must be public.
 *   - unset: the image is replaced by a text wordmark, styled by the cell around
 *     it, so the header band is never empty.
 */
export function resolveLogo(html: string): string {
  if (!html.includes(`cid:${LOGO_CID}`)) return html
  const url = process.env.EMAIL_LOGO_URL?.trim()
  if (url) return html.split(`cid:${LOGO_CID}`).join(url)
  return html.replace(new RegExp(`<img[^>]*cid:${LOGO_CID}[^>]*>`, 'g'), 'VFXnow')
}

export type SendEmailParams = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  attachments?: EmailAttachment[]
  /**
   * 'client' marks mail meant for a customer. Such mail goes only to an address
   * an admin has approved (lib/email/approval). Mail to a known client or
   * contact address is gated even without it.
   */
  audience?: 'client'
  /**
   * The client this mail is about. When given, the address must be on that
   * client's own record: an address approved for a different client is refused.
   */
  clientId?: string
}

export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  // Outbound email is switched off in this instance by design; say so and let
  // the caller carry on rather than throwing through it.
  if (!isEmailConfigured()) {
    console.warn(`Email not sent (no RESEND_API_KEY): "${params.subject}"`)
    return { success: false, error: 'Outbound email is switched off in this instance.' }
  }

  const problem = await approvalProblem(params.to, params.audience, params.clientId)
  if (problem) {
    console.warn(`Email not sent (${problem}): "${params.subject}"`)
    return { success: false, error: problem }
  }

  const routed = applyTestRedirect({
    to: params.to,
    subject: params.subject,
    html: resolveLogo(params.html),
    text: textFor(params),
  })

  try {
    const { error } = await getResend().emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(routed.to) ? routed.to : [routed.to],
      subject: routed.subject,
      html: routed.html,
      text: routed.text,
      replyTo: params.replyTo,
      attachments: (params.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content as any,
        contentType: a.contentType,
        ...(a.contentId ? { contentId: a.contentId } : {}),
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
  /** Derived from the HTML when omitted. */
  text?: string
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

  // Batches go to staff recipient lists, but a client address in one is still
  // held to the approval rule.
  const refused: string[] = []
  const allowed: BatchMessage[] = []
  for (const message of messages) {
    const problem = await approvalProblem(message.to)
    if (problem) refused.push(problem)
    else allowed.push(message)
  }
  if (refused.length > 0) {
    console.warn(`Batch: ${refused.length} message(s) held back: ${refused[0]}`)
    if (allowed.length === 0) return { success: false, error: refused[0] }
    const rest = await sendBatch(allowed)
    return rest.success ? { success: false, error: `${refused.length} of ${messages.length} held back: ${refused[0]}` } : rest
  }

  // A batch of layout mail goes one message at a time through `sendEmail`,
  // which resolves the logo and applies the redirect. The batch sizes here are a
  // recipient list — a handful — so the extra calls cost nothing that matters.
  if (messages.some((message) => message.html.includes(`cid:${LOGO_CID}`))) {
    let failed = 0
    let firstError: string | undefined
    for (const message of messages) {
      const result = await sendEmail({ to: message.to, subject: message.subject, html: message.html, text: message.text })
      if (!result.success) {
        failed += 1
        firstError ??= result.error
      }
    }
    return failed === 0 ? { success: true } : { success: false, error: `${failed} of ${messages.length} failed: ${firstError}` }
  }

  // Redirected messages all land at the same address, so a batch of six
  // notifications becomes six copies to the tester. That is the intent: the
  // point of a test send is seeing what each recipient would have got.
  const routed = messages.map((message) => ({
    ...applyTestRedirect({ ...message, text: textFor(message) }),
    from: message.from ?? EMAIL_FROM,
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
