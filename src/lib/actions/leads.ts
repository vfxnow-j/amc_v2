'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireAuth, requireEditor } from '@/lib/auth-utils'
import { isAdmin } from '@/lib/auth'
import { serialize } from '@/lib/utils'
import { sendEmail } from '@/lib/email/send'
import { isEmailConfigured } from '@/lib/email/client'
import { onboardingInviteEmail } from '@/lib/email/templates'
import { logAudit } from './audit'
import { notifyNewLead } from './notifications'
import { generateReservationNumber } from './reservations'
import { syncReservationDeal } from '@/lib/integrations/hubspot'
import {
  applyOnboardingToLead,
  type OnboardingApplied,
  type OnboardingPayload,
} from '@/lib/leads/onboarding'
import type { LeadSource, LeadStatus, Prisma } from '@/generated/prisma/client'

// ============================================
// TYPES
// ============================================

export type LeadFormData = {
  name: string
  email?: string
  phone?: string
  companyName?: string
  source?: LeadSource
  channel?: string
  salesRep?: string
  status?: LeadStatus
  assignedToId?: string
  estimatedValue?: number
  notes?: string
  clientId?: string
  // Ad attribution. The lead record has displayed these since it was built and
  // nothing in v2 could set them, so every campaign name and every acquisition
  // cost in this database arrived from v1 or from a webhook.
  adCampaign?: string
  adPlatform?: string
  adCost?: number
}

export type LeadFilters = {
  search?: string
  status?: LeadStatus
  source?: LeadSource
  assignedToId?: string
  page?: number
  limit?: number
}

// ============================================
// PIPELINE STATUS ORDER (used for auto-advancement)
// ============================================

const PIPELINE_ORDER: LeadStatus[] = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'PROSPECT', 'WON',
]

function shouldAdvanceStatus(current: LeadStatus, suggested: LeadStatus): boolean {
  const currentIdx = PIPELINE_ORDER.indexOf(current)
  const suggestedIdx = PIPELINE_ORDER.indexOf(suggested)
  // Only advance forward. Never touch WON, LOST, or UNQUALIFIED.
  if (currentIdx < 0 || suggestedIdx < 0) return false
  return suggestedIdx > currentIdx && current !== 'WON' && current !== 'LOST' && current !== 'UNQUALIFIED' && current !== 'BOUND'
}

// ============================================
// FIND & MERGE — central dedup logic
// ============================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

/**
 * Find an existing lead that matches the incoming data.
 * Match priority: email → phone → name+company → name within 7 days.
 */
