import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { notifyNewLead } from '@/lib/actions/notifications'

async function getConfig() {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          'hubspot_access_token',
          'hubspot_webhook_secret',
          'hubspot_enabled',
          'hubspot_pipeline_rental',
          'hubspot_pipeline_sale',
          'hubspot_pipeline_rto',
          'hubspot_pipeline_cloud',
        ],
      },
    },
  })

  const map = new Map(rows.map((r) => [r.key, r.value]))

  return {
    accessToken: (map.get('hubspot_access_token') as string) || null,
    webhookSecret: (map.get('hubspot_webhook_secret') as string) || null,
    enabled: map.get('hubspot_enabled') === true,
    pipelines: {
      RENTAL: (map.get('hubspot_pipeline_rental') as string) || 'default',
      SALE: (map.get('hubspot_pipeline_sale') as string) || 'default',
      RENT_TO_OWN: (map.get('hubspot_pipeline_rto') as string) || 'default',
      CLOUD: (map.get('hubspot_pipeline_cloud') as string) || 'default',
    } as Record<string, string>,
  }
}

/**
 * How long any one HubSpot call may take.
 *
 * Every caller here is a side effect of something that has already been
 * written — a lead exists, an order moved — so the worst case must be bounded.
 * Without this, `fetch` waits on the OS default and a HubSpot outage becomes a
 * hung save on somebody's screen.
 */
const HUBSPOT_TIMEOUT_MS = 8_000

async function hubspotFetch(endpoint: string, options: RequestInit = {}) {
  const config = await getConfig()
  if (!config.accessToken) {
    throw new Error('HubSpot access token not configured')
  }

  const response = await fetch(`https://api.hubapi.com${endpoint}`, {
    signal: AbortSignal.timeout(HUBSPOT_TIMEOUT_MS),
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HubSpot API error: ${response.status} ${text}`)
  }

  return response.json()
}

/**
 * Sync a lead to HubSpot as a contact.
 */
export async function syncContactToHubSpot(lead: {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  companyName?: string | null
  hubspotContactId?: string | null
}) {
  const config = await getConfig()
  if (!config.enabled || !config.accessToken) return null

  const nameParts = lead.name.split(' ')
  const properties: Record<string, string> = {
    firstname: nameParts[0] || '',
    lastname: nameParts.slice(1).join(' ') || '',
  }
  if (lead.email) properties.email = lead.email
  if (lead.phone) properties.phone = lead.phone
  if (lead.companyName) properties.company = lead.companyName

  if (lead.hubspotContactId) {
    // Update existing contact
    await hubspotFetch(`/crm/v3/objects/contacts/${lead.hubspotContactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    })
    return lead.hubspotContactId
  } else {
    // Create new contact
    const result = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    })

    // Store HubSpot ID on lead
    await prisma.lead.update({
      where: { id: lead.id },
      data: { hubspotContactId: result.id },
    })

    return result.id as string
  }
}

/**
 * The outbound half, made safe to call from a path that must not fail.
 *
 * `syncContactToHubSpot` throws — the token can be missing, HubSpot can be
 * down, the API can refuse the properties — and creating a lead must not
 * depend on any of that. A lead is somebody who rang; it exists whether or not
 * a CRM in another company's datacentre agrees. So this never throws, never
 * retries, and answers with what happened.
 *
 * **Gated twice, and both gates are configuration.** `hubspot_enabled` has to
 * be on and `hubspot_access_token` has to be set, and with either missing this
 * returns before it opens a socket. That matters more than usual here: whether
 * v2 should be writing to the live HubSpot at all is an open decision, and
 * until somebody makes it, the answer this gives is "disabled", instantly,
 * with no side effect anywhere.
 *
 * The third gate is judgement rather than configuration: a contact with no
 * email and no phone is a name in a CRM that nobody can ever act on, and
 * pushing those out fills a real sales pipeline with noise that has to be
 * cleaned up by hand. Those stay here until somebody adds a way to reach them.
 */
export type OutboundContactSync =
  | { synced: true; contactId: string; created: boolean }
  | { synced: false; reason: 'disabled' | 'unreachable' | 'nothing-to-send' }

export async function syncLeadContactSafely(lead: {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  companyName?: string | null
  hubspotContactId?: string | null
}): Promise<OutboundContactSync> {
  const config = await getConfig()
  if (!config.enabled || !config.accessToken) return { synced: false, reason: 'disabled' }
  if (!lead.email && !lead.phone) return { synced: false, reason: 'nothing-to-send' }

  const hadContact = !!lead.hubspotContactId

  try {
    const contactId = await syncContactToHubSpot(lead)
    if (!contactId) return { synced: false, reason: 'disabled' }
    return { synced: true, contactId, created: !hadContact }
  } catch (error) {
    // The message, never the lead: what is useful in a log here is "HubSpot
    // said 429", and what is not is somebody's phone number.
    console.error(
      'HubSpot contact sync failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return { synced: false, reason: 'unreachable' }
  }
}

/**
 * Sync a HubSpot contact into a Lead.
 */
export async function syncContactFromHubSpot(contactId: string) {
  const contact = await hubspotFetch(
    `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,company`
  )

  const props = contact.properties || {}
  const name = [props.firstname, props.lastname].filter(Boolean).join(' ') || 'Unknown'

  // Find or create lead
  let lead = await prisma.lead.findUnique({
    where: { hubspotContactId: contactId },
  })

  if (lead) {
    lead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        name,
        email: props.email || lead.email,
        phone: props.phone || lead.phone,
        companyName: props.company || lead.companyName,
      },
    })
  } else {
    lead = await prisma.lead.create({
      data: {
        name,
        email: props.email || null,
        phone: props.phone || null,
        companyName: props.company || null,
        source: 'HUBSPOT',
        channel: 'HubSpot Contact Sync',
        hubspotContactId: contactId,
      },
    })

    // Notify all users of new lead (fire-and-forget)
    notifyNewLead(lead).catch(() => {})
  }

  return lead
}

