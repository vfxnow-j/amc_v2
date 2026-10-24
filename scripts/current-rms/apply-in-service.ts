/**
 * Set each unit's in-service date (asset_units.receivedDate) to when the unit was ADDED TO INVENTORY as stock,
 * not when a PO was sent or the vendor was paid (owner, 2026-10-22). Depreciation starts here.
 *
 *   npx tsx scripts/current-rms/apply-in-service.ts                 # DRY RUN: plan + CSV, writes nothing
 *   npx tsx scripts/current-rms/apply-in-service.ts --apply         # one transaction; old values logged first
 *   npx tsx scripts/current-rms/apply-in-service.ts --undo <runId>  # put the old values back
 *
 * Source, in order, for a unit with no receivedDate of its own:
 *   1. Current RMS: the day its stock record was created there (stock_levels.created_at), when the unit matched
 *      Current by barcode. Serial and normalised-barcode matches are listed for review, never applied.
 *   2. This system: asset_units.createdAt, when it is a real day (not the 2026-02-07 / 02-20 import stamps) and not
 *      earlier than the purchase date.
 * Units tagged GPL / META are left alone: they leave VFXnow's books for their own entities.
 * A unit that already has a receivedDate (PO receipt) is never touched.
 *
 * receivedDate is protected from the v1 sync for the units changed here (engine.ts TABLE_RULES.asset_units),
 * through current_rms_apply_log, the same way apply-high-confidence.ts protects its columns.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { amcReadonlyPool, amcWritePool, stagingPool } from './lib/staging'

const IMPORT_STAMPS = new Set(['2026-02-07', '2026-02-20'])
const noon = (ymd: string) => `${ymd}T12:00:00Z`
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const TAGGED = /^(GPL|META)/i

type Row = { id: string; barcode: string; asset: string; date: string; source: string; purchase: string | null; cost: number; flag: string }

async function plan() {
  const staging = stagingPool()
  const ro = amcReadonlyPool()
  try {
    const { rows: [run] } = await staging.query('SELECT id FROM pull_run WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
    const { rows: cur } = await staging.query(`
      SELECT u.barcode, u.match_method, (s.data->>'created_at')::date AS created, u.date_source, u.candidate_date::date AS cand
      FROM unit_match u JOIN latest_raw s ON s.entity = 'stock_levels' AND s.current_id = u.current_stock_id`)
    const by = new Map(cur.map((r) => [r.barcode as string, r]))
    const { rows: units } = await ro.query(`
      SELECT u.id, u.barcode, a.name AS asset, u."purchaseDate", u."createdAt", u."receivedDate",
             coalesce(u."purchasePrice", 0) + coalesce(u."landedCostAdjustment", 0) AS cost
      FROM asset_units u JOIN assets a ON a.id = u."assetId"`)
    const plans: Row[] = [], review: (Row | { barcode: string; asset: string; why: string })[] = []
    const skipped = { tagged: 0, hasReceived: 0, noSource: 0 }
    for (const u of units) {
      if (TAGGED.test(u.barcode)) { skipped.tagged++; continue }
      if (u.receivedDate) { skipped.hasReceived++; continue }
      const pd = ymd(u.purchaseDate), base = { id: u.id, barcode: u.barcode, asset: u.asset, purchase: pd, cost: Number(u.cost) }
      const c = by.get(u.barcode)
      if (c) {
        const day = ymd(c.created)!
        if (c.match_method !== 'barcode') { review.push({ barcode: u.barcode, asset: u.asset, why: `Current matched by ${c.match_method}, not barcode (stock created ${day})` }); continue }
        plans.push({ ...base, date: day, source: 'Current RMS stock record created', flag: '' })
        continue
      }
      const ca = ymd(u.createdAt)!
      if (!IMPORT_STAMPS.has(ca) && (!pd || ca >= pd)) { plans.push({ ...base, date: ca, source: 'Added to AMC', flag: '' }); continue }
      skipped.noSource++
    }
    return { plans, review, skipped, pullRun: run.id as number }
  } finally { await staging.end(); await ro.end() }
}

const monthsTo = (from: string, to: string) => (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7))
const AS_OF = '2026-10-01'
const nbv = (cost: number, start: string | null) => (start ? cost * (1 - Math.min(60, Math.max(0, monthsTo(start, AS_OF))) / 60) : cost)

async function apply(plans: Row[], pullRun: number) {
  const pool: Pool = amcWritePool()
  const client = await pool.connect()
  const runId = `inservice-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  try {
    await client.query('BEGIN')
    let n = 0, skipped = 0
    for (const p of plans) {
      const { rows: [cur] } = await client.query(`SELECT "receivedDate"::text AS rd FROM asset_units WHERE id = $1 FOR UPDATE`, [p.id])
      if (!cur || cur.rd) { skipped++; continue } // got a receipt since the plan was read: leave it
      await client.query(`UPDATE asset_units SET "receivedDate" = $1::timestamp(3), "updatedAt" = now() WHERE id = $2`, [noon(p.date), p.id])
      const { rows: [{ nv }] } = await client.query(`SELECT $1::timestamp(3)::text AS nv`, [noon(p.date)])
      await client.query(
        `INSERT INTO current_rms_apply_log (id, "runId", "pullRunId", "unitId", barcode, "column", "oldValue", "newValue", "matchPct", reason) VALUES ($1,$2,$3,$4,$5,'receivedDate',NULL,$6,NULL,$7)`,
        [randomUUID(), runId, pullRun, p.id, p.barcode, nv, `In service: ${p.source}`])
      n++
    }
    await client.query('COMMIT')
    console.log(`APPLIED run ${runId}: ${n} units, ${skipped} skipped on re-check. Undo: --undo ${runId}`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release(); await pool.end() }
}

async function undo(runId: string) {
  const pool: Pool = amcWritePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM current_rms_apply_log WHERE "runId" = $1 AND "undoneAt" IS NULL AND "column" = 'receivedDate'`, [runId])
    if (!rows.length) throw new Error(`nothing to undo for ${runId}`)
    let restored = 0
    const drifted: string[] = []
    for (const r of rows) {
      const { rows: [cur] } = await client.query(`SELECT "receivedDate"::text AS v FROM asset_units WHERE id = $1 FOR UPDATE`, [r.unitId])
      if (!cur || cur.v !== r.newValue) { drifted.push(r.barcode); continue }
      await client.query(`UPDATE asset_units SET "receivedDate" = $1::timestamp(3), "updatedAt" = now() WHERE id = $2`, [r.oldValue, r.unitId])
      await client.query(`UPDATE current_rms_apply_log SET "undoneAt" = now() WHERE id = $1`, [r.id])
      restored++
    }
    await client.query('COMMIT')
    console.log(`UNDONE ${runId}: ${restored} of ${rows.length} restored${drifted.length ? `; ${drifted.length} changed since, left alone: ${drifted.slice(0, 20).join(' ')}` : ''}`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release(); await pool.end() }
}

async function main() {
  const ui = process.argv.indexOf('--undo')
  if (ui > 0) return undo(process.argv[ui + 1] ?? (() => { throw new Error('--undo needs a runId') })())
  const { plans, review, skipped, pullRun } = await plan()
  const bySource: Record<string, number> = {}
  for (const p of plans) bySource[p.source] = (bySource[p.source] ?? 0) + 1
  const shift = { same: 0, later: 0, earlier: 0, unknownBefore: 0 }
  let before = 0, after = 0
  for (const p of plans) {
    const was = p.purchase && !IMPORT_STAMPS.has(p.purchase) ? p.purchase : null
    if (!was) shift.unknownBefore++
    else { const k = monthsTo(was, p.date); if (k === 0) shift.same++; else if (k > 0) shift.later++; else shift.earlier++ }
    before += nbv(p.cost, was); after += nbv(p.cost, p.date)
  }
  console.log(`${process.argv.includes('--apply') ? 'APPLY' : 'DRY RUN'} against pull run ${pullRun}`)
  console.log(`units to set: ${plans.length}`, bySource, 'skipped:', skipped, `review: ${review.length}`)
  console.log('start month vs the old (purchase-date) start, same month / later / earlier / was-unknown:', shift)
  console.log(`book value on ${AS_OF}, straight line 60mo: $${Math.round(before).toLocaleString()} -> $${Math.round(after).toLocaleString()} (all listed units, incl. disposed)`)
  mkdirSync('reports/in-service', { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')
  const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  writeFileSync(`reports/in-service/in-service-plan-${stamp}.csv`, ['barcode,asset,in_service,source,purchase_date,cost', ...plans.map((p) => [p.barcode, p.asset, p.date, p.source, p.purchase, p.cost].map(csv).join(','))].join('\n'))
  writeFileSync(`reports/in-service/in-service-review-${stamp}.csv`, ['barcode,asset,why', ...review.map((r) => [r.barcode, r.asset, 'why' in r ? r.why : ''].map(csv).join(','))].join('\n'))
  console.log(`wrote reports/in-service/in-service-{plan,review}-${stamp}.csv`)
  if (!process.argv.includes('--apply')) return console.log('(dry run: nothing written; re-run with --apply)')
  await apply(plans, pullRun)
}

main().catch((e) => { console.error(e); process.exit(1) })
