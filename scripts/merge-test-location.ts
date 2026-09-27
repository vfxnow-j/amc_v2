/**
 * Retire the seed/test "LA Office" location (456 Hollywood Blvd) by merging it
 * into the real primary, VFXnow LA (134 W Verdugo Ave, Burbank).
 *
 * Units landed there because the PO receiving form defaulted to the first
 * location alphabetically. Nothing physically moved, so this is a CORRECTION,
 * not a transfer: no AssetTransfer rows (those mean a physical move). Each unit
 * gets an audit_logs row recording old → new location.
 *
 * Also repoints audit_items.expectedLocationId (plain string, no FK), then
 * deletes the test location.
 *
 * DRY RUN by default. `--execute` writes, after saving prior values to backups/.
 *
 * Run: npx tsx scripts/merge-test-location.ts [--execute]
 *
 * Ported from v1, which ran it on 2026-09-17 (130 units, 43 audit items), onto
 * v2's guarded client, so v2 matches without waiting on a sync. v2 has no other
 * reference to the location: no PO ship-to, transfer, child or inventory audit.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
// v2's client, so the db-guard refuses anything but v2's database.
import { prisma } from '../src/lib/prisma'

const EXECUTE = process.argv.includes('--execute')
const FROM_ID = 'office-la'
const NOTE = 'Location correction: "LA Office" (456 Hollywood Blvd) was a seed/test address; merged into VFXnow LA'

async function main() {
  const from = await prisma.location.findUnique({
    where: { id: FROM_ID },
    include: { _count: { select: { purchaseOrders: true, transfersFrom: true, transfersTo: true, childLocations: true } } },
  })
  if (!from) {
    console.log('LA Office already gone — nothing to do.')
    return
  }
  const to = await prisma.location.findFirst({ where: { name: 'VFXnow LA', address: { contains: 'Verdugo' } } })
  if (!to) throw new Error('VFXnow LA (134 W Verdugo) not found')

  const blockers = Object.entries(from._count).filter(([, n]) => (n as number) > 0)
  if (blockers.length) throw new Error(`LA Office still referenced by: ${blockers.map(([k, n]) => `${k}=${n}`).join(', ')}`)

  const units = await prisma.assetUnit.findMany({
    where: { locationId: FROM_ID },
    select: { id: true, barcode: true, status: true, asset: { select: { name: true } } },
    orderBy: { barcode: 'asc' },
  })
  const auditItems: { id: string }[] = await prisma.$queryRawUnsafe(
    `select id from audit_items where "expectedLocationId" = $1`, FROM_ID,
  )

  const byStatus: Record<string, number> = {}
  for (const u of units) byStatus[u.status] = (byStatus[u.status] || 0) + 1
  console.log(`\n${EXECUTE ? 'EXECUTE' : 'DRY RUN'} — merge "${from.name}" (${from.address}) → "${to.name}" (${to.address})\n`)
  console.log(`Units to move: ${units.length}  ${Object.entries(byStatus).map(([s, n]) => `${s}:${n}`).join('  ')}`)
  for (const u of units) console.log(`  ${u.barcode}\t${u.status}\t${u.asset.name.slice(0, 60)}`)
  console.log(`Audit items to repoint: ${auditItems.length}`)
  console.log(`Then delete location "${from.name}" (${FROM_ID}).`)

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to write.')
    return
  }

  mkdirSync('backups', { recursive: true })
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const backupPath = `backups/merge-test-location-before-${ts}.json`
  writeFileSync(backupPath, JSON.stringify({
    location: { id: from.id, name: from.name, address: from.address, description: from.description, parentLocationId: from.parentLocationId, taxRate: from.taxRate, taxLabel: from.taxLabel },
    unitIds: units.map((u) => u.id),
    auditItemIds: auditItems.map((a) => a.id),
  }, null, 2))
  console.log(`\nBackup: ${backupPath}`)

  await prisma.$transaction(async (tx) => {
    await tx.assetUnit.updateMany({ where: { locationId: FROM_ID }, data: { locationId: to.id } })
    await tx.$executeRawUnsafe(`update audit_items set "expectedLocationId" = $1 where "expectedLocationId" = $2`, to.id, FROM_ID)
    await tx.auditLog.createMany({
      data: units.map((u) => ({
        action: 'UPDATE',
        entityType: 'AssetUnit',
        entityId: u.id,
        oldValues: { locationId: FROM_ID, location: from.name },
        newValues: { locationId: to.id, location: to.name, note: NOTE },
      })),
    })
    await tx.location.delete({ where: { id: FROM_ID } })
    await tx.auditLog.create({
      data: {
        action: 'DELETE',
        entityType: 'Location',
        entityId: FROM_ID,
        oldValues: { name: from.name, address: from.address },
        newValues: { mergedInto: to.id, note: NOTE, unitsMoved: units.length, auditItemsRepointed: auditItems.length },
      },
    })
  })
  console.log(`Moved ${units.length} units, repointed ${auditItems.length} audit items, deleted "${from.name}".`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
