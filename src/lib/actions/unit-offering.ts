'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireEditor } from '@/lib/auth-utils'
import { logAudit } from '@/lib/actions/audit'
import { UNIT_OFFERINGS, type UnitOfferingValue } from '@/lib/inventory/unit-offering'

/**
 * What a unit may be offered to a client as — rental, sale, Flow (owner,
 * 2026-09-26). The portal shows a product under a solution only while it has
 * units ticked for it (docs/portal-api.md, Phase 2). Editors set it per unit on
 * the unit screen, or for every unit of a model at once on the asset screen.
 *
 * Sold and retired units are left alone by the bulk set: they are out of the
 * fleet, and ticking them would only muddy what their record says happened.
 */

const offeringsSchema = z
  .array(z.enum(UNIT_OFFERINGS, { error: 'Not an offering' }))
  .max(UNIT_OFFERINGS.length)
  .transform((list) => UNIT_OFFERINGS.filter((o) => list.includes(o)))

const idSchema = z.string().trim().min(1).max(64)

async function editor() {
  const result = await requireEditor()
  if (!result.authorized || !result.userId) throw new Error(result.error ?? 'Editor access required')
  return result.userId
}

export async function setUnitOffering(unitId: string, offerings: UnitOfferingValue[]): Promise<void> {
  const userId = await editor()
  const id = idSchema.parse(unitId)
  const next = offeringsSchema.parse(offerings)

  const before = await prisma.assetUnit.findUnique({ where: { id }, select: { assetId: true, offeredAs: true } })
  if (!before) throw new Error('That unit no longer exists — refresh the page.')
  await prisma.assetUnit.update({ where: { id }, data: { offeredAs: next } })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Asset',
    entityId: before.assetId,
    oldValues: { unitId: id, offeredAs: before.offeredAs },
    newValues: { unitId: id, offeredAs: next },
    userId,
  })
  revalidatePath(`/dashboard/units/${id}`)
  revalidatePath(`/dashboard/assets/${before.assetId}`)
}

/** Every in-fleet unit of the model gets exactly this set. Returns how many changed. */
export async function setAssetOffering(assetId: string, offerings: UnitOfferingValue[]): Promise<{ updated: number }> {
  const userId = await editor()
  const id = idSchema.parse(assetId)
  const next = offeringsSchema.parse(offerings)

  const { count } = await prisma.assetUnit.updateMany({
    where: { assetId: id, status: { notIn: ['SOLD', 'RETIRED'] } },
    data: { offeredAs: next },
  })

  await logAudit({
    action: 'UPDATE',
    entityType: 'Asset',
    entityId: id,
    newValues: { offeredAs: next, units: count, scope: 'every in-fleet unit' },
    userId,
  })
  revalidatePath(`/dashboard/assets/${id}`)
  return { updated: count }
}
