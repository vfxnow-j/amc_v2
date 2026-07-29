import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/actions/audit'
import { findMatchingLead, mergeIntoLead } from '@/lib/actions/leads'
import { notifyNewLead } from '@/lib/actions/notifications'

const SETTING_KEY = 'zapier_webhook_secret'

async function getConfig() {
  const secret = await prisma.setting.findUnique({
    where: { key: SETTING_KEY },
  })

  return {
    webhookSecret: secret?.value as string | null,
  }
}

/**
 * Verify the Zapier webhook secret (from query param or header).
 */
export async function verifyWebhookSecret(providedSecret: string): Promise<boolean> {
  const config = await getConfig()
  if (!config.webhookSecret || !providedSecret) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSecret),
      Buffer.from(config.webhookSecret)
    )
  } catch {
    return false
  }
}

/**
 * Map formName to a suggested lead status progression.
 * Higher index = further along the funnel. We only advance, never regress.
 */
const FORM_STATUS_MAP: Record<string, string> = {
  ad: 'NEW',
  ads: 'NEW',
  'landing page': 'NEW',
  'contact us': 'CONTACTED',
  contact: 'CONTACTED',
  inquiry: 'CONTACTED',
  quote: 'QUALIFIED',
  'request a quote': 'QUALIFIED',
  onboarding: 'QUALIFIED',
  onboard: 'QUALIFIED',
  proposal: 'PROSPECT',
}

function resolveStatusFromForm(formName: string | undefined): string | null {
  if (!formName) return null
  const key = formName.toLowerCase().trim()
  // Exact match first, then partial match
  if (FORM_STATUS_MAP[key]) return FORM_STATUS_MAP[key]
  for (const [pattern, status] of Object.entries(FORM_STATUS_MAP)) {
    if (key.includes(pattern)) return status
  }
  return null
}

/**
 * Process a lead from a Zapier webhook (HubSpot form submission).
 * Deduplicates by email — repeat submissions from different forms are
 * logged as activities on the existing lead and may advance its status.
 */
export async function processLeadWebhook(body: Record<string, any>) {
  const { email, phone, companyName, company, channel, estimatedValue, notes } = body
  const formName = body.formName || body.form_name || body.formType || body.form_type || null

  // Accept name, or firstname/lastname, or first_name/last_name
  const name = (
    body.name ||
    [body.firstname || body.first_name, body.lastname || body.last_name].filter(Boolean).join(' ')
  )?.trim()

  if (!name) {
    return { error: 'name is required (send name, or firstname + lastname)', status: 400 }
  }

  const effectiveChannel = formName || channel || 'HubSpot Form'

  // Central dedup — match by email, phone, name+company, or recent name
  const existing = await findMatchingLead({
    name,
    email: email?.toLowerCase().trim(),
    phone,
    companyName: companyName || company,
  })

  if (existing) {
    const suggestedStatus = resolveStatusFromForm(formName) || undefined

    await mergeIntoLead(existing.id, {
      email: email?.toLowerCase().trim(),
      phone,
      companyName: companyName || company,
      channel: effectiveChannel,
      source: 'HUBSPOT',
      estimatedValue: estimatedValue ?? undefined,
      notes,
    }, {
      suggestedStatus: suggestedStatus as any,
      activityTitle: `Form submission: ${effectiveChannel}`,
      activityDescription: notes || `Matched from Zapier webhook`,
    })

    return {
      success: true,
      deduplicated: true,
      leadId: existing.id,
      activityLogged: true,
      statusAdvanced: !!suggestedStatus,
    }
  }

  // Determine initial status from form type
  const initialStatus = resolveStatusFromForm(formName) || 'NEW'

  const lead = await prisma.lead.create({
    data: {
      name: name.trim(),
      email: email?.toLowerCase().trim() || null,
      phone: phone || null,
      companyName: companyName || company || null,
      source: 'HUBSPOT',
      channel: effectiveChannel,
      status: initialStatus as any,
      estimatedValue: estimatedValue ?? null,
      notes: notes || null,
    },
  })

  // Log the initial form submission as an activity
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'SYSTEM',
      title: `Lead created from: ${effectiveChannel}`,
      description: notes || undefined,
      metadata: {
        formName: formName || null,
        channel: effectiveChannel,
        source: 'zapier-webhook',
      },
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Lead',
    entityId: lead.id,
    newValues: { name: lead.name, source: 'HUBSPOT', channel: effectiveChannel, via: 'zapier-webhook' },
  })

  // Notify all users of new lead (fire-and-forget)
  notifyNewLead(lead).catch(() => {})

  return { success: true, leadId: lead.id, status: 201 }
}

/**
 * Generate a new webhook secret and persist it.
 */
export async function generateWebhookSecret(): Promise<string> {
  const secret = crypto.randomBytes(32).toString('hex')

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: secret },
    create: { key: SETTING_KEY, value: secret },
  })

  return secret
}

/**
 * Get the current webhook secret (for display in settings).
 */
export async function getWebhookSecret(): Promise<string | null> {
  const config = await getConfig()
  return config.webhookSecret
}
