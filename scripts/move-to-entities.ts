/**
 * Move units tagged GPLxxxx / METAxxxx out of VFXnow's asset table into their entity databases.
 *
 *   npx tsx scripts/move-to-entities.ts            # DRY RUN: prints the plan, writes nothing anywhere
 *   npx tsx scripts/move-to-entities.ts --apply    # does it (see applyMove)
 *
 * Owner's call 2026-10-23: the GPL units come off RES-2026-00002 and out of VFXnow's
 * inventory. Units RETIRED in v2 with no reason or date are an unverified import: they were
 * held back on the first run, then moved too (owner, same day) with their tags kept and a
 * note on the unit, to be looked into.
 */
import 'dotenv/config'
import { entityDb } from '@/lib/entities/client'
import { writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma'

const TARGETS = [{ prefix: /^GPL/i, slug: 'gpl-technologies' }, { prefix: /^META/i, slug: 'meta' }]

async function main() {
  const units = await prisma.assetUnit.findMany({
    where: { OR: [{ barcode: { startsWith: 'GPL', mode: 'insensitive' } }, { barcode: { startsWith: 'META', mode: 'insensitive' } }] },
    include: { asset: { include: { category: true } }, location: true, checkouts: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } }, include: { reservation: true } }, reservationItemUnits: true },
    orderBy: { barcode: 'asc' },
  })
  for (const t of TARGETS) {
    const ent = await prisma.entity.findUnique({ where: { slug: t.slug } })
    if (!ent) { console.log(`\n## ${t.slug}: ENTITY NOT FOUND`); continue }
    const db = entityDb(ent.dbName)
    const mine = units.filter((u) => t.prefix.test(u.barcode))
    const [items, existingTags] = await Promise.all([db.item.findMany({ select: { name: true } }), db.unit.findMany({ select: { scanTag: true } })])
    const tagSet = new Set(existingTags.map((x) => x.scanTag))
    console.log(`\n## ${ent.name} (${ent.dbName}): ${mine.length} units; entity has ${items.length} items, ${tagSet.size} units today`)
    const byAsset = new Map<string, typeof mine>()
    for (const u of mine) byAsset.set(u.asset.name, [...(byAsset.get(u.asset.name) ?? []), u])
    // Location is defined after the transfer, so units enter with none.
    for (const [name, us] of byAsset) {
      const has = items.some((i) => i.name === name)
      console.log(`- item "${name}" (${has ? 'exists' : 'NEW'}${us[0].asset.category ? ', ' + us[0].asset.category.name : ''}): ${us.length} units`)
      for (const u of us) {
        const flags = [
          tagSet.has(u.barcode) && 'TAG ALREADY IN ENTITY',
          u.status === 'RETIRED' && 'RETIRED in v2 with no reason/date (unverified import): enters as IN_STORAGE',

          u.checkouts.length > 0 && `checkout on ${u.checkouts[0].reservation?.reservationNumber}`,
          u.serialNumber && u.serialNumber !== u.serialNumber.trim() && 'serial has stray space (will trim)',
        ].filter(Boolean)
        const next = u.status === 'CHECKED_OUT' ? 'DEPLOYED' : 'IN_STORAGE'
        console.log(`    ${u.barcode} -> ${next}  serial=${u.serialNumber?.trim() ?? '-'}  ${u.status}  @${u.location?.name ?? '-'}${flags.length ? '  <' + flags.join('; ') + '>' : ''}`)
      }
    }
  }
}
async function orderImpact() {
  const res = await prisma.reservation.findUnique({ where: { reservationNumber: 'RES-2026-00002' }, include: { items: { include: { asset: true, units: { include: { assetUnit: true } } } } } })
  if (!res) return
  console.log(`\n## ${res.reservationNumber} (${res.status}): GPL units come off, VFXnow-tagged units stay`)
  let stay = 0, go = 0
  for (const it of res.items) {
    const g = it.units.filter((x) => /^(GPL|META)/i.test(x.assetUnit.barcode)).length, k = it.units.length - g
    stay += k; go += g
    if (g) console.log(`- ${it.asset?.name}: qty ${it.quantity}, ${g} GPL unit(s) removed, ${k} stay${k === 0 ? '  <line would have NO units left>' : ''}`)
  }
  console.log(`  ${go} unit rows removed, ${stay} VFXnow-tagged unit rows stay`)
}
/**
 * Copy to the entity first, check the copy, then remove from VFXnow in one transaction.
 * The two databases cannot share a transaction, so the order is what makes it safe: a failure
 * before the removal leaves copies in the entity and VFXnow untouched, and a rerun skips any tag
 * already there. Everything removed is written to reports/ first.
 */