// ============================================
// DEAL SYNC — Reservation ↔ HubSpot Deal
// ============================================

const ORDER_TYPE_LABELS: Record<string, string> = {
  RENTAL: 'Rental',
  SALE: 'Sale',
  RENT_TO_OWN: 'Rent-to-Own',
  CLOUD: 'Cloud',
}

/**
 * Map AMC reservation status → HubSpot default pipeline deal stage.
 * These are HubSpot's built-in stage IDs for the default pipeline.
 */
function mapStatusToDealStage(status: string): string {
  switch (status) {
    case 'DRAFT':
    case 'REVISION':
      return 'qualifiedtobuy'
    case 'QUOTE_SENT':
      return 'presentationscheduled'
    case 'APPROVED':
    case 'PREPARING':
    case 'SHIPPED':
      return 'contractsent'
    case 'ACTIVE':
    case 'COMPLETED':
      return 'closedwon'
    case 'CANCELLED':
    case 'LOST':
      return 'closedlost'
    default:
      return 'qualifiedtobuy'
  }
}

/**
 * Create or update a HubSpot deal for a reservation.
 * Non-blocking — errors are logged but never thrown to the caller.
 */
export async function syncReservationDeal(reservation: {
  id: string
  reservationNumber: string
  reservationType: string
  status: string
  total?: number | null
  projectName?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  rtoTermMonths?: number | null
  rtoMonthlyPayment?: number | null
  hubspotDealId?: string | null
  clientId: string
}) {
  try {
    const config = await getConfig()
    if (!config.enabled || !config.accessToken) return

    const typeLabel = ORDER_TYPE_LABELS[reservation.reservationType] || reservation.reservationType
    const dealStage = mapStatusToDealStage(reservation.status)

    const pipeline = config.pipelines[reservation.reservationType] || 'default'

    const properties: Record<string, string | number> = {
      dealname: `${reservation.reservationNumber} — ${typeLabel}`,
      dealstage: dealStage,
      pipeline,
    }

    // Amount: for RTO use monthly payment, otherwise use total
    if (reservation.reservationType === 'RENT_TO_OWN' && reservation.rtoMonthlyPayment) {
      properties.amount = Number(reservation.rtoMonthlyPayment)
      // Store total in description since HubSpot "amount" is the deal value
    } else if (reservation.total) {
      properties.amount = Number(reservation.total)
    }

    // Build a description with key details
    const descParts: string[] = []
    descParts.push(`Order: ${reservation.reservationNumber}`)
    descParts.push(`Type: ${typeLabel}`)
    if (reservation.projectName) descParts.push(`Project: ${reservation.projectName}`)
    if (reservation.startDate) {
      const start = new Date(reservation.startDate).toLocaleDateString('en-US')
      descParts.push(`Start: ${start}`)
    }
    if (reservation.endDate) {
      const end = new Date(reservation.endDate).toLocaleDateString('en-US')
      descParts.push(`End: ${end}`)
    }
    if (reservation.reservationType === 'RENT_TO_OWN' && reservation.rtoTermMonths) {
      descParts.push(`RTO Term: ${reservation.rtoTermMonths} months`)
      if (reservation.rtoMonthlyPayment) {
        descParts.push(`Monthly: $${Number(reservation.rtoMonthlyPayment).toFixed(2)}`)
      }
      if (reservation.total) {
        descParts.push(`Buyout: $${Number(reservation.total).toFixed(2)}`)
      }
    }
    properties.description = descParts.join('\n')

    // Close date for won/lost deals
    if (dealStage === 'closedwon' || dealStage === 'closedlost') {
      properties.closedate = new Date().toISOString()
    }

    if (reservation.hubspotDealId) {
      // Update existing deal
      await hubspotFetch(`/crm/v3/objects/deals/${reservation.hubspotDealId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      })
    } else {
      // Create new deal
      const deal = await hubspotFetch('/crm/v3/objects/deals', {
        method: 'POST',
        body: JSON.stringify({ properties }),
      })

      const dealId = deal.id as string

      // Store deal ID on reservation
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { hubspotDealId: dealId },
      })

      // Associate deal with HubSpot contact if lead has one
      const lead = await prisma.lead.findFirst({
        where: {
          OR: [
            { convertedReservationId: reservation.id },
            { boundToReservationId: reservation.id },
          ],
        },
        select: { hubspotContactId: true },
      })

      if (lead?.hubspotContactId) {
        await hubspotFetch(
          `/crm/v3/objects/deals/${dealId}/associations/contacts/${lead.hubspotContactId}/deal_to_contact`,
          { method: 'PUT' }
        ).catch(() => {}) // Non-critical
      }
    }
  } catch (error) {
    // Never block the calling operation — just log
    console.error('HubSpot deal sync failed:', error)
  }
}

/**
 * Verifying that a request really came from HubSpot.
 *
 * v1 carried one function here that read the **v3** header and then checked it
 * against the **v2** algorithm — a plain SHA-256 of secret+method+url+body,
 * hex-encoded. No v3 signature has ever matched that, so had v1's HubSpot
 * webhook ever been pointed at a v3 app it would have refused every request
 * HubSpot sent. It was never configured, so nobody found out. All three of
 * HubSpot's schemes are implemented here instead:
 *
 *  - **v1** — `X-HubSpot-Signature`, sha256(secret + body), hex. No method, no
 *    url, no timestamp: a signature that is identical every time the same body
 *    is sent, so it is accepted only when nothing better was offered.
 *  - **v2** — `X-HubSpot-Signature` with `…-Version: v2`, sha256(secret +
 *    method + url + body), hex.
 *  - **v3** — `X-HubSpot-Signature-v3`, base64 HMAC-SHA256 over method + url +
 *    body + timestamp, keyed on the secret, with `X-HubSpot-Request-Timestamp`
 *    and a five-minute window. This is the only one with replay protection,
 *    and the only one to configure a new app with.
 *
 * **The url is the awkward part.** HubSpot signs the URL it called — public
 * scheme, public host, query string and all — and behind a reverse proxy
 * `request.url` is the internal one it was rewritten to. So the caller passes
 * every URL this request could plausibly have arrived as and each is tried;
 * a wrong guess costs one hash. `verifyHubSpotRequest` does the assembling.
 */

/** Five minutes, HubSpot's own replay window for v3. */
const V3_MAX_AGE_MS = 5 * 60 * 1000

export type SignatureVerdict =
  | { ok: true; scheme: 'v1' | 'v2' | 'v3' }
  | { ok: false; reason: 'unconfigured' | 'unsigned' | 'stale' | 'mismatch' }

/** Constant-time where it can be; false rather than a throw on a length mismatch. */
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

export async function verifyHubSpotRequest(input: {
  method: string
  /** Every URL this request could have arrived as, most likely first. */
  urls: string[]
  body: string
  headers: {
    v3?: string | null
    v2OrV1?: string | null
    version?: string | null
    timestamp?: string | null
  }
}): Promise<SignatureVerdict> {
  const config = await getConfig()
  if (!config.webhookSecret) return { ok: false, reason: 'unconfigured' }

  const secret = config.webhookSecret
  const urls = input.urls.filter(Boolean)

  const v3 = input.headers.v3?.trim()
  if (v3) {
    const timestamp = Number(input.headers.timestamp)
    if (!Number.isFinite(timestamp)) return { ok: false, reason: 'unsigned' }
    // A replayed request is a real attack on a webhook that creates records.
    if (Math.abs(Date.now() - timestamp) > V3_MAX_AGE_MS) return { ok: false, reason: 'stale' }

    for (const url of urls) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${input.method}${url}${input.body}${timestamp}`)
        .digest('base64')
      if (sameDigest(v3, expected)) return { ok: true, scheme: 'v3' }
    }
    return { ok: false, reason: 'mismatch' }
  }

  const legacy = input.headers.v2OrV1?.trim()
  if (!legacy) return { ok: false, reason: 'unsigned' }

  const version = input.headers.version?.trim().toLowerCase()
  if (version !== 'v1') {
    for (const url of urls) {
      const expected = crypto
        .createHash('sha256')
        .update(secret + input.method + url + input.body)
        .digest('hex')
      if (sameDigest(legacy, expected)) return { ok: true, scheme: 'v2' }
    }
  }

  // Only where the app is explicitly still on v1: an unversioned header is v2
  // by convention, and accepting a replayable signature by default would make
  // the newer schemes' protection optional.
  if (version === 'v1') {
    const expected = crypto.createHash('sha256').update(secret + input.body).digest('hex')
    if (sameDigest(legacy, expected)) return { ok: true, scheme: 'v1' }
  }

  return { ok: false, reason: 'mismatch' }
}

/**
 * Process a HubSpot webhook event.
 */
export async function processWebhookEvent(event: {
  subscriptionType: string
  objectId: number
  propertyName?: string
  propertyValue?: string
}) {
  const contactId = String(event.objectId)

  switch (event.subscriptionType) {
    case 'contact.creation':
    case 'contact.propertyChange':
      return syncContactFromHubSpot(contactId)
    default:
      console.log('Unhandled HubSpot event:', event.subscriptionType)
      return null
  }
}
