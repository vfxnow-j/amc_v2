import { resend, EMAIL_FROM } from './client'

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
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
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
