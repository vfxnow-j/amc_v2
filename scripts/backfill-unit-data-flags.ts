/**
 * Flag the units already in the database that fail the barcode + serial check, so they show on Inventory -> Missing data
 * with the flag set.
 *
 *   npx tsx scripts/backfill-unit-data-flags.ts           # DRY RUN: counts only, writes nothing
 *   npx tsx scripts/backfill-unit-data-flags.ts --apply   # sets dataFlag + dataFlaggedAt on each (run on request only)
 *
 * Retired and sold units are left alone, and a unit already flagged is not touched. The flag carries no user: it was set
 * by this script, not by a person skipping a prompt.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { checkUnit } from '../src/lib/scan/completeness'

const APPLY = process.argv.includes('--apply')

async function main() {
  const units = await prisma.assetUnit.findMany({
    where: { status: { notIn: ['RETIRED', 'SOLD'] }, dataFlag: null },
    select: { id: true, barcode: true, serialNumber: true, asset: { select: { requiresSerial: true } } },
  })
  const gaps = units.flatMap((u) => {
    const r = checkUnit({ barcode: u.barcode, serialNumber: u.serialNumber, requiresSerial: u.asset.requiresSerial })
    return r.complete ? [] : [{ id: u.id, gap: r.gap }]
  })
  const byGap = gaps.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.gap]: (acc[g.gap] ?? 0) + 1 }), {})
  console.log(`${gaps.length} of ${units.length} unflagged live units are incomplete.`, byGap)
  if (!APPLY) {
    console.log('Dry run. Pass --apply to flag them.')
    return
  }
  const now = new Date()
  for (const g of gaps) {
    await prisma.assetUnit.update({ where: { id: g.id }, data: { dataFlag: g.gap, dataFlaggedAt: now } })
  }
  console.log(`Flagged ${gaps.length}.`)
}

main().finally(() => prisma.$disconnect())
