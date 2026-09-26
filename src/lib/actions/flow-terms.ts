'use server'

/**
 * Flow subscription terms: the house wording (Settings → Documents), the per-order
 * extension rate, and staff confirming autopay. Ported from v1
 * (src/lib/actions/flow-terms.ts).
 *
 * A 'use server' module exports async functions only (v1 eb12bb2). The settings
 * key and loader live in lib/flow-terms-server.ts.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireAdmin, requireEditor } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { loadFlowTermsSettings, FLOW_TERMS_SETTING_KEY } from '@/lib/flow-terms-server'
import { FLOW_TERMS_DEFAULTS, unknownPlaceholders, type FlowTermsSettings } from '@/lib/pricing/flow-terms'

type TermsInput = Omit<FlowTermsSettings, 'version'>

export async function getFlowTermsSettings(): Promise<FlowTermsSettings> {
  const authResult = await requireAuth()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  return loadFlowTermsSettings()
}

function validate(next: TermsInput) {
  const pct = (n: number, label: string) => {
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label} must be between 0 and 100.`)
  }
  pct(next.cancellationPct, 'Cancellation %')
  pct(next.extensionPct, 'Extension %')
  if (!Number.isInteger(next.endNoticeDays) || next.endNoticeDays < 0 || next.endNoticeDays > 365) {
    throw new Error('Notice days must be a whole number from 0 to 365.')
  }
  if (!/^https?:\/\//.test(next.generalTermsUrl)) throw new Error('The General Terms link must start with http:// or https://')
  if (!next.clauses.length) throw new Error('Keep at least one clause.')
  for (const c of next.clauses) {
    if (!c.title.trim() || !c.body.trim()) throw new Error('Every clause needs a title and wording.')
    const bad = unknownPlaceholders(c.title + c.body)
    if (bad.length) throw new Error(`Unknown placeholder(s) in "${c.title}": ${bad.map((b) => `{{${b}}}`).join(', ')}`)
  }
}

async function audit(entry: Parameters<typeof logAudit>[0]) {
  try {
    await logAudit(entry)
  } catch {
    // Audit is best-effort, as elsewhere.
  }
}

async function write(next: TermsInput, userId: string): Promise<FlowTermsSettings> {
  const current = await loadFlowTermsSettings()
  const value: FlowTermsSettings = { ...next, version: current.version + 1 }
  await prisma.setting.upsert({
    where: { key: FLOW_TERMS_SETTING_KEY },
    create: { key: FLOW_TERMS_SETTING_KEY, value },
    update: { value },
  })
  await audit({
    action: 'UPDATE',
    entityType: 'Settings',
    entityId: FLOW_TERMS_SETTING_KEY,
    oldValues: { version: current.version },
    newValues: { version: value.version, cancellationPct: value.cancellationPct, extensionPct: value.extensionPct, endNoticeDays: value.endNoticeDays, clauses: value.clauses.length },
    userId,
  })
  revalidatePath('/dashboard/settings/documents')
  return value
}

export async function saveFlowTermsSettings(next: TermsInput): Promise<FlowTermsSettings> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  const clean: TermsInput = {
    cancellationPct: Number(next.cancellationPct),
    extensionPct: Number(next.extensionPct),
    endNoticeDays: Number(next.endNoticeDays),
    generalTermsUrl: String(next.generalTermsUrl || '').trim(),
    clauses: (next.clauses || []).map((c) => ({ title: String(c.title || '').trim(), body: String(c.body || '').trim() })),
  }
  validate(clean)
  return write(clean, authResult.userId)
}

export async function resetFlowTermsWording(): Promise<FlowTermsSettings> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  const current = await loadFlowTermsSettings()
  const rest: TermsInput = {
    cancellationPct: current.cancellationPct,
    extensionPct: current.extensionPct,
    endNoticeDays: current.endNoticeDays,
    generalTermsUrl: current.generalTermsUrl,
    clauses: current.clauses,
  }
  return write({ ...rest, clauses: structuredClone(FLOW_TERMS_DEFAULTS.clauses) }, authResult.userId)
}

/** Per-order extension rate (% of the final payment). Locked once the client has agreed. */
export async function updateFlowExtensionPct(reservationId: string, pct: number | null): Promise<void> {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) throw new Error('Extension % must be between 0 and 100.')
  const r = await prisma.reservation.findUnique({ where: { id: reservationId } })
  if (!r || r.reservationType !== 'FLOW') throw new Error('Only Flow orders have an extension rate.')
  if (r.flowTermsSnapshot) throw new Error('The client has already agreed to these terms — the extension rate is locked.')
  if ((r.flowPeriodsBilled ?? 0) > 0) throw new Error('This Flow order has already been billed.')
  const next = pct == null ? null : Math.round(pct * 100) / 100
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { flowExtensionPct: next },
  })
  await audit({
    action: 'UPDATE',
    entityType: 'Reservation',
    entityId: reservationId,
    oldValues: { flowExtensionPct: r.flowExtensionPct == null ? null : Number(r.flowExtensionPct) },
    newValues: { flowExtensionPct: next },
    userId: authResult.userId,
  })
  revalidatePath(`/dashboard/orders/${reservationId}`)
}

/** Staff confirm the recurring charge is set up in the billing system (no processor yet). */
export async function markFlowAutopaySetup(reservationId: string): Promise<void> {
  const authResult = await requireEditor()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  const r = await prisma.reservation.findUnique({ where: { id: reservationId } })
  if (!r || r.reservationType !== 'FLOW') throw new Error('Only Flow orders have autopay.')
  if (r.flowAutopaySetupAt) return
  const setupAt = new Date()
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { flowAutopaySetupAt: setupAt, flowAutopaySetupById: authResult.userId },
  })
  await audit({
    action: 'UPDATE',
    entityType: 'Reservation',
    entityId: reservationId,
    oldValues: { flowAutopaySetupAt: null },
    newValues: { flowAutopaySetupAt: setupAt.toISOString() },
    userId: authResult.userId,
  })
  revalidatePath(`/dashboard/orders/${reservationId}`)
}
