/**
 * Apply Current RMS's HIGH-confidence proposals (Match % >= 85, the workbook's 'high' band) to v2.
 *
 *   npx tsx scripts/current-rms/apply-high-confidence.ts                 # DRY RUN (default): plan + review list, writes nothing
 *   npx tsx scripts/current-rms/apply-high-confidence.ts --apply         # one transaction; every old value logged first
 *   npx tsx scripts/current-rms/apply-high-confidence.ts --undo <runId>  # restore the logged old values (one transaction)
 *   npx tsx scripts/current-rms/apply-high-confidence.ts --rehearse      # apply + undo inside one transaction that is ALWAYS rolled back
 *
 * Needs derive.ts + derive-sales.ts to have run against v2 (staging schema rms_v2). Proposals come from the same
 * lib/proposals.ts + lib/proposed.ts the workbook's Proposed sheet uses, filtered per field at >= 85 (the sheet's
 * own "apply >= N%" what-if rule).
 *
 * Writable columns (asset_units): purchaseDate, purchasePrice, and for RETIRED -> SOLD only: status, retirementReason,
 * soldAt, soldPrice, retiredTo (buyer), soldNotes. Total cost / book value / accumulated depreciation are not stored in v2
 * (computed on read from price + landedCostAdjustment + dates), and totalRevenue does not depend on any of these
 * columns, so there is nothing to recompute after a write; landedCostAdjustment is left alone.
 * Keep SYNC_PROTECTED_COLUMNS in sync with src/lib/v1-sync/engine.ts TABLE_RULES.asset_units.v2OwnedOnUpdate.
 *
 * Never applied (listed as the review list): units on a non-completed order or checked out; status changes of any
 * non-RETIRED unit; units whose RETIRED disposition is specific (Recycled/Lost/Damaged/Gifted/Released/Stolen);
 * units with a recorded sale already; units whose cost/date belong to a v2 purchase order; sales with no date.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { amcReadonlyPrisma } from './lib/amc-prisma'
import { amcReadonlyPool, amcWritePool, assertV2Schema, stagingPool } from './lib/staging'
import { buildFullInventoryRows } from './lib/full-inventory-rows'
import { proposeRow, type Proposed } from './lib/proposed'
import { proposalFor, saleFor } from './lib/proposals'

export const HIGH = 85
/** Columns this script can write; the v1 sync must treat them as v2-owned (engine.ts TABLE_RULES.asset_units). */
export const SYNC_PROTECTED_COLUMNS = ['purchaseDate', 'purchasePrice', 'status', 'retirementReason', 'soldAt', 'soldPrice', 'retiredTo', 'soldNotes', 'receivedDate', 'saleFees', 'retiredAt', 'purchaseOrderId', 'landedCostAdjustment'] as const
const CAST: Record<string, string> = {
  purchaseDate: 'timestamp(3)', purchasePrice: 'numeric(12,2)', status: '"AssetStatus"', retirementReason: '"RetirementReason"',
  soldAt: 'timestamp(3)', soldPrice: 'numeric(12,2)', retiredTo: 'text', soldNotes: 'text',
  receivedDate: 'timestamp(3)', saleFees: 'numeric(12,2)', retiredAt: 'timestamp(3)', purchaseOrderId: 'text', landedCostAdjustment: 'numeric(12,2)',
}
const OPEN_RES = ['COMPLETED', 'CANCELLED'] // reservations in any other status are "non-completed orders"
const noon = (ymd: string) => `${ymd}T12:00:00Z` // v2 convention for a calendar date (sellAssetUnit)
const money = (n: number | string | null | undefined) => (n == null || n === '' ? 'blank' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

type Write = { column: string; value: string | null }
type Plan = { barcode: string; unitId: string; asset: string; group: 'purchase' | 'sale'; pct: number | null; writes: Write[]; summary: string; reason: string
  costBefore: number; costAfter: number; bookBefore: number; bookAfter: number }
type Review = { barcode: string; asset: string; why: string; detail: string; pct: number | null }

async function plan() {
  const db = amcReadonlyPrisma()
  const staging = stagingPool()
  await assertV2Schema(staging)
  const ro = amcReadonlyPool()
  try {
    const { rows: [run] } = await staging.query('SELECT id FROM pull_run WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
    const inv = await buildFullInventoryRows(db)
    const { rows: um } = await staging.query('SELECT * FROM unit_match')
    const match = new Map(um.map((r) => [r.barcode as string, r]))
    const { rows: us } = await staging.query('SELECT * FROM unit_sale')
    const saleBy = new Map(us.map((r) => [r.barcode as string, r]))
    const { rows: state } = await ro.query(`
      SELECT u.id, u.barcode, u.status::text AS status, u."retirementReason"::text AS reason, u."soldAt", u."soldPrice", u."retiredTo", u."purchaseOrderId",
             to_char(u."receivedDate", 'YYYY-MM-DD') AS rd,
             (EXISTS (SELECT 1 FROM checkouts c WHERE c."assetUnitId" = u.id AND c.status::text NOT IN ('RETURNED', 'CANCELLED'))
              OR EXISTS (SELECT 1 FROM reservation_item_units riu JOIN reservation_items ri ON ri.id = riu."reservationItemId"
                         JOIN reservations r ON r.id = ri."reservationId"
                         WHERE riu."assetUnitId" = u.id AND r.status::text <> ALL ($1))
              OR u.status::text IN ('CHECKED_OUT', 'RESERVED')) AS busy
      FROM asset_units u`, [OPEN_RES])
    const st = new Map(state.map((r) => [r.barcode as string, r]))

    const plans: Plan[] = []
    const review: Review[] = []
    const lowOrMedium = { purchase: 0, sale: 0 }
    for (const row of inv) {
      const bc = String(row['Barcode'] ?? '')
      const s = bc ? st.get(bc) : undefined
      if (!s) continue
      const m = match.get(bc)
      const sale = saleBy.get(bc)
      const asset = String(row['Asset Name'])
      const received = s.rd as string | null
      const purchase: Proposed = proposeRow(row, proposalFor(m, 0), received)
      const purchaseHigh: Proposed = proposeRow(row, proposalFor(m, HIGH), received)
      const saleHigh: Proposed = proposeRow(row, undefined, received, saleFor(sale, m?.identity_pct ?? 100, HIGH))
      const saleAll: Proposed = proposeRow(row, undefined, received, saleFor(sale, m?.identity_pct ?? 100, 0))
      if (purchase.changes.length && !purchaseHigh.changes.length) lowOrMedium.purchase++
      if (saleAll.changes.length && !saleHigh.changes.length) lowOrMedium.sale++
      const block = (why: string, p: Proposed) => review.push({ barcode: bc, asset, why, detail: p.changes.join('; '), pct: p.pct })

      // --- purchase date / price
      if (purchaseHigh.changes.length) {
        if (s.busy) block('on a non-completed order or checked out', purchaseHigh)
        else if (s.purchaseOrderId) block('cost/date owned by a v2 purchase order', purchaseHigh)
        else {
          const writes: Write[] = []
          if (purchaseHigh.changed.includes('Purchase Date')) writes.push({ column: 'purchaseDate', value: noon(String(purchaseHigh.row['Purchase Date'])) })
          if (purchaseHigh.changed.includes('Purchase Price')) writes.push({ column: 'purchasePrice', value: String(purchaseHigh.row['Purchase Price']) })
          if (writes.length) plans.push({ barcode: bc, unitId: s.id, asset, group: 'purchase', pct: purchaseHigh.pct, writes, summary: purchaseHigh.changes.join('; '),
            reason: `Current RMS ${[m?.date_source, m?.supplier, m?.po_number].filter(Boolean).join(' · ')}`.trim(),
            costBefore: Number(row['Total Cost']) || 0, costAfter: Number(purchaseHigh.row['Total Cost']) || 0, bookBefore: Number(row['Current Book Value']) || 0, bookAfter: Number(purchaseHigh.row['Current Book Value']) || 0 })
        }
      }

      // --- sale evidence
      if (saleAll.changes.length || (sale && /^conflict|^possible missed/.test(String(sale.outcome)))) {
        const p = saleHigh.changes.length ? saleHigh : saleAll
        if (sale && /^conflict/.test(String(sale.outcome))) { block(`AMC records a specific disposition (${sale.amc_disposition}); Current shows a sale`, p); continue }
        if (!saleHigh.changes.length) continue // below 85: low/medium, not a review-list matter
        if (s.busy) { block('on a non-completed order or checked out', saleHigh); continue }
        if (s.status !== 'RETIRED') { block(`status change of a non-RETIRED unit (${s.status} -> SOLD)`, saleHigh); continue }
        if (s.soldAt || s.soldPrice != null) { block('unit already has a recorded sale', saleHigh); continue }
        if (s.reason && s.reason !== 'OTHER') { block(`AMC records a specific disposition (${s.reason})`, saleHigh); continue }
        if (!saleHigh.changed.includes('Status')) { block('sale fields without a status change (nothing to apply to a RETIRED unit)', saleHigh); continue }
        const day = saleHigh.changed.includes('Disposed On') ? String(saleHigh.row['Disposed On']) : null
        if (!day) { block('Current sale has no date', saleHigh); continue }
        const buyer = saleHigh.changed.includes('Disposed To') ? String(saleHigh.row['Disposed To']) : null
        const writes: Write[] = [{ column: 'status', value: 'SOLD' }, { column: 'retirementReason', value: 'SOLD' }, { column: 'soldAt', value: noon(day) }]
        if (saleHigh.changed.includes('Sale Price')) writes.push({ column: 'soldPrice', value: String(saleHigh.row['Sale Price']) })
        if (buyer) { writes.push({ column: 'retiredTo', value: buyer }, { column: 'soldNotes', value: `Sold to ${buyer}` }) }
        plans.push({ barcode: bc, unitId: s.id, asset, group: 'sale', pct: saleHigh.pct, writes, summary: saleHigh.changes.join('; '),
          reason: `Current RMS ${sale.kind}${sale.order_number ? ` ${sale.order_number}` : ''}`,
          costBefore: Number(row['Total Cost']) || 0, costAfter: Number(saleHigh.row['Total Cost']) || 0, bookBefore: Number(row['Current Book Value']) || 0, bookAfter: Number(saleHigh.row['Current Book Value']) || 0 })
      }
    }
    return { plans, review, lowOrMedium, pullRun: run.id as number }
  } finally {
    await db.$disconnect(); await staging.end(); await ro.end()
  }
}

async function applyOn(client: PoolClient, plans: Plan[], pullRun: number, runId: string) {
  let units = 0, cols = 0, skipped = 0
  for (const p of plans) {
    const { rows: [cur] } = await client.query(`SELECT * FROM asset_units WHERE id = $1 FOR UPDATE`, [p.unitId])
    // Re-check under lock: the plan was built from a read a moment ago.
    const sold = p.group === 'sale'
    if (!cur || (sold && (cur.status !== 'RETIRED' || cur.soldAt || cur.soldPrice != null)) || (!sold && cur.status === 'CHECKED_OUT')) { skipped++; continue }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const w of p.writes) {
      const { rows: [{ old }] } = await client.query(`SELECT "${w.column}"::text AS old FROM asset_units WHERE id = $1`, [p.unitId])
      vals.push(w.value); sets.push(`"${w.column}" = $${vals.length}::${CAST[w.column]}`)
      const { rows: [{ nv }] } = await client.query(`SELECT $1::${CAST[w.column]}::text AS nv`, [w.value])
      await client.query(
        `INSERT INTO current_rms_apply_log (id, "runId", "pullRunId", "unitId", barcode, "column", "oldValue", "newValue", "matchPct", reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [randomUUID(), runId, pullRun, p.unitId, p.barcode, w.column, old, nv, p.pct, p.reason])
      cols++
    }
    await client.query(`UPDATE asset_units SET ${sets.join(', ')}, "updatedAt" = now() WHERE id = $${vals.length + 1}`, [...vals, p.unitId])
    units++
  }
  return { units, cols, skipped }
}

async function undoOn(client: PoolClient, runId: string) {
  const { rows } = await client.query(`SELECT * FROM current_rms_apply_log WHERE "runId" = $1 AND "undoneAt" IS NULL ORDER BY "appliedAt", id`, [runId])
  if (!rows.length) throw new Error(`nothing to undo for ${runId}`)
  let restored = 0
  const drifted: string[] = []
  for (const r of rows) {
    if (!CAST[r.column]) throw new Error(`unexpected column ${r.column}`)
    const { rows: [cur] } = await client.query(`SELECT "${r.column}"::text AS v FROM asset_units WHERE id = $1 FOR UPDATE`, [r.unitId])
    if (!cur) { drifted.push(`${r.barcode}.${r.column} (unit gone)`); continue }
    if (cur.v !== r.newValue) { drifted.push(`${r.barcode}.${r.column} now ${cur.v}`); continue } // changed since the apply: leave it
    await client.query(`UPDATE asset_units SET "${r.column}" = $1::${CAST[r.column]}, "updatedAt" = now() WHERE id = $2`, [r.oldValue, r.unitId])
    await client.query(`UPDATE current_rms_apply_log SET "undoneAt" = now() WHERE id = $1`, [r.id])
    restored++
  }
  return { restored, total: rows.length, drifted }
}

const newRunId = () => `crms-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`

/** One transaction per run. */
async function apply(plans: Plan[], pullRun: number) {
  const pool: Pool = amcWritePool()
  const client = await pool.connect()
  const runId = newRunId()
  try {
    await client.query('BEGIN')
    const r = await applyOn(client, plans, pullRun, runId)
    await client.query('COMMIT')
    console.log(`APPLIED run ${runId}: ${r.units} units, ${r.cols} column changes logged, ${r.skipped} skipped on re-check. Undo: --undo ${runId}`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release(); await pool.end() }
}

async function undo(runId: string) {
  const pool: Pool = amcWritePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await undoOn(client, runId)
    await client.query('COMMIT')
    console.log(`UNDONE ${runId}: ${r.restored} of ${r.total} column changes restored${r.drifted.length ? `; ${r.drifted.length} left alone (changed since): ${r.drifted.slice(0, 20).join(' | ')}` : ''}`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release(); await pool.end() }
}

/** --rehearse: apply, then undo, inside ONE transaction that is always rolled back; proves every old value comes back. Writes nothing durable. */
async function rehearse(plans: Plan[], pullRun: number) {
  const pool: Pool = amcWritePool()
  const client = await pool.connect()
  const snap = async () => (await client.query(`SELECT id, to_jsonb(u) - 'updatedAt' AS j FROM asset_units u WHERE id = ANY($1) ORDER BY id`, [plans.map((p) => p.unitId)])).rows
  try {
    await client.query('BEGIN')
    const before = await snap()
    const runId = `rehearsal-${Date.now()}`
    const a = await applyOn(client, plans, pullRun, runId)
    const mid = await snap()
    const changedUnits = mid.filter((m, i) => JSON.stringify(m.j) !== JSON.stringify(before[i].j)).length
    const u = await undoOn(client, runId)
    const after = await snap()
    const bad = after.filter((m, i) => JSON.stringify(m.j) !== JSON.stringify(before[i].j))
    console.log(`REHEARSAL (rolled back): applied ${a.units} units / ${a.cols} columns (${changedUnits} rows differed after apply, ${a.skipped} skipped); undo restored ${u.restored}/${u.total}; rows not identical to the original after undo: ${bad.length}`)
    if (bad.length) console.log(bad.slice(0, 5).map((b) => b.id))
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end() }
}

async function main() {
  const ui = process.argv.indexOf('--undo')
  if (ui > 0) return undo(process.argv[ui + 1] ?? (() => { throw new Error('--undo needs a runId') })())
  const doApply = process.argv.includes('--apply')
  const doRehearse = process.argv.includes('--rehearse')
  const { plans, review, lowOrMedium, pullRun } = await plan()

  const byCol: Record<string, number> = {}
  for (const p of plans) for (const w of p.writes) byCol[w.column] = (byCol[w.column] ?? 0) + 1
  const sum = (k: 'costBefore' | 'costAfter' | 'bookBefore' | 'bookAfter') => plans.reduce((a, p) => a + p[k], 0)
  const why: Record<string, number> = {}
  for (const r of review) why[r.why.replace(/\(.*\)/, '').trim()] = (why[r.why.replace(/\(.*\)/, '').trim()] ?? 0) + 1
  console.log(`${doApply ? 'APPLY' : 'DRY RUN'} against pull run ${pullRun} (threshold ${HIGH}%)`)
  console.log(`units to change: ${new Set(plans.map((p) => p.barcode)).size} (purchase group ${plans.filter((p) => p.group === 'purchase').length}, sale group ${plans.filter((p) => p.group === 'sale').length})`)
  console.log('column changes:', byCol)
  console.log(`total cost  ${money(sum('costBefore'))} -> ${money(sum('costAfter'))}  (delta ${money(sum('costAfter') - sum('costBefore'))})`)
  console.log(`book value  ${money(sum('bookBefore'))} -> ${money(sum('bookAfter'))}  (delta ${money(sum('bookAfter') - sum('bookBefore'))})`)
  for (const g of ['purchase', 'sale'] as const) { const ps = plans.filter((p) => p.group === g); console.log(`  ${g}: cost ${money(ps.reduce((a, p) => a + p.costAfter - p.costBefore, 0))}, book ${money(ps.reduce((a, p) => a + p.bookAfter - p.bookBefore, 0))} (delta)`) }
  console.log(`below ${HIGH}% (not applied, not on the review list): purchase ${lowOrMedium.purchase} units, sale ${lowOrMedium.sale} units`)
  console.log(`review list (high-confidence but excluded): ${review.length}`, why)
  mkdirSync('reports/current-rms-v2', { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')
  const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const file = `reports/current-rms-v2/apply-review-${stamp}.csv`
  writeFileSync(file, ['barcode,asset,why,match_pct,detail', ...review.map((r) => [r.barcode, r.asset, r.why, r.pct, r.detail].map(csv).join(','))].join('\n'))
  const plansFile = `reports/current-rms-v2/apply-plan-${stamp}.csv`
  writeFileSync(plansFile, ['barcode,asset,group,match_pct,changes,cost_before,cost_after,book_before,book_after', ...plans.map((p) => [p.barcode, p.asset, p.group, p.pct, p.summary, p.costBefore, p.costAfter, p.bookBefore, p.bookAfter].map(csv).join(','))].join('\n'))
  console.log(`wrote ${file} and ${plansFile}`)
  if (doRehearse) return rehearse(plans, pullRun)
  if (!doApply) {
    console.log('sample before/after:')
    const step = Math.max(1, Math.floor(plans.length / 10))
    for (const p of plans.filter((_, i) => i % step === 0).slice(0, 10)) console.log(`  ${p.barcode} ${p.asset} [${p.group} ${p.pct}%] ${p.summary} | cost ${money(p.costBefore)} -> ${money(p.costAfter)} | book ${money(p.bookBefore)} -> ${money(p.bookAfter)}`)
    console.log('(dry run: nothing written; re-run with --apply)')
    return
  }
  await apply(plans, pullRun)
}

main().catch((e) => { console.error(e); process.exit(1) })
