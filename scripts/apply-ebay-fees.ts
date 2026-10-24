/**
 * Apply eBay price, fees and sale date from an eBay Transaction report to v2's eBay-channel units
 * (v1's scripts/apply-ebay-transactions.ts, pointed at v2, with old values logged and undoable).
 *
 *   npx tsx scripts/apply-ebay-fees.ts [--file <csv>]                 # DRY RUN
 *   npx tsx scripts/apply-ebay-fees.ts [--file <csv>] --apply
 *   npx tsx scripts/apply-ebay-fees.ts --undo <runId>
 *
 * Only exact links: a unit counts when its own text names the eBay order number (lib/ebay-transactions.ts).
 * saleFees = eBay fees on the order + shipping labels bought for it, so soldPrice - saleFees is what we received.
 * Writes soldPrice, saleFees, soldAt, retiredAt; every old value goes to current_rms_apply_log, which also keeps
 * the v1 sync from putting v1's empty values back (engine.ts TABLE_RULES.asset_units).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { assertV2Database } from '../src/lib/db-guard'
import { loadTransactions, planEbayApply } from './lib/ebay-transactions'

const DEFAULT = '/home/docker/projects/vfxnow-amc/import_tmp/Transaction_report_20240101_20261015.csv'
const COLS = ['soldPrice', 'saleFees', 'soldAt', 'retiredAt'] as const
const CAST: Record<string, string> = { soldPrice: 'numeric(12,2)', saleFees: 'numeric(12,2)', soldAt: 'timestamp(3)', retiredAt: 'timestamp(3)' }
const r2 = (n: number) => Math.round(n * 100) / 100
const noon = (d: Date) => `${d.toISOString().slice(0, 10)}T12:00:00Z`

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  assertV2Database(url)
  const pool = new Pool({ connectionString: url.replace(/\?schema=public$/, '') })
  try {
    const ui = process.argv.indexOf('--undo')
    if (ui > 0) return await undo(pool, process.argv[ui + 1])
    const fi = process.argv.indexOf('--file')
    const file = fi > 0 ? process.argv[fi + 1] : DEFAULT
    const orders = loadTransactions(file)
    const { rows } = await pool.query(`SELECT id, barcode, "soldAt", "soldPrice", "saleFees", notes, "soldNotes", "retiredTo" FROM asset_units WHERE "saleChannel" = 'EBAY' ORDER BY barcode`)
    const units = rows.map((r) => ({ ...r, soldPrice: r.soldPrice == null ? null : Object.assign(Number(r.soldPrice), { toString: () => r.soldPrice }) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { updates, held } = planEbayApply(units as any, orders as any)
    for (const x of updates) console.log([x.u.barcode, x.orderNo, x.date.toISOString().slice(0, 10), `$${x.price}`, `fees $${x.fees}`, `net $${x.net}`].join(' | '))
    console.log(`\n${updates.length} units on ${new Set(updates.map((x) => x.orderNo)).size} orders · price $${r2(updates.reduce((s, x) => s + x.price, 0))} · fees $${r2(updates.reduce((s, x) => s + x.fees, 0))}`)
    console.log(`Held (not applied):\n  ${held.join('\n  ') || 'none'}`)
    if (!process.argv.includes('--apply')) return console.log('\nDry run, nothing written; pass --apply.')

    const runId = `ebay-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const x of updates) {
        const next: Record<string, string> = { soldPrice: String(x.price), saleFees: String(x.fees), soldAt: noon(x.date), retiredAt: noon(x.date) }
        const { rows: [cur] } = await client.query(`SELECT "soldPrice"::text a, "saleFees"::text b, "soldAt"::text c, "retiredAt"::text d FROM asset_units WHERE id = $1 FOR UPDATE`, [x.u.id])
        const old: Record<string, string | null> = { soldPrice: cur.a, saleFees: cur.b, soldAt: cur.c, retiredAt: cur.d }
        for (const c of COLS) {
          const { rows: [{ nv }] } = await client.query(`SELECT $1::${CAST[c]}::text AS nv`, [next[c]])
          if (nv === old[c]) continue
          await client.query(`UPDATE asset_units SET "${c}" = $1::${CAST[c]}, "updatedAt" = now() WHERE id = $2`, [next[c], x.u.id])
          await client.query(`INSERT INTO current_rms_apply_log (id, "runId", "unitId", barcode, "column", "oldValue", "newValue", reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [randomUUID(), runId, x.u.id, x.u.barcode, c, old[c], nv, `eBay transaction report, order ${x.orderNo}`])
        }
      }
      await client.query('COMMIT')
      console.log(`\nAPPLIED run ${runId}. Undo: --undo ${runId}`)
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  } finally { await pool.end() }
}

async function undo(pool: Pool, runId: string) {
  if (!runId) throw new Error('--undo needs a runId')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM current_rms_apply_log WHERE "runId" = $1 AND "undoneAt" IS NULL ORDER BY "appliedAt"`, [runId])
    if (!rows.length) throw new Error(`nothing to undo for ${runId}`)
    let restored = 0
    for (const r of rows) {
      const { rows: [cur] } = await client.query(`SELECT "${r.column}"::text v FROM asset_units WHERE id = $1 FOR UPDATE`, [r.unitId])
      if (!cur || cur.v !== r.newValue) continue
      await client.query(`UPDATE asset_units SET "${r.column}" = $1::${CAST[r.column]}, "updatedAt" = now() WHERE id = $2`, [r.oldValue, r.unitId])
      await client.query(`UPDATE current_rms_apply_log SET "undoneAt" = now() WHERE id = $1`, [r.id])
      restored++
    }
    await client.query('COMMIT')
    console.log(`UNDONE ${runId}: ${restored} of ${rows.length}`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

main().catch((e) => { console.error(e); process.exit(1) })
