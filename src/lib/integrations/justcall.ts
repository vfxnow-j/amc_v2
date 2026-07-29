import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { findMatchingLead, mergeIntoLead } from '@/lib/actions/leads'
import { notifyNewLead } from '@/lib/actions/notifications'

async function getConfig() {
  const [apiKey, apiSecret, webhookSecret] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'justcall_api_key' } }),
    prisma.setting.findUnique({ where: { key: 'justcall_api_secret' } }),
    prisma.setting.findUnique({ where: { key: 'justcall_webhook_secret' } }),
  ])

  return {
    apiKey: apiKey?.value as string | null,
    apiSecret: apiSecret?.value as string | null,
    webhookSecret: webhookSecret?.value as string | null,
  }
}

async function justcallFetch(endpoint: string, options: RequestInit = {}) {
  const config = await getConfig()
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('JustCall API credentials not configured')
  }

  const response = await fetch(`https://api.justcall.io/v1${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `${config.apiKey}:${config.apiSecret}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`JustCall API error: ${response.status} ${text}`)
  }

  return response.json()
}

/**
 * Initiate a click-to-call via JustCall API.
 */
export async function initiateCall(phoneNumber: string) {
  return justcallFetch('/calls/make', {
    method: 'POST',
    body: JSON.stringify({ to: phoneNumber }),
  })
}

/**
 * Get call history for a phone number.
 */
export async function getCallHistory(phone: string) {
  return justcallFetch(`/calls/list?phone=${encodeURIComponent(phone)}`)
}

/**
 * Verify JustCall webhook signature.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string
): Promise<boolean> {
  const config = await getConfig()
  if (!config.webhookSecret) return false

  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(payload)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

/**
 * Process a JustCall call event webhook.
 * Finds or creates a lead by phone number, then creates a CALL activity.
 */
export async function processCallEvent(event: {
  type: string
  data: {
    contact_name?: string
    contact_number?: string
    duration?: number
    recording_url?: string
    direction?: string
    status?: string
  }
}) {
  const phone = event.data.contact_number
  if (!phone) return

  const contactName = event.data.contact_name || `Caller ${phone}`

  // Central dedup — match by phone, name, or other fields
  let lead = await findMatchingLead({ name: contactName, phone })

  const callDirection = event.data.direction === 'inbound' ? 'Inbound' : 'Outbound'
  const channelLabel = `${callDirection} Call (JustCall)`

  if (lead) {
    // Merge — advance to CONTACTED if they called
    await mergeIntoLead(lead.id, {
      phone,
      source: 'JUSTCALL',
      channel: channelLabel,
    }, {
      suggestedStatus: 'CONTACTED',
      activityTitle: `${callDirection} call matched`,
      activityDescription: `Call via JustCall (${phone})`,
    })
    // Refresh lead data after merge
    lead = (await prisma.lead.findUnique({ where: { id: lead.id } }))!
  } else {
    // Create new lead
    lead = await prisma.lead.create({
      data: {
        name: contactName,
        phone,
        source: 'JUSTCALL',
        channel: channelLabel,
        status: 'CONTACTED',
        justcallContactId: phone,
      },
    })

    // Notify all users of new lead (fire-and-forget)
    notifyNewLead(lead).catch(() => {})
  }

  // Create call activity
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'CALL',
      title: `${event.data.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`,
      description: event.data.status === 'completed'
        ? `Call duration: ${event.data.duration || 0}s`
        : `Call ${event.data.status || 'recorded'}`,
      metadata: {
        duration: event.data.duration,
        recordingUrl: event.data.recording_url,
        direction: event.data.direction,
        status: event.data.status,
      },
    },
  })

  return lead
}