export async function findMatchingLead(data: {
  name?: string
  email?: string
  phone?: string
  companyName?: string
}) {
  // 1. Exact email match
  if (data.email) {
    const match = await prisma.lead.findFirst({
      where: { email: data.email.toLowerCase().trim() },
    })
    if (match) return match
  }

  // 2. Phone match (last 10 digits)
  if (data.phone) {
    const digits = normalizePhone(data.phone)
    if (digits.length >= 7) {
      const match = await prisma.lead.findFirst({
        where: { phone: { contains: digits } },
      })
      if (match) return match
    }
  }

  // 3. Name + company match (case-insensitive)
  if (data.name && data.companyName) {
    const match = await prisma.lead.findFirst({
      where: {
        name: { equals: data.name.trim(), mode: 'insensitive' },
        companyName: { equals: data.companyName.trim(), mode: 'insensitive' },
      },
    })
    if (match) return match
  }

  // 4. Same name, created within last 7 days
  if (data.name) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const match = await prisma.lead.findFirst({
      where: {
        name: { equals: data.name.trim(), mode: 'insensitive' },
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (match) return match
  }

  return null
}

/**
 * Merge new data into an existing lead.
 * Fills missing fields, logs activity, optionally advances status.
 */
export async function mergeIntoLead(
  existingId: string,
  newData: {
    email?: string
    phone?: string
    companyName?: string
    channel?: string
    source?: LeadSource
    estimatedValue?: number
    notes?: string
  },
  opts?: {
    suggestedStatus?: LeadStatus
    activityTitle?: string
    activityDescription?: string
    createdById?: string | null
  }
) {
  const existing = await prisma.lead.findUnique({ where: { id: existingId } })
  if (!existing) return existing

  // Fill missing fields
  const updates: Record<string, unknown> = {}
  if (!existing.email && newData.email) updates.email = newData.email.toLowerCase().trim()
  if (!existing.phone && newData.phone) updates.phone = newData.phone
  if (!existing.companyName && newData.companyName) updates.companyName = newData.companyName
  if (!existing.estimatedValue && newData.estimatedValue) updates.estimatedValue = newData.estimatedValue
  if (newData.channel && newData.channel !== existing.channel) {
    // Append to channel trail — tracks the journey from source to conversion
    const trail = existing.channel || ''
    const alreadyTracked = trail.split(' → ').some(s => s.trim() === newData.channel)
    if (!alreadyTracked) {
      updates.channel = trail
        ? `${trail} → ${newData.channel}`
        : newData.channel
    }
  }

  // Advance status if warranted
  let statusAdvanced = false
  if (opts?.suggestedStatus && shouldAdvanceStatus(existing.status, opts.suggestedStatus)) {
    updates.status = opts.suggestedStatus
    statusAdvanced = true
  }

  if (Object.keys(updates).length > 0) {
    await prisma.lead.update({ where: { id: existingId }, data: updates })
  }

  // Log merge activity
  await prisma.leadActivity.create({
    data: {
      leadId: existingId,
      type: 'SYSTEM',
      title: opts?.activityTitle || 'Lead merged — duplicate entry matched',
      description: opts?.activityDescription || `New touchpoint via ${newData.source || 'unknown'}${newData.channel ? ` (${newData.channel})` : ''}`,
      metadata: {
        mergedFields: Object.keys(updates),
        source: newData.source,
        channel: newData.channel,
        statusAdvanced,
      },
      createdById: opts?.createdById || undefined,
    },
  })

  if (statusAdvanced) {
    await prisma.leadActivity.create({
      data: {
        leadId: existingId,
        type: 'STATUS_CHANGE',
        title: `Pipeline advanced: ${existing.status} → ${updates.status}`,
        description: `Auto-advanced from new touchpoint`,
        metadata: { previousStatus: existing.status, newStatus: updates.status as string },
        createdById: opts?.createdById || undefined,
      },
    })
  }

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${existingId}`)

  return prisma.lead.findUnique({ where: { id: existingId } })
}

// ============================================
// GET LEADS
// ============================================

export async function getLeads(filters: LeadFilters = {}) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const { search, status, source, assignedToId, page = 1, limit = 25 } = filters
  const offset = (page - 1) * limit

  const where: Prisma.LeadWhereInput = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (status) where.status = status
  if (source) where.source = source
  if (assignedToId) where.assignedToId = assignedToId

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, image: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ])

  return { leads: serialize(leads), total, page, limit, totalPages: Math.ceil(total / limit) }
}

// ============================================
// GET LEAD
// ============================================

export async function getLead(id: string) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true, image: true, email: true } },
      convertedToClient: { select: { id: true, name: true } },
      boundToClient: { select: { id: true, name: true } },
      activities: {
        include: {
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!lead) throw new Error('Lead not found')

  return serialize(lead)
}

// ============================================
// CREATE LEAD
// ============================================

export async function createLead(data: LeadFormData) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  if (!data.name?.trim()) throw new Error('Name is required')

  // If clientId provided, validate it exists
  if (data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: data.clientId } })
    if (!client) throw new Error('Selected client not found')
  }

  const lead = await prisma.lead.create({
    data: {
      name: data.name.trim(),
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      companyName: data.companyName?.trim() || null,
      source: data.source || 'OTHER',
      channel: data.channel?.trim() || null,
      salesRep: data.salesRep?.trim() || null,
      status: data.status || 'NEW',
      assignedToId: data.assignedToId || null,
      estimatedValue: data.estimatedValue ?? null,
      notes: data.notes?.trim() || null,
      convertedToClientId: data.clientId || null,
      adCampaign: data.adCampaign?.trim() || null,
      adPlatform: data.adPlatform?.trim() || null,
      adCost: data.adCost ?? null,
    },
  })

  // Create initial activity
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'SYSTEM',
      title: 'Lead created',
      description: `Lead created via ${data.source || 'OTHER'}${data.channel ? ` (${data.channel})` : ''}${data.clientId ? ' (linked to existing client)' : ''}`,
      createdById: authResult.userId,
    },
  })

  await logAudit({
    action: 'CREATE',
    entityType: 'Lead',
    entityId: lead.id,
    newValues: { name: lead.name, source: lead.source },
    userId: authResult.userId,
  })

  // Notify all users of new lead (fire-and-forget)
  notifyNewLead(lead).catch(() => {})

  revalidatePath('/dashboard/leads')
  return serialize(lead)
}

// ============================================
// UPDATE LEAD
// ============================================

export async function updateLead(id: string, data: Partial<LeadFormData>) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.lead.findUnique({ where: { id } })
  if (!existing) throw new Error('Lead not found')

  const updateData: Prisma.LeadUpdateInput = {}
  if (data.name !== undefined) updateData.name = data.name.trim()
  if (data.email !== undefined) updateData.email = data.email?.trim() || null
  if (data.phone !== undefined) updateData.phone = data.phone?.trim() || null
  if (data.companyName !== undefined) updateData.companyName = data.companyName?.trim() || null
  if (data.source !== undefined) updateData.source = data.source
  if (data.channel !== undefined) updateData.channel = data.channel?.trim() || null
  if (data.salesRep !== undefined) updateData.salesRep = data.salesRep?.trim() || null
  if (data.assignedToId !== undefined) {
    updateData.assignedTo = data.assignedToId
      ? { connect: { id: data.assignedToId } }
      : { disconnect: true }
  }
  if (data.estimatedValue !== undefined) updateData.estimatedValue = data.estimatedValue
  if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null
  if (data.adCampaign !== undefined) updateData.adCampaign = data.adCampaign?.trim() || null
  if (data.adPlatform !== undefined) updateData.adPlatform = data.adPlatform?.trim() || null
  if (data.adCost !== undefined) updateData.adCost = data.adCost

  const lead = await prisma.lead.update({ where: { id }, data: updateData })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Lead',
    entityId: lead.id,
    oldValues: { name: existing.name, status: existing.status },
    newValues: { name: lead.name, status: lead.status },
    userId: authResult.userId,
  })

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${id}`)
  return serialize(lead)
}

// ============================================
// UPDATE LEAD STATUS
// ============================================

export async function updateLeadStatus(
  id: string,
  status: LeadStatus,
  notes?: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.lead.findUnique({ where: { id } })
  if (!existing) throw new Error('Lead not found')

  const updateData: Prisma.LeadUpdateInput = { status }

  if (status === 'LOST') {
    updateData.lostReason = notes || null
    updateData.lostAt = new Date()
  }

  const lead = await prisma.lead.update({ where: { id }, data: updateData })

  // Create status change activity
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'STATUS_CHANGE',
      title: `Status changed to ${status}`,
      description: notes || `Status changed from ${existing.status} to ${status}`,
      metadata: { oldStatus: existing.status, newStatus: status },
      createdById: authResult.userId,
    },
  })

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${id}`)
  return serialize(lead)
}

// ============================================
// ASSIGN LEAD
// ============================================

export async function assignLead(id: string, userId: string | null) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.lead.findUnique({
    where: { id },
    include: { assignedTo: { select: { name: true } } },
  })
  if (!existing) throw new Error('Lead not found')

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      assignedTo: userId ? { connect: { id: userId } } : { disconnect: true },
    },
    include: { assignedTo: { select: { name: true } } },
  })

  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'ASSIGNMENT',
      title: userId
        ? `Assigned to ${lead.assignedTo?.name}`
        : 'Unassigned',
      description: existing.assignedTo
        ? `Reassigned from ${existing.assignedTo.name}`
        : undefined,
      createdById: authResult.userId,
    },
  })

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${id}`)
  return serialize(lead)
}

