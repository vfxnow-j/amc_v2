/**
 * Link received units to the purchase order that brought them in, and give them their share of its landed cost.
 *
 *   npx tsx scripts/link-po-units.ts                 # DRY RUN: plan + CSV, writes nothing
 *   npx tsx scripts/link-po-units.ts --apply         # one transaction; old values logged first
 *   npx tsx scripts/link-po-units.ts --undo <runId>  # put the old values back
 *
 * A PO line is linked only when it is provable: the line is inventoried with a model, and the unlinked units of that
 * model bought at exactly the line's price inside the PO window (order date - 3d .. received date + 3d) number exactly the
 * line's quantity, and no other line wants any of them. Anything else is listed in the review CSV and left alone.
 *
 * Writes purchaseOrderId and landedCostAdjustment (the unit's share of the PO's freight + fees + tax - discount,
 * the same allocateLandedCost() the app uses at receiving). Both are logged to current_rms_apply_log and so
 * protected from the v1 sync while the log row stands (engine.ts TABLE_RULES.asset_units).
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { allocateLandedCost, landedAdjustmentForUnit, toLandedCostPO } from '../src/lib/pricing/landed-cost'
import { prisma } from '../src/lib/prisma'

const APPLY = process.argv.includes('--apply')
const DAY = 86400000
const TAGGED = /^(GPL|META)/i

type Plan = { poId: string; po: string; barcode: string; unitId: string; asset: string; price: number; adj: number; oldAdj: number }

async function undo(runId: string) {
  const rows = await prisma.$queryRaw<{ id: string; unitId: string; column: string; oldValue: string | null; newValue: string | null }[]>`
    SELECT id, "unitId", "column", "oldValue", "newValue" FROM current_rms_apply_log WHERE "runId" = ${runId} AND "undoneAt" IS NULL`
  if (!rows.length) throw new Error(`nothing to undo for ${runId}`)
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      if (r.column === 'purchaseOrderId') await tx.$executeRaw`UPDATE asset_units SET "purchaseOrderId" = ${r.oldValue}, "updatedAt" = now() WHERE id = ${r.unitId}`
      else await tx.$executeRaw`UPDATE asset_units SET "landedCostAdjustment" = ${r.oldValue ?? '0'}::numeric, "updatedAt" = now() WHERE id = ${r.unitId}`
      await tx.$executeRaw`UPDATE current_rms_apply_log SET "undoneAt" = now() WHERE id = ${r.id}`
    }
  })
  console.log(`UNDONE ${runId}: ${rows.length} log rows restored`)
}

async function main() {
  const ui = process.argv.indexOf('--undo')
  if (ui > 0) return undo(process.argv[ui + 1])

  const pos = await prisma.purchaseOrder.findMany({ where: { status: { in: ['RECEIVED', 'PARTIAL'] } }, include: { items: true }, orderBy: { poNumber: 'asc' } })
  const claimed = new Map<string, string>() // unitId -> line id
  const contested = new Set<string>()
  const plans: Plan[] = []
  const review: string[] = []
  const candByLine = new Map<string, { po: (typeof pos)[number]; line: (typeof pos)[number]['items'][number]; units: Awaited<ReturnType<typeof prisma.assetUnit.findMany>> }>()

  for (const po of pos) {
    const from = new Date(po.orderDate.getTime() - 3 * DAY), to = new Date((po.receivedDate ?? po.orderDate).getTime() + 3 * DAY)
    for (const line of po.items) {
      if (!line.isInventoried || !line.assetId) continue
      const linked = await prisma.assetUnit.count({ where: { purchaseOrderId: po.id, assetId: line.assetId } })
      const need = line.receivedQuantity - linked
      if (need <= 0) continue
      const units = (await prisma.assetUnit.findMany({
        where: { assetId: line.assetId, purchaseOrderId: null, purchasePrice: line.unitPrice, purchaseDate: { gte: from, lte: to } },
        orderBy: { barcode: 'asc' },
      })).filter((u) => !TAGGED.test(u.barcode))
      if (units.length !== need) { review.push(`${po.poNumber},"${line.description.slice(0, 60)}",${need},${units.length},count differs`); continue }
      candByLine.set(line.id, { po, line, units })
      for (const u of units) { if (claimed.has(u.id)) contested.add(u.id); claimed.set(u.id, line.id) }
    }
  }
  for (const [lineId, c] of candByLine) {
    if (c.units.some((u) => contested.has(u.id))) { review.push(`${c.po.poNumber},"${c.line.description.slice(0, 60)}",${c.units.length},${c.units.length},units wanted by two lines`); continue }
    const input = toLandedCostPO(c.po)
    const alloc = allocateLandedCost(input)
    for (const u of c.units) {
      const price = Number(u.purchasePrice)
      const adj = landedAdjustmentForUnit(input, alloc, { assetId: u.assetId, purchasePrice: price }) ?? 0
      plans.push({ poId: c.po.id, po: c.po.poNumber, barcode: u.barcode, unitId: u.id, asset: c.line.description, price, adj, oldAdj: Number(u.landedCostAdjustment) })
    }
    void lineId
  }

  const byPo = new Map<string, { n: number; cost: number; adj: number }>()
  for (const p of plans) { const b = byPo.get(p.po) ?? { n: 0, cost: 0, adj: 0 }; b.n++; b.cost += p.price; b.adj += p.adj; byPo.set(p.po, b) }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${plans.length} units on ${byPo.size} POs; ${review.length} lines left for review`)
  for (const [po, b] of byPo) console.log(`  ${po}  ${b.n} units  cost $${b.cost.toFixed(2)}  landed adj ${b.adj >= 0 ? '+' : '-'}$${Math.abs(b.adj).toFixed(2)}`)
  for (const r of review) console.log('  REVIEW', r)
  mkdirSync('reports/po-links', { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')
  const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  writeFileSync(`reports/po-links/po-links-${stamp}.csv`, ['po,barcode,line,price,landed_adj', ...plans.map((p) => [p.po, p.barcode, p.asset, p.price, p.adj].map(csv).join(','))].join('\n'))
  writeFileSync(`reports/po-links/po-links-review-${stamp}.csv`, ['po,line,needed,found,why', ...review].join('\n'))
  if (!APPLY) return console.log('(dry run: nothing written; re-run with --apply)')

  const runId = `polink-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  const pullRun = (await prisma.$queryRaw<{ n: number }[]>`SELECT coalesce(max("pullRunId"), 0)::int AS n FROM current_rms_apply_log`)[0].n
  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      const cur = await tx.$queryRaw<{ po: string | null }[]>`SELECT "purchaseOrderId" AS po FROM asset_units WHERE id = ${p.unitId} FOR UPDATE`
      if (!cur[0] || cur[0].po) continue
      await tx.$executeRaw`UPDATE asset_units SET "purchaseOrderId" = ${p.poId}, "landedCostAdjustment" = ${p.adj}::numeric, "updatedAt" = now() WHERE id = ${p.unitId}`
      await tx.$executeRaw`INSERT INTO current_rms_apply_log (id, "runId", "pullRunId", "unitId", barcode, "column", "oldValue", "newValue", "matchPct", reason) VALUES (${randomUUID()}, ${runId}, ${pullRun}, ${p.unitId}, ${p.barcode}, 'purchaseOrderId', NULL, ${p.poId}, NULL, ${'Linked to ' + p.po})`
      await tx.$executeRaw`INSERT INTO current_rms_apply_log (id, "runId", "pullRunId", "unitId", barcode, "column", "oldValue", "newValue", "matchPct", reason) VALUES (${randomUUID()}, ${runId}, ${pullRun}, ${p.unitId}, ${p.barcode}, 'landedCostAdjustment', ${String(p.oldAdj)}, ${String(p.adj)}, NULL, ${'Landed cost from ' + p.po})`
    }
  }, { timeout: 120000 })
  console.log(`APPLIED run ${runId}. Undo: npx tsx scripts/link-po-units.ts --undo ${runId}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
