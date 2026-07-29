'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireEditor } from '@/lib/auth-utils'
import { serialize } from '@/lib/utils'
import { logAudit } from './audit'
import { notifyNewLead } from './notifications'
import { generateReservationNumber } from './reservations'
import { syncReservationDeal } from '@/lib/integrations/hubspot'
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
  revalidatePath('/dashboard/reservations')
  if (isSale) revalidatePath('/dashboard/sales')

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
  revalidatePath(`/dashboard/reservations/${reservationId}`)

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