// ============================================
// ADD LEAD ACTIVITY
// ============================================

export async function addLeadActivity(
  leadId: string,
  type: 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING',
  title: string,
  description?: string
) {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error('Lead not found')

  const activity = await prisma.leadActivity.create({
    data: {
      leadId,
      type,
      title,
      description,
      createdById: authResult.userId,
    },
  })

  revalidatePath(`/dashboard/leads/${leadId}`)
  return serialize(activity)
}

// ============================================
// DELETE LEAD
// ============================================

export async function deleteLead(id: string) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const existing = await prisma.lead.findUnique({ where: { id } })
  if (!existing) throw new Error('Lead not found')

  await prisma.lead.delete({ where: { id } })

  await logAudit({
    action: 'DELETE',
    entityType: 'Lead',
    entityId: id,
    oldValues: { name: existing.name },
    userId: authResult.userId,
  })

  revalidatePath('/dashboard/leads')
  return { success: true }
}

// ============================================
// CONVERT LEAD TO RESERVATION
// ============================================

export async function convertLeadToReservation(
  leadId: string,
  reservationData: {
    startDate: string
    endDate: string
    projectName?: string
    notes?: string
    reservationType?: 'RENTAL' | 'SALE' | 'RENT_TO_OWN' | 'CLOUD'
    rtoTermMonths?: number
  }
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error('Lead not found')
  if (lead.status === 'WON') throw new Error('Lead already converted')

  const resType = reservationData.reservationType || 'RENTAL'
  const isSale = resType === 'SALE'
  const isRTO = resType === 'RENT_TO_OWN'
  // RTO orders are financed via fixed monthly installments — require a term so the
  // financing/amortization section renders. Items (and the monthly payment) are
  // priced after conversion; recalc happens when the order is edited.
  const rtoTermMonths = isRTO ? reservationData.rtoTermMonths || null : null

  // Find or create client
  let clientId = lead.convertedToClientId

  if (!clientId) {
    const existingClient = lead.email
      ? await prisma.client.findFirst({ where: { email: lead.email } })
      : null

    if (existingClient) {
      clientId = existingClient.id
    } else {
      const newClient = await prisma.client.create({
        data: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          companyName: lead.companyName,
        },
      })
      clientId = newClient.id
    }
  }

  // Generate reservation number with correct prefix (SALE/CLD/RTO/RES)
  const reservationNumber = await generateReservationNumber(resType)

  // Determine billing cycle based on type
  const billingCycleType = isSale || resType === 'CLOUD' ? 'ONE_TIME' : resType === 'RENT_TO_OWN' ? 'MONTHLY' : 'MONTHLY'

  // Create draft reservation with default package
  const reservation = await prisma.reservation.create({
    data: {
      reservationNumber,
      clientId,
      reservationType: resType,
      startDate: new Date(reservationData.startDate),
      endDate: new Date(reservationData.endDate),
      status: 'DRAFT',
      billingCycleType,
      // RTO is financed via fixed monthly installments — recurring billing + term.
      isRecurring: isRTO,
      rtoTermMonths,
      projectName: reservationData.projectName || lead.companyName || undefined,
      notes: reservationData.notes || undefined,
      createdById: authResult.userId,
      packages: {
        create: { name: 'Default', isActive: true, sortOrder: 0 },
      },
    },
  })

  // Advance lead to PROSPECT (WON happens when quote is approved)
  const newStatus = shouldAdvanceStatus(lead.status, 'PROSPECT') ? 'PROSPECT' : lead.status
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: newStatus,
      convertedToClientId: clientId,
      convertedReservationId: reservation.id,
      convertedAt: new Date(),
    },
  })

  // Create activity
  const typeLabelMap: Record<string, string> = { SALE: 'Sale Order', RENTAL: 'Rental Order', RENT_TO_OWN: 'RTO Order', CLOUD: 'Cloud Order' }
  const typeLabel = typeLabelMap[resType] || 'Order'
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: 'STATUS_CHANGE',
      title: `${typeLabel} created`,
      description: `Created ${typeLabel.toLowerCase()} ${reservationNumber}`,
      metadata: { reservationId: reservation.id, clientId, newStatus, reservationType: resType },
      createdById: authResult.userId,
    },
  })

  // Sync deal to HubSpot (fire-and-forget — never blocks)
  syncReservationDeal({
    id: reservation.id,
    reservationNumber: reservation.reservationNumber,
    reservationType: reservation.reservationType,
    status: reservation.status,
    total: Number(reservation.total) || 0,
    projectName: reservation.projectName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    clientId: reservation.clientId,
  }).catch(() => {})

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath('/dashboard/orders')
  if (isSale) revalidatePath('/dashboard/orders')

  return serialize({ lead: { id: leadId, status: 'WON' }, reservation })
}

