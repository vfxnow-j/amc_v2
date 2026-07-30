import { Resend } from 'resend'

/**
 * The Resend client, constructed on first use rather than at import.
 *
 * `new Resend(undefined)` throws — and this module is reachable from
 * `lib/actions/reservations`, so building it eagerly took down every server
 * action in that graph the moment the key was absent. v2 leaves outbound
 * integrations deliberately blank (see .env.example), so "no key" is the normal
 * state here, not an error state: check-out has to work whether or not the app
 * can send email.
 *
 * A missing key now fails the individual send, in `lib/email/send.ts`, which is
 * the only place that can do anything sensible about it.
 */

let client: Resend | null = null

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is not set, so this email cannot be sent. Outbound email is switched off in this instance.'
    )
  }
  client ??= new Resend(process.env.RESEND_API_KEY)
  return client
}

export const EMAIL_FROM = process.env.EMAIL_FROM || 'VFXNow AMC <noreply@example.com>'
export const APP_URL = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3001'
