'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'

/**
 * The portal card on an item or a package (owner, 2026-09-26): a toggle, not a
 * form. Turning it on lists the item or package in the client portal; its name,
 * description and specs are read live from it, and the solutions it is sold as
 * come from its units' Offered-as ticks. One listing per item or package — the
 * PortalOffer row is just the switch, the website switch and its images.
 */

export type ListingTarget = { kind: 'ASSET' | 'PACKAGE'; id: string }

async function admin(): Promise<string> {
  const auth = await requireAdmin()
  if (!auth.authorized || !auth.userId) throw new Error(auth.error || 'Only an administrator can change what the portal shows.')
  return auth.userId
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function pathFor(t: ListingTarget) {
  return t.kind === 'ASSET' ? `/dashboard/assets/${t.id}` : `/dashboard/packages/${t.id}`
}

/**
 * Show or hide an item or package in the portal (and its price band on the
 * website). Every solution is allowed on the listing; which appear is decided
 * live by the units ticked for each (a solution nothing is ticked for is never
 * listed). Flow terms are the tier's.
 */
export async function setPortalListing(target: ListingTarget, change: { isVisible?: boolean; isPublic?: boolean }): Promise<void> {
  const userId = await admin()
  if (!target || (target.kind !== 'ASSET' && target.kind !== 'PACKAGE') || typeof target.id !== 'string' || !/^[a-z0-9]{10,40}$/i.test(target.id)) {
    throw new Error('Which item or package?')
  }
  const where = target.kind === 'ASSET' ? { assetId: target.id } : { packageTemplateId: target.id }
  let name: string
  if (target.kind === 'ASSET') {
    const asset = await prisma.asset.findUnique({ where: { id: target.id }, select: { name: true, retiredAt: true } })
    if (!asset) throw new Error('That item no longer exists.')
    if (asset.retiredAt && change.isVisible) throw new Error('A retired item cannot be shown in the portal.')
    name = asset.name
  } else {
    const tpl = await prisma.packageTemplate.findUnique({ where: { id: target.id }, select: { name: true, isActive: true } })
    if (!tpl) throw new Error('That package no longer exists.')
    if (!tpl.isActive && change.isVisible) throw new Error('An archived package cannot be shown in the portal.')
    name = tpl.name
  }

  const existing = await prisma.portalOffer.findFirst({ where, select: { id: true, isVisible: true, isPublic: true } })
  const data = {
    ...(change.isVisible !== undefined ? { isVisible: change.isVisible } : {}),
    ...(change.isPublic !== undefined ? { isPublic: change.isPublic } : {}),
    title: name,
  }
  const saved = existing
    ? await prisma.portalOffer.update({ where: { id: existing.id }, data, select: { id: true, isVisible: true, isPublic: true } })
    : await prisma.portalOffer.create({
        data: {
          ...where,
          ...data,
          kind: target.kind,
          // Stable and unique: the name for reading, the id for uniqueness.
          slug: `${slugify(name) || 'item'}-${target.id.slice(-6)}`,
          solutions: ['rental', 'flow', 'sale'],
        },
        select: { id: true, isVisible: true, isPublic: true },
      })

  await logAudit({
    action: existing ? 'UPDATE' : 'CREATE',
    entityType: 'Portal',
    entityId: saved.id,
    oldValues: existing ? { kind: 'portal_listing', isVisible: existing.isVisible, isPublic: existing.isPublic } : undefined,
    newValues: { kind: 'portal_listing', target: target.kind, targetId: target.id, isVisible: saved.isVisible, isPublic: saved.isPublic },
    userId,
  })
  revalidatePath(pathFor(target))
}