// ============================================
// BIND LEAD TO EXISTING ORDER
// ============================================

export async function bindLeadToOrder(
  leadId: string,
  reservationId: string
) {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error)

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error('Lead not found')
  if (lead.status === 'WON' || lead.status === 'BOUND') {
    throw new Error('Lead already converted or bound')
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { client: true },
  })
  if (!reservation) throw new Error('Reservation not found')

  // Create associated contact on the client
  await prisma.clientContact.create({
    data: {
      clientId: reservation.clientId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      role: 'Associated',
      leadId: leadId,
    },
  })

  // Update lead: mark as BOUND, link to reservation and client
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: 'BOUND',
      boundToReservationId: reservationId,
      boundToClientId: reservation.clientId,
      boundAt: new Date(),
      convertedToClientId: reservation.clientId,
      convertedAt: new Date(),
    },
  })

  // Create activity
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: 'STATUS_CHANGE',
      title: 'Bound to existing order',
      description: `Bound to ${reservation.reservationNumber} (${reservation.client.name}). Added as associated contact.`,
      metadata: {
        reservationId,
        clientId: reservation.clientId,
        reservationNumber: reservation.reservationNumber,
      },
      createdById: authResult.userId,
    },
  })

  // Sync deal to HubSpot if not already synced (fire-and-forget)
  if (!reservation.hubspotDealId) {
    syncReservationDeal({
      id: reservation.id,
      reservationNumber: reservation.reservationNumber,
      reservationType: reservation.reservationType,
      status: reservation.status,
      total: Number(reservation.total) || 0,
      projectName: reservation.projectName,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      hubspotDealId: reservation.hubspotDealId,
      clientId: reservation.clientId,
    }).catch(() => {})
  }

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath(`/dashboard/orders/${reservationId}`)

  return serialize(updated)
}

