import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { LeadSource, LeadStatus } from '@/generated/prisma/client'

/**
 * Lead dedupe: find the lead that is probably the same person, and fold a new
 * touchpoint into it.
 *
 * A PLAIN MODULE, deliberately - not `"use server"`, and never re-exported from
 * one. Both functions were exports of `lib/actions/leads.ts`, which is a
 * `"use server"` file that client components import from, so both carried a
 * callable Server Function id in the reference manifest with no authorization
 * check of any kind between the caller and the write. `mergeIntoLead` rewrites
 * a lead's fields, can advance its pipeline status and appends activity rows.
 * `findMatchingLead` answers whether a given email address or phone number is
 * already in the database - a lookup nobody outside the app should be able to
 * run against real customer records.
 *
 * Nothing about either wanted to be an action. Every caller is server-side
 * already - the Zapier and JustCall handlers, the REST route, and the gated
 * actions in `lib/actions/leads.ts` itself - and two of those have no session
 * at all, which is precisely why an action was the wrong shape. Each caller
 * keeps its own gate.
 *
 * Same argument, and the same fix, as `lib/leads/onboarding.ts` and the split
 * of `lib/actions/agreement.ts` into `lib/requirements/`.
 */

// ============================================
// PIPELINE STATUS ORDER (used for auto-advancement)
// ============================================

const PIPELINE_ORDER: LeadStatus[] = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'PROSPECT', 'WON',
]

export function shouldAdvanceStatus(current: LeadStatus, suggested: LeadStatus): boolean {
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
