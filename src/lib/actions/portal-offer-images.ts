'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { deleteOfferImageFile } from '@/lib/portal/images'

/** Settings → Portal offers → Images: remove, reorder, describe. Admin only. Upload is /api/portal-images. */

const PATH = '/dashboard/settings/portal-offers'
const idSchema = z.string().trim().regex(/^[a-z0-9]{10,40}$/i, 'Image not found')

async function admin() {
  const result = await requireAdmin()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Admin access required')
  return result.userId
}

export async function deletePortalOfferImage(imageId: string): Promise<void> {
  const userId = await admin()
  const id = idSchema.parse(imageId)
  const row = await prisma.portalOfferImage.findUnique({ where: { id }, select: { offerId: true, version: true } })
  if (!row) throw new Error('That image no longer exists — refresh the page.')
  await prisma.portalOfferImage.delete({ where: { id } })
  await deleteOfferImageFile(row.offerId, id)
  await logAudit({ action: 'DELETE', entityType: 'Portal', entityId: row.offerId, oldValues: { kind: 'portal_offer_image', id, version: row.version }, userId })
  revalidatePath(PATH)
}

/** Swap with the neighbour in the given direction; the first image is the one shown first. */
export async function movePortalOfferImage(imageId: string, direction: 'up' | 'down'): Promise<void> {
  await admin()
  const id = idSchema.parse(imageId)
  const row = await prisma.portalOfferImage.findUnique({ where: { id }, select: { offerId: true } })
  if (!row) throw new Error('That image no longer exists — refresh the page.')
  const list = await prisma.portalOfferImage.findMany({ where: { offerId: row.offerId }, orderBy: { sortOrder: 'asc' }, select: { id: true } })
  const at = list.findIndex((i) => i.id === id)
  const to = direction === 'up' ? at - 1 : at + 1
  if (at < 0 || to < 0 || to >= list.length) return
  ;[list[at], list[to]] = [list[to], list[at]]
  await prisma.$transaction(list.map((i, index) => prisma.portalOfferImage.update({ where: { id: i.id }, data: { sortOrder: index } })))
  revalidatePath(PATH)
}

/**
 * Alt text is the one thing on an image that changes in place: it doesn't
 * change the picture, so (id, version) still names the same bytes.
 */
export async function setPortalOfferImageAlt(imageId: string, alt: string): Promise<void> {
  await admin()
  const id = idSchema.parse(imageId)
  const text = z.string().max(200, 'Keep alt text under 200 characters').parse(alt).trim()
  await prisma.portalOfferImage.update({ where: { id }, data: { alt: text || null } })
  revalidatePath(PATH)
}