// ============================================
// PIPELINE STATS
// ============================================

export async function getLeadPipelineStats() {
  const authResult = await requireAuth()
  if (!authResult.authorized) return {}

  const counts = await prisma.lead.groupBy({
    by: ['status'],
    _count: { id: true },
    _sum: { estimatedValue: true },
  })

  return serialize(
    counts.reduce(
      (acc, c) => {
        acc[c.status] = { count: c._count.id, value: c._sum.estimatedValue }
        return acc
      },
      {} as Record<string, { count: number; value: unknown }>
    )
  )
}

// ============================================
// CREATE FROM A FORM
// ============================================

/**
 * What the create-lead screen sends.
 *
 * Separate from `LeadFormData` because that type is the ported action's own
 * shape and the webhooks fill it too; this one carries the extra flag the
 * screen needs to say "yes, I saw the duplicate warning, do it anyway".
 */
export type LeadInput = {
  name: string
  companyName?: string
  email?: string
  phone?: string
  source?: LeadSource
  channel?: string
  salesRep?: string
  status?: LeadStatus
  assignedToId?: string
  estimatedValue?: number
  notes?: string
  adCampaign?: string
  adPlatform?: string
  adCost?: number
  /** Set once the caller has been shown the lead this looks like. */
  allowDuplicate?: boolean
}

export type LeadCreateOutcome =
  | { status: 'ok'; id: string; name: string }
  | { status: 'error'; message: string }
  | {
      status: 'duplicate'
      message: string
      existing: {
        id: string
        name: string
        companyName: string | null
        email: string | null
        status: LeadStatus
      }
    }

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Create a lead from the screen, with a result the screen can render.
 *
 * `createLead` throws, which is right for a webhook and useless to a form, so
 * this is the same thin layer `lib/actions/accounts.ts` puts over
 * `createClient`. The one thing it adds is the duplicate question: enquiries
 * arrive twice constantly — the same person fills in the website form and then
 * rings — and `findMatchingLead` is the dedupe every inbound path already uses.
 * Asking here means the person keying it in gets the same answer the webhook
 * would have, instead of quietly opening the second record.
 *
 * It asks rather than refuses. Two people at one company is a real thing, and a
 * form that will not let you record the second one gets worked around.
 */