async function applyMove() {
  const OUT = 'reports/gpl-meta-move-20261023'
  const actor = (await prisma.user.findUnique({ where: { email: 'jtylerroen@gmail.com' } })) ?? (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } }))
  if (!actor) throw new Error('No user to record the movements against.')

  const all = await prisma.assetUnit.findMany({
    where: { OR: TARGETS.map((t) => ({ barcode: { startsWith: t.slug === 'meta' ? 'META' : 'GPL', mode: 'insensitive' as const } })) },
    include: { asset: { include: { category: true } }, checkouts: true, reservationItemUnits: true },
    orderBy: { barcode: 'asc' },
  })
  const held: typeof all = []
  const moving = all
  writeFileSync(`${OUT}/removed-from-v2-${Date.now()}.json`, JSON.stringify({ takenAt: new Date().toISOString(), moving, held: held.map((u) => u.barcode) }, null, 2))
  console.log(`${moving.length} units to move, ${held.length} retired units held back: ${held.map((u) => u.barcode).join(', ') || '-'}`)

  const moved: string[] = []
  for (const t of TARGETS) {
    const ent = await prisma.entity.findUnique({ where: { slug: t.slug } })
    if (!ent) throw new Error(`Entity ${t.slug} not found.`)
    const db = entityDb(ent.dbName)
    for (const u of moving.filter((x) => t.prefix.test(x.barcode))) {
      if (await db.unit.findUnique({ where: { scanTag: u.barcode } })) { moved.push(u.id); continue }
      const category = u.asset.category
        ? await db.category.upsert({ where: { name: u.asset.category.name }, create: { name: u.asset.category.name }, update: {} })
        : null
      const item =
        (await db.item.findFirst({ where: { name: u.asset.name } })) ??
        (await db.item.create({
          data: { name: u.asset.name, description: u.asset.description, manufacturer: u.asset.manufacturer, model: u.asset.model, categoryId: category?.id ?? null, trackingMode: 'SERIALIZED' },
        }))
      await db.$transaction(async (tx) => {
        const unit = await tx.unit.create({
          data: {
            itemId: item.id,
            serial: u.serialNumber?.trim() || null,
            scanTag: u.barcode,
            condition: u.condition,
            notes: u.status === 'RETIRED' ? [u.notes, 'Marked Retired in VFXnow (unverified import). Owner to check.'].filter(Boolean).join(' | ') : u.notes,
            status: u.status === 'CHECKED_OUT' ? 'DEPLOYED' : 'IN_STORAGE',
            currentLocationId: null,
          },
        })
        await tx.movement.create({
          data: { type: 'RECEIVE', itemId: item.id, unitId: unit.id, quantity: 1, reference: 'Moved from VFXnow inventory', notes: 'Moved 2026-10-23; location to be set by the owner.', actorUserId: actor.id },
        })
      })
      moved.push(u.id)
    }
    const copied = await db.unit.count({ where: { scanTag: { in: moving.filter((x) => t.prefix.test(x.barcode)).map((x) => x.barcode) } } })
    const want = moving.filter((x) => t.prefix.test(x.barcode)).length
    console.log(`${ent.name}: ${copied} of ${want} units present in ${ent.dbName}`)
    if (copied !== want) throw new Error(`Copy check failed for ${t.slug}; nothing was removed from VFXnow.`)
  }

  const ids = moving.map((u) => u.id)
  const assetIds = [...new Set(moving.map((u) => u.assetId))]
  await prisma.$transaction(async (tx) => {
    const lineIds = [...new Set(moving.flatMap((u) => u.reservationItemUnits.map((r) => r.reservationItemId)))]
    await tx.checkout.deleteMany({ where: { assetUnitId: { in: ids } } })
    await tx.reservationItemUnit.deleteMany({ where: { assetUnitId: { in: ids } } })
    // A custody line left with no units and no money is nothing, so it goes with them. A line with a price stays.
    const empty = await tx.reservationItem.findMany({
      where: { id: { in: lineIds }, units: { none: {} }, components: { none: {} } },
      select: { id: true, subtotal: true, rate: true },
    })
    const removable = empty.filter((l) => Number(l.subtotal) === 0 && Number(l.rate) === 0).map((l) => l.id)
    await tx.reservationItem.deleteMany({ where: { id: { in: removable } } })
    console.log(`order lines removed: ${removable.length} of ${lineIds.length} touched (priced lines stay)`)
    await tx.assetUnit.deleteMany({ where: { id: { in: ids } } })
    for (const assetId of assetIds) {
      const remaining = await tx.assetUnit.count({ where: { assetId, status: { notIn: ['SOLD', 'RETIRED'] } } })
      await tx.asset.update({ where: { id: assetId }, data: { totalQuantity: remaining } })
    }
  })
  console.log(`Removed ${ids.length} units from VFXnow.`)
}

const apply = process.argv.includes('--apply')
;(apply ? applyMove() : main().then(orderImpact)).catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => process.exit())
