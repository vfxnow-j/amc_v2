/**
 * Fetch Current opportunity lines (with their item_assets) for a chosen set of orders, appended to
 * the latest finished pull_run as entity 'opportunity_items'. GET only, paced by the client.
 * Current returns lines only per opportunity, so this is one request per order — pick the set.
 *   npx tsx scripts/current-rms/pull-opportunity-items.ts --set sales
 *   npx tsx scripts/current-rms/pull-opportunity-items.ts --ids 1129,3775
 * Resumable: orders whose lines are already stored for the run are skipped.
 */
import { currentClient } from './lib/client'
import { stagingPool } from './lib/staging'

// Order-state, not cancelled, with a sale total or a sale-ish subject.
const SETS: Record<string, string> = {
  sales: `SELECT id FROM opp WHERE state = 'Order' AND status <> 'Cancelled'
            AND (sale_total > 0 OR subject ~* '(\\msale\\M|sold|buy ?out|purchase|\\msell)') ORDER BY id`,
  // Every order (rentals included), newest first — ~1 request each, so this is the long one.
  all: `SELECT id FROM opp WHERE state = 'Order' ORDER BY id DESC`,
  // Same client's rentals still open when a sale with an unassetted sale line started (buyout candidates).
  'buyout-rentals': `WITH unassetted AS (
              SELECT DISTINCT l.opp_id FROM opp_line l WHERE l.txn_type = 'Sale' AND l.line_type = 'Principal'
                AND NOT EXISTS (SELECT 1 FROM opp_asset a JOIN stock_item s ON s.id = a.stock_level_id WHERE a.line_id = l.id AND s.category = 'Serialised Stock')),
            s AS (SELECT o.* FROM opp o JOIN unassetted u ON u.opp_id = o.id WHERE o.status IN ('Completed', 'Active', 'Open', 'Postponed'))
            SELECT DISTINCT o.id FROM opp o JOIN s ON s.member_id = o.member_id
            WHERE o.state = 'Order' AND o.status <> 'Cancelled' AND o.id <> s.id AND o.rental_total > 0
              AND o.starts <= s.starts AND (o.ends IS NULL OR o.ends >= s.starts - interval '7 days') ORDER BY o.id`,
}

async function main() {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  const pool = stagingPool()
  const client = currentClient()
  const { rows: [{ run }] } = await pool.query('SELECT max(id) AS run FROM pull_run WHERE finished_at IS NOT NULL')
  const ids: number[] = arg('--ids')
    ? arg('--ids')!.split(',').map(Number)
    : (await pool.query(SETS[arg('--set') ?? ''] ?? (() => { throw new Error(`--set one of: ${Object.keys(SETS).join(', ')}`) })())).rows.map((r) => Number(r.id))
  const { rows: done } = await pool.query(
    `SELECT DISTINCT (data->>'opportunity_id')::bigint AS id FROM raw_record WHERE run_id = $1 AND entity = 'opportunity_items'`, [run])
  const have = new Set(done.map((r) => Number(r.id)))
  const todo = ids.filter((id) => !have.has(id))
  console.log(`run ${run}: ${ids.length} orders requested, ${todo.length} to fetch (~${Math.ceil(todo.length * 1.1 / 60)} min)`)

  let lines = 0
  for (const [n, id] of todo.entries()) {
    const items = await client.getAll(`opportunities/${id}/opportunity_items`, 'opportunity_items', '&include[]=item_assets')
    // A marker row keeps orders with zero lines from being re-fetched.
    const rows = items.length ? items : [{ id: -id, opportunity_id: id, marker: 'no lines' }]
    for (const r of rows) {
      await pool.query(
        `INSERT INTO raw_record (run_id, entity, current_id, data) VALUES ($1, 'opportunity_items', $2, $3)
         ON CONFLICT (run_id, entity, current_id) DO UPDATE SET data = EXCLUDED.data, pulled_at = now()`,
        [run, r.id, JSON.stringify({ ...r, opportunity_id: r.opportunity_id ?? id })])
    }
    lines += items.length
    if ((n + 1) % 50 === 0) console.log(`  ${n + 1}/${todo.length} orders, ${lines} lines`)
  }
  await pool.query(`UPDATE pull_run SET request_count = request_count + $2 WHERE id = $1`, [run, client.requests()])
  console.log(`done: ${todo.length} orders, ${lines} lines, ${client.requests()} Current API requests`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
