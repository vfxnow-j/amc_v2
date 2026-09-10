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
    // Bounded for the same reason HubSpot's calls are: a click-to-call that
    // hangs is a person watching a button spin with nothing to cancel.
    signal: AbortSignal.timeout(8_000),
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
 * Verifying that a call event really came from JustCall.
 *
 * v1's version had a real bug: `crypto.timingSafeEqual` **throws** when the two
 * buffers are different lengths, and a wrong-length signature is precisely what
 * an attacker — or a misconfigured header — sends. v1 caught nothing, so the
 * route's try/catch turned it into a 500: an unauthenticated caller could make
 * this endpoint error at will, and the logs blamed the server. Length is
 * checked first here and a mismatch is a plain `false`.
 *
 * Two ways in, both keyed on the same `justcall_webhook_secret` row:
 *
 *  - **A signature** over the exact body — HMAC-SHA256, hex or base64,
 *    whichever the sender used. This is the one to prefer.
 *  - **A shared secret in a header**, because JustCall's webhook configuration
 *    does not offer request signing on every plan, and the alternative to
 *    accepting a header is an endpoint nobody can turn on. Same discipline as
 *    the Zapier route: a header, never a query string.
 *
 * With no secret stored, both refuse, and the route is inert.
 */

export type JustCallVerdict =
  | { ok: true; via: 'signature' | 'shared-secret' }
  | { ok: false; reason: 'unconfigured' | 'unsigned' | 'mismatch' }

function sameDigest(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function verifyJustCallRequest(input: {
  body: string
  signature?: string | null
  sharedSecret?: string | null
}): Promise<JustCallVerdict> {
  const config = await getConfig()
  if (!config.webhookSecret) return { ok: false, reason: 'unconfigured' }

  const signature = input.signature?.trim()
  if (signature) {
    const hmac = crypto.createHmac('sha256', config.webhookSecret).update(input.body)
    const hex = hmac.digest('hex')
    const base64 = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(input.body)
      .digest('base64')

    if (sameDigest(signature.toLowerCase(), hex) || sameDigest(signature, base64)) {
      return { ok: true, via: 'signature' }
    }
    return { ok: false, reason: 'mismatch' }
  }

  const shared = input.sharedSecret?.trim()
  if (!shared) return { ok: false, reason: 'unsigned' }

  return sameDigest(shared, config.webhookSecret)
    ? { ok: true, via: 'shared-secret' }
    : { ok: false, reason: 'mismatch' }
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
