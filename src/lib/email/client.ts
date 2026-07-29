import { Resend } from 'resend'

if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY is not set. Email sending will fail.')
}

export const resend = new Resend(process.env.RESEND_API_KEY)
export const EMAIL_FROM = process.env.EMAIL_FROM || 'VFXNow AMC <noreply@example.com>'
export const APP_URL = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
