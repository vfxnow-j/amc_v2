'use server'

/**
 * Settings → Portal offers: staff curate what the client portal may show.
 * Offers are opt-in (owner, 2026-09-26) — nothing is visible until published —
 * and staff write the portal specs and software tags, since v2 has no spec data.
 *
 * Admin only. Every input is validated here; the form's checks are a courtesy.
 */
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'

const PATH = '/dashboard/settings/portal-offers'
// Rent-to-own is never offered in the portal (owner, 2026-09-26): it stays a
// staff-only order type in AMC. Sale is one-time, from the product's sale price.
const SOLUTIONS = ['rental', 'flow', 'sale'] as const
const TERMS: Record<'flow', number[]> = { flow: [12, 24, 36, 48] }

export type PortalOfferInput = {
  id?: string | null
  /** POOL only when editing an existing pool offer — its kind and pool are kept as they are. */
  kind: 'ASSET' | 'PACKAGE' | 'POOL'
  targetId: string
  title: string
  slug?: string | null
  blurb?: string | null
  solutions: string[]
  termsBySolution: { flow?: number[] }
  software: string[]
  specs: { key: string; value: string }[]
  isPublic: boolean
  isVisible: boolean
  sortOrder: number
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002'
}

async function gate(): Promise<void> {
  const auth = await requireAdmin()
  if (!auth.authorized) throw new Error(auth.error || 'Only an administrator can change portal offers.')
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function clean(raw: unknown, keepPool: boolean) {
  if (!raw || typeof raw !== 'object') throw new Error('Nothing to save.')
  const d = raw as Record<string, unknown>
  const kind = keepPool ? 'POOL' : d.kind === 'PACKAGE' ? 'PACKAGE' : d.kind === 'ASSET' ? 'ASSET' : null
  if (!kind) throw new Error('Choose whether the offer is an asset or a package.')
  const targetId = keepPool ? '' : str(d.targetId, 64)
  if (!keepPool && !targetId) throw new Error(kind === 'ASSET' ? 'Choose the asset this offer sells.' : 'Choose the package.')
  const title = str(d.title, 120)
  if (!title) throw new Error('Give the offer a title.')
  const slug = slugify(str(d.slug, 80) || title)
  if (!slug) throw new Error('The slug needs at least one letter or digit.')
  const solutions = SOLUTIONS.filter((s) => Array.isArray(d.solutions) && d.solutions.includes(s))
  if (!solutions.length) throw new Error('Choose at least one solution.')
  const rawTerms = (d.termsBySolution && typeof d.termsBySolution === 'object' ? d.termsBySolution : {}) as Record<string, unknown>
  const termsBySolution: Record<string, number[]> = {}
  for (const s of ['flow'] as const) {
    if (!solutions.includes(s)) continue
    const list = Array.isArray(rawTerms[s]) ? (rawTerms[s] as unknown[]) : []
    const terms = TERMS[s].filter((t) => list.includes(t))
    if (!terms.length) throw new Error('Choose at least one Flow term.')
    termsBySolution[s] = terms
  }
  const software = [...new Set((Array.isArray(d.software) ? d.software : []).map((t) => str(t, 40)).filter(Boolean))].slice(0, 30)
  const specs = (Array.isArray(d.specs) ? d.specs : [])
    .map((r) => (r && typeof r === 'object' ? { key: str((r as Record<string, unknown>).key, 60), value: str((r as Record<string, unknown>).value, 200) } : null))
    .filter((r): r is { key: string; value: string } => !!r && !!r.key)
    .slice(0, 40)
  const sortOrder = Number.isInteger(d.sortOrder) ? Math.max(-9999, Math.min(9999, d.sortOrder as number)) : 0
  return {
    // A pool offer's kind and pool are never rewritten from this form.
    ...(keepPool
      ? {}
      : { kind, assetId: kind === 'ASSET' ? targetId : null, packageTemplateId: kind === 'PACKAGE' ? targetId : null }),
    title,
    slug,
    blurb: str(d.blurb, 1000) || null,
    solutions: [...solutions],
    termsBySolution: termsBySolution as Prisma.InputJsonValue,
    software,
    specs: specs as Prisma.InputJsonValue,
    isPublic: d.isPublic === true,
    isVisible: d.isVisible === true,
    sortOrder,
  }
}

/** Create (no id) or update an offer. Returns its id. */
export async function savePortalOffer(input: PortalOfferInput): Promise<{ id: string }> {
  await gate()
  const id = typeof input?.id === 'string' && input.id ? input.id : null
  const before = id
    ? await prisma.portalOffer.findUnique({ where: { id }, select: { id: true, kind: true, title: true, isVisible: true, isPublic: true } })
    : null
  if (id && !before) throw new Error('That offer no longer exists.')
  const keepPool = before?.kind === 'POOL'
  if (!keepPool && input?.kind === 'POOL') throw new Error('Pool offers cannot be made here — choose an item or a package.')
  const data = clean(input, keepPool)

  if (data.assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: data.assetId }, select: { id: true, retiredAt: true } })
    if (!asset) throw new Error('That asset no longer exists.')
    if (asset.retiredAt) throw new Error('That asset is retired, so it cannot be offered.')
  } else if (data.packageTemplateId) {
    const tpl = await prisma.packageTemplate.findUnique({ where: { id: data.packageTemplateId }, select: { id: true, isActive: true } })
    if (!tpl) throw new Error('That package no longer exists.')
    if (!tpl.isActive) throw new Error('That package is inactive, so it cannot be offered. Reactivate it under Packages first.')
  }
  const slugTaken = () => new Error(`Another offer already uses the slug “${data.slug}”.`)
  const clash = await prisma.portalOffer.findUnique({ where: { slug: data.slug }, select: { id: true } })
  if (clash && clash.id !== id) throw slugTaken()

  let saved: { id: string }
  try {
    saved = id
      ? await prisma.portalOffer.update({ where: { id }, data, select: { id: true } })
      : await prisma.portalOffer.create({ data: data as Prisma.PortalOfferUncheckedCreateInput, select: { id: true } })
  } catch (error) {
    // Two saves racing for one slug: the unique index decides; say it plainly.
    if (isUniqueViolation(error)) throw slugTaken()
    throw error
  }

  await logAudit({
    action: id ? 'UPDATE' : 'CREATE',
    entityType: 'Portal',
    entityId: saved.id,
    oldValues: before
      ? { kind: 'portal_offer', id: before.id, offerKind: before.kind, title: before.title, isVisible: before.isVisible, isPublic: before.isPublic }
      : undefined,
    newValues: { kind: 'portal_offer', title: data.title, slug: data.slug, isVisible: data.isVisible, isPublic: data.isPublic, solutions: data.solutions },
  })
  revalidatePath(PATH)
  return saved
}

export async function deletePortalOffer(id: string): Promise<void> {
  await gate()
  if (typeof id !== 'string' || !id) throw new Error('Which offer?')
  const before = await prisma.portalOffer.findUnique({ where: { id }, select: { title: true, slug: true } })
  if (!before) return
  await prisma.portalOffer.delete({ where: { id } })
  await logAudit({ action: 'DELETE', entityType: 'Portal', entityId: id, oldValues: { kind: 'portal_offer', ...before } })
  revalidatePath(PATH)
}