export async function createLeadFromForm(input: LeadInput): Promise<LeadCreateOutcome> {
  const auth = await requireEditor()
  if (!auth.authorized) {
    return { status: 'error', message: auth.error ?? 'Unauthorized' }
  }

  const name = input.name.trim()
  if (!name) return { status: 'error', message: 'A lead needs a name.' }

  const email = input.email?.trim()
  // Loose on purpose, as everywhere else here: refusing a real address because
  // it fails a regex is worse than storing one that bounces.
  if (email && !EMAIL_SHAPE.test(email)) {
    return { status: 'error', message: `"${email}" does not look like an email address.` }
  }

  if (input.estimatedValue != null && (!Number.isFinite(input.estimatedValue) || input.estimatedValue < 0)) {
    return { status: 'error', message: 'An estimated value is a positive amount, or nothing at all.' }
  }
  if (input.adCost != null && (!Number.isFinite(input.adCost) || input.adCost < 0)) {
    return { status: 'error', message: 'Cost to acquire is a positive amount, or nothing at all.' }
  }

  if (!input.allowDuplicate) {
    const existing = await findMatchingLead({
      name,
      email: email || undefined,
      phone: input.phone?.trim() || undefined,
      companyName: input.companyName?.trim() || undefined,
    })
    if (existing) {
      return {
        status: 'duplicate',
        message: `This looks like a lead that is already here — ${existing.name}${existing.companyName ? ` at ${existing.companyName}` : ''}.`,
        existing: {
          id: existing.id,
          name: existing.name,
          companyName: existing.companyName,
          email: existing.email,
          status: existing.status,
        },
      }
    }
  }

  try {
    const lead = await createLead({
      name,
      email: email || undefined,
      phone: input.phone?.trim() || undefined,
      companyName: input.companyName?.trim() || undefined,
      source: input.source,
      channel: input.channel?.trim() || undefined,
      salesRep: input.salesRep?.trim() || undefined,
      status: input.status,
      assignedToId: input.assignedToId || undefined,
      estimatedValue: input.estimatedValue,
      notes: input.notes?.trim() || undefined,
      adCampaign: input.adCampaign?.trim() || undefined,
      adPlatform: input.adPlatform?.trim() || undefined,
      adCost: input.adCost,
    })
    return { status: 'ok', id: lead.id, name: lead.name }
  } catch (cause) {
    return {
      status: 'error',
      message: cause instanceof Error ? cause.message : 'Could not save the lead.',
    }
  }
}

/**
 * Who a lead can be handed to.
 *
 * `lib/actions/users.getUsers` is admin-only and returns far more than a picker
 * needs, and an unassigned live lead is the single failure mode the Leads list
 * exists to catch — so anyone who can create one can name its owner.
 */
export async function getLeadAssignees() {
  const auth = await requireAuth()
  if (!auth.authorized) return []

  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return serialize(users)
}

// ============================================
// ONBOARDING — the link, and who it goes to
// ============================================

/**
 * Where the onboarding form lives.
 *
 * A `Setting` row rather than an environment variable, because the form is a
 * hosted thing that moves — a new Typeform, a different HubSpot page — and
 * moving it should not mean a redeploy. Read and written the same way every
 * other integration setting in this codebase is (`lib/integrations/zapier.ts`,
 * `lib/actions/agreement.ts`): one keyed row holding a JSON value.
 */
const ONBOARDING_URL_KEY = 'onboarding_form_url'

async function readOnboardingUrl(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: ONBOARDING_URL_KEY } })
  const value = row?.value
  const url = typeof value === 'string' ? value.trim() : null
  return url || null
}

export type OnboardingLinkState = {
  /** Null until somebody sets it. Nothing can be sent before that. */
  url: string | null
  /** Whether this user may change where it points. */
  canConfigure: boolean
  /** False on this instance — RESEND_API_KEY is blank by design. */
  emailConfigured: boolean
}

export async function getOnboardingLink(): Promise<OnboardingLinkState> {
  const auth = await requireEditor()
  if (!auth.authorized) {
    return { url: null, canConfigure: false, emailConfigured: false }
  }

  return {
    url: await readOnboardingUrl(),
    canConfigure: isAdmin(auth.role),
    emailConfigured: isEmailConfigured(),
  }
}

export async function saveOnboardingLink(
  url: string
): Promise<{ status: 'ok'; url: string } | { status: 'error'; message: string }> {
  const auth = await requireAdmin()
  if (!auth.authorized) {
    return { status: 'error', message: auth.error ?? 'Admin access required' }
  }

  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { status: 'error', message: 'That is not a URL. It needs the https:// too.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { status: 'error', message: 'The onboarding link has to be an http or https address.' }
  }

  const previous = await readOnboardingUrl()

  await prisma.setting.upsert({
    where: { key: ONBOARDING_URL_KEY },
    update: { value: trimmed },
    create: { key: ONBOARDING_URL_KEY, value: trimmed },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Settings',
    entityId: ONBOARDING_URL_KEY,
    oldValues: { url: previous },
    newValues: { url: trimmed },
    userId: auth.userId,
  })

  return { status: 'ok', url: trimmed }
}

