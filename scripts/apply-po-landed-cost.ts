/**
 * Back-apply PO landed cost to units received before the feature existed.
 *
 * DRY RUN by default. `--execute` writes, after saving the touched units'
 * prior values to backups/.
 *
 * A unit's landedCostAdjustment = its share of the PO's extras
 * (freight + fees + tax − discount), by value across tracked lines — the same
 * allocateLandedCost() the app uses at receiving. Always SET, so re-running
 * converges.
 *
 * Candidate units per PO:
 *   linked  purchaseOrderId = PO (receipts since the PO trail existed)
 *   legacy  purchaseOrderId NULL, asset on a tracked line, purchaseDate on the
 *           PO's order date (receiving always stamped purchaseDate = orderDate).
 *           These also get purchaseOrderId set, so later PO edits re-derive them.
 *
 * Skipped and listed:
 *   HAND-PRICED  price differs from every tracked line (may already include extras)
 *   AMBIGUOUS    more legacy+linked matches than the line received
 *
 * Run: npx tsx scripts/apply-po-landed-cost.ts [--execute]
 *
 * Ported from v1 (2026-09-17), onto v2's guarded client. v1 has the same
 * column and the sync copies it (v1 wins), so once v1 runs --execute, a sync
 * brings the same figures; running this in v2 first only previews them.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { allocateLandedCost, landedAdjustmentForUnit, toLandedCostPO } from '../src/lib/pricing/landed-cost'
// v2's client, so the db-guard refuses anything but v2's database.
import { prisma } from '../src/lib/prisma'

const EXECUTE = process.argv.includes('--execute')
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')
const money = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2)

type Action = 'set' | 'link+set' | 'unchanged' | 'HAND-PRICED' | 'AMBIGUOUS'
interface Row {
  po: string; poId: string; unitId: string; barcode: string; asset: string; status: string
  price: number | null; current: number; adj: number | null; action: Action; linkedBefore: string | null
}

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: { in: ['RECEIVED', 'PARTIAL'] } },
    include: { items: true },
    orderBy: { poNumber: 'asc' },
  })

  const rows: Row[] = []
  const poSummary: string[] = []

  for (const po of pos) {
    const input = toLandedCostPO(po)
    const net = input.freightAmount + input.feesTotal + input.taxAmount - input.discountAmount
    if (!input.freightAmount && !input.feesTotal && !input.taxAmount && !input.discountAmount) continue
    const allocation = allocateLandedCost(input)
    const tracked = input.items.filter((i) => i.isInventoried && i.assetId)
    const assetIds = [...new Set(tracked.map((i) => i.assetId!))]

    const start = new Date(day(po.orderDate) + 'T00:00:00Z')
    const end = new Date(start.getTime() + 86400000)
    const units = await prisma.assetUnit.findMany({
      where: {
        OR: [
          { purchaseOrderId: po.id },
          { purchaseOrderId: null, assetId: { in: assetIds }, purchaseDate: { gte: start, lt: end } },
        ],
      },
      include: { asset: { select: { name: true } } },
      orderBy: { barcode: 'asc' },
    })

    // Per line: which units match it (by asset + price)
    const byLine = new Map<string, typeof units>()
    const poRows: Row[] = []
    for (const u of units) {
      const price = u.purchasePrice == null ? null : Number(u.purchasePrice)
      const adj = landedAdjustmentForUnit(input, allocation, { assetId: u.assetId, purchasePrice: price })
      const row: Row = {
        po: po.poNumber, poId: po.id, unitId: u.id, barcode: u.barcode, asset: u.asset.name,
        status: u.status, price, current: Number(u.landedCostAdjustment), adj,
        linkedBefore: u.purchaseOrderId,
        action: adj === null ? 'HAND-PRICED' : u.purchaseOrderId ? 'set' : 'link+set',
      }
      if (adj !== null) {
        const line = tracked.find((i) => i.assetId === u.assetId && Math.abs(i.unitPrice - price!) < 0.005)!
        byLine.set(line.id, [...(byLine.get(line.id) || []), u])
      }
      poRows.push(row)
    }

    for (const line of tracked) {
      const matched = byLine.get(line.id) || []
      const received = po.items.find((i) => i.id === line.id)!.receivedQuantity
      if (matched.length > received) {
        for (const r of poRows) {
          if (r.action === 'link+set' && matched.some((m) => m.id === r.unitId)) r.action = 'AMBIGUOUS'
        }
      }
    }
    for (const r of poRows) {
      if ((r.action === 'set' || r.action === 'link+set') && r.adj === r.current && r.linkedBefore) r.action = 'unchanged'
    }

    const applied = poRows.filter((r) => r.action === 'set' || r.action === 'link+set' || r.action === 'unchanged')
    const allocated = applied.reduce((s, r) => s + (r.adj ?? 0), 0)
    const receivedTracked = tracked.reduce((s, l) => s + (po.items.find((i) => i.id === l.id)!.receivedQuantity), 0)
    poSummary.push(
      `${po.poNumber}  net extras ${money(net)}  → ${applied.length}/${receivedTracked} received units, allocated ${money(allocated)}` +
      (applied.length === receivedTracked ? `  (drift ${money(allocated - net)})` : '  (not all units found)'),
    )
    rows.push(...poRows)
  }

  console.log(`\n${EXECUTE ? 'EXECUTE' : 'DRY RUN'} — PO landed cost back-apply\n`)
  console.log(['PO', 'Barcode', 'Status', 'Line price', 'Adj now', 'Adj new', 'New cost', 'Action', 'Asset'].join('\t'))
  for (const r of rows) {
    console.log([
      r.po, r.barcode, r.status, r.price == null ? '-' : money(r.price), money(r.current),
      r.adj == null ? '-' : money(r.adj), r.adj == null || r.price == null ? '-' : money(r.price + r.adj),
      r.action, r.asset.slice(0, 50),
    ].join('\t'))
  }
  console.log('\nPer PO:')
  for (const s of poSummary) console.log('  ' + s)

  const writes = rows.filter((r) => r.action === 'set' || r.action === 'link+set')
  const skipped = rows.filter((r) => r.action === 'HAND-PRICED' || r.action === 'AMBIGUOUS')
  console.log(`\n${writes.length} units to write (${writes.filter((r) => r.action === 'link+set').length} also linked to their PO), ${skipped.length} skipped for review.`)

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to write.')
    return
  }

  mkdirSync('backups', { recursive: true })
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const backupPath = `backups/po-landed-cost-before-${ts}.json`
  writeFileSync(backupPath, JSON.stringify(
    writes.map((r) => ({ id: r.unitId, barcode: r.barcode, purchaseOrderId: r.linkedBefore, landedCostAdjustment: r.current })),
    null, 2,
  ))
  console.log(`\nBackup: ${backupPath}`)

  await prisma.$transaction(
    writes.map((r) => prisma.assetUnit.update({
      where: { id: r.unitId },
      data: {
        landedCostAdjustment: r.adj!,
        ...(r.action === 'link+set' ? { purchaseOrderId: r.poId } : {}),
      },
    })),
  )
  console.log(`Wrote ${writes.length} units.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