export type OnboardOutcome =
  | {
      status: 'ok'
      leadId: string
      leadName: string
      /** True when this attached to an enquiry that was already on file. */
      merged: boolean
      /**
       * The onboarding link, always returned — never only mailed. Outbound
       * email is off on this instance, so this is usually the only copy that
       * exists and somebody has to pass it on by hand.
       */
      url: string
      /** Whether the email actually left. */
      delivered: boolean
      email: string
    }
  | { status: 'error'; message: string }
  | { status: 'unconfigured'; message: string; canConfigure: boolean }

/** A usable name out of an address, for when nobody typed one. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return words.join(' ') || email
}

/**
 * Ask somebody to onboard: an email address in, a link out.
 *
 * The address is run through `findMatchingLead` first, so pressing this on
 * somebody who already rang in adds a touchpoint to their record rather than
 * opening a second one — the same dedupe the website form and the JustCall
 * webhook go through.
 *
 * What it deliberately does **not** send is the quote. The address has not been
 * verified by anybody, and a quote link is the full rate card; onboarding is
 * what earns it. Hence the button copy: "Request onboarding", not "Send quote".
 *
 * `sendEmail` never throws — it returns `{success:false}` when there is no
 * Resend key, which is the standing state here — so the boolean is checked and
 * the link is returned either way. An action that quietly reported success
 * while the mail went nowhere is the failure this shape exists to prevent.
 */
export async function requestOnboarding(input: {
  email: string
  name?: string
  companyName?: string
  phone?: string
}): Promise<OnboardOutcome> {
  const auth = await requireEditor()
  if (!auth.authorized) {
    return { status: 'error', message: auth.error ?? 'Unauthorized' }
  }

  const email = input.email.trim().toLowerCase()
  if (!EMAIL_SHAPE.test(email)) {
    return {
      status: 'error',
      message: `"${input.email.trim()}" does not look like an email address.`,
    }
  }

  const url = await readOnboardingUrl()
  if (!url) {
    return {
      status: 'unconfigured',
      message:
        'No onboarding form has been set, so there is no link to send. Set where it points first.',
      canConfigure: isAdmin(auth.role),
    }
  }

  const name = input.name?.trim() || nameFromEmail(email)
  const companyName = input.companyName?.trim() || undefined
  const phone = input.phone?.trim() || undefined

  const existing = await findMatchingLead({ name, email, phone, companyName })

  let leadId: string
  let leadName: string

  if (existing) {
    await mergeIntoLead(
      existing.id,
      { email, phone, companyName, channel: 'Onboarding request', source: 'DIRECT' },
      {
        // QUALIFIED, not PROSPECT: nothing has been quoted yet, and
        // `shouldAdvanceStatus` only ever moves forward, so a lead already
        // further along is left where it is.
        suggestedStatus: 'QUALIFIED',
        activityTitle: 'Onboarding requested',
        activityDescription: `Onboarding form sent to ${email}`,
        createdById: auth.userId,
      }
    )
    leadId = existing.id
    leadName = existing.name
  } else {
    const created = await createLead({
      name,
      email,
      phone,
      companyName,
      source: 'DIRECT',
      channel: 'Onboarding request',
      status: 'QUALIFIED',
      assignedToId: auth.userId,
    })
    leadId = created.id
    leadName = created.name
  }

  const message = onboardingInviteEmail({ name: leadName, formUrl: url, companyName })
  const sent = await sendEmail({ to: email, subject: message.subject, html: message.html })
  const delivered = sent.success

  // Recorded either way. "We asked them to onboard on the 9th" is the fact
  // somebody needs a fortnight later, and it is not true unless the mail went.
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: delivered ? 'EMAIL' : 'SYSTEM',
      title: delivered ? 'Onboarding link emailed' : 'Onboarding link created — not sent',
      description: delivered
        ? `Onboarding form sent to ${email}.`
        : `Outbound email is switched off, so nothing was delivered. The link was handed to whoever pressed the button to pass on: ${url}`,
      metadata: { url, delivered, reason: sent.error ?? null },
      createdById: auth.userId,
    },
  })

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${leadId}`)

  return {
    status: 'ok',
    leadId,
    leadName,
    merged: !!existing,
    url,
    delivered,
    email,
  }
}

// ============================================
// THE PROSPECT PATH — a quote before an account
// ============================================

/**
 * File a held quote against the lead it was raised for.
 *
 * The prospect path creates three things — a lead, a shell client and a draft
 * order — and this is the join. Without it the lead says "onboarding
 * requested" and the order sits under a client nobody can explain; with it,
 * opening either one leads to the other.
 *
 * PROSPECT, not WON: a quote exists, which is what this stage means here.
 * Winning is the order being approved, and an order held for somebody who has
 * not onboarded is the one thing `approveOrder` refuses to do.
 */
export async function linkLeadToProspectOrder(
  leadId: string,
  clientId: string,
  reservationId: string,
  reservationNumber: string
) {
  const auth = await requireEditor()
  if (!auth.authorized) return { status: 'error' as const, message: auth.error ?? 'Unauthorized' }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, convertedToClientId: true },
  })
  if (!lead) return { status: 'error' as const, message: 'Lead not found' }

  const advanced = shouldAdvanceStatus(lead.status, 'PROSPECT')

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      convertedToClientId: clientId,
      convertedReservationId: reservationId,
      convertedAt: new Date(),
      ...(advanced ? { status: 'PROSPECT' as LeadStatus } : {}),
    },
  })

  await prisma.leadActivity.create({
    data: {
      leadId,
      type: 'SYSTEM',
      title: 'Quote held pending onboarding',
      description: `${reservationNumber} was priced and saved as a draft. It is not sent — the onboarding form has to come back first.`,
      metadata: { reservationId, clientId, prospect: true },
      createdById: auth.userId,
    },
  })

  if (advanced) {
    await prisma.leadActivity.create({
      data: {
        leadId,
        type: 'STATUS_CHANGE',
        title: `Pipeline advanced: ${lead.status} → PROSPECT`,
        description: 'A quote exists for them.',
        metadata: { previousStatus: lead.status, newStatus: 'PROSPECT' },
        createdById: auth.userId,
      },
    })
  }

  revalidatePath('/dashboard/leads')
  revalidatePath(`/dashboard/leads/${leadId}`)
  return { status: 'ok' as const }
}

export type RecordOnboardingOutcome =
  | { status: 'ok'; message: string; applied: OnboardingApplied }
  | { status: 'error'; message: string }

/**
 * Record an onboarding that arrived by some route the app cannot see.
 *
 * This is not a convenience. `RESEND_API_KEY` and the Zapier secret are both
 * blank on this instance, so the form is passed on by hand and comes back by
 * hand — and without this button the loop does not close at all: the client
 * stays provisional, `approveOrder` keeps refusing, and the quote nobody may
 * send sits there forever. The webhook automates this path later; it does not
 * replace it, because a form filled in over the phone never touches Zapier.
 *
 * The gate is here rather than in `applyOnboardingToLead` because the webhook
 * shares that core and authenticates a different way. See its header.
 */
export async function recordOnboarding(
  leadId: string,
  payload: OnboardingPayload
): Promise<RecordOnboardingOutcome> {
  const auth = await requireEditor()
  if (!auth.authorized) {
    return { status: 'error', message: auth.error ?? 'Unauthorized' }
  }

  const email = payload.email?.trim()
  if (email && !EMAIL_SHAPE.test(email)) {
    return { status: 'error', message: `"${email}" does not look like an email address.` }
  }

  const result = await applyOnboardingToLead(leadId, payload, {
    userId: auth.userId,
    via: 'manual',
  })
  if ('error' in result) return { status: 'error', message: result.error }

  const parts = [
    result.clientCreated
      ? `${result.clientName} now has an account.`
      : result.wasProspect
        ? `${result.clientName} is a full account now — the quote was being held against a provisional one.`
        : `${result.clientName} is on file already, so this was recorded against that account.`,
    result.filled.length > 0
      ? `Filled ${result.filled.join(', ').toLowerCase()}.`
      : 'Nothing was blank, so nothing on the account changed.',
    result.keptTyped.length > 0
      ? `Kept what was already recorded for ${result.keptTyped.join(', ').toLowerCase()} — the form disagreed and the record won.`
      : null,
    result.order?.flagged
      ? `${result.order.reservationNumber} is flagged for a decision: it can be sent now.`
      : null,
  ].filter(Boolean)

  return { status: 'ok', message: parts.join(' '), applied: result }
}
