/**
 * Incremental order-line fetch (v2-side replacement for v1's pull-opportunity-items.ts --set all, ~100 min).
 *
 *   npx tsx scripts/current-rms/pull-opportunity-items-incremental.ts [--plan] [--run N] [--prev N] [--limit N]
 *
 * 1. Copies the previous run's 'opportunity_items' raw_records into the new run (once).
 * 2. Re-fetches (GET only, via lib/client.ts, paced >= 1.1 s, honours 429) only Orders that are
 *      - new (no lines stored for them in the previous run), or
 *      - whose header changed between the two runs' 'opportunities' records (any field), or
 *      - still live: status not Completed/Cancelled, or a Completed order that ended (or has no end)
 *        within the last 45 days, or one updated in Current within the last 60 days. (Current's
 *        open_ended_rental flag is true on 5,496 of 5,521 completed orders, so it cannot mark "recurring".)
 * 3. Resumable: finished orders are recorded in rms_v2.incremental_done; re-running continues.
 * --plan prints the counts per reason and fetches nothing. Writes only to the staging db.
 */
import { currentClient } from './lib/client'
import { assertV2Schema, stagingPool } from './lib/staging'

async function main() {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  const planOnly = process.argv.includes('--plan')
  const pool = stagingPool()
  await pool.query(`CREATE TABLE IF NOT EXISTS rms_v2.incremental_done (run_id int NOT NULL, opp_id bigint NOT NULL, lines int NOT NULL DEFAULT 0, done_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (run_id, opp_id))`)
  await assertV2Schema(pool)
  const { rows: [{ latest }] } = await pool.query('SELECT max(id) AS latest FROM pull_run WHERE finished_at IS NOT NULL')
  const run = Number(arg('--run') ?? latest)
  const { rows: [pr] } = await pool.query(
    `SELECT max(run_id) AS prev FROM raw_record WHERE entity = 'opportunity_items' AND run_id < $1`, [run])
  const prev = Number(arg('--prev') ?? pr.prev)
  if (!run || !prev) throw new Error('need a finished run and an earlier run with opportunity_items')
  console.log(`run ${run}, copying lines from run ${prev}${planOnly ? ' (PLAN ONLY)' : ''}`)

  // Targets: Orders only (v1's 'all' set was state = 'Order').
  const targets = `
    WITH n AS (SELECT current_id AS id, data FROM raw_record WHERE run_id = $1 AND entity = 'opportunities' AND data->>'state_name' = 'Order'),
         p AS (SELECT current_id AS id, data FROM raw_record WHERE run_id = $2 AND entity = 'opportunities'),
         had AS (SELECT DISTINCT (data->>'opportunity_id')::bigint AS id FROM raw_record WHERE run_id = $2 AND entity = 'opportunity_items')
    SELECT n.id,
      CASE WHEN p.id IS NULL THEN 'new order'
           WHEN had.id IS NULL THEN 'no stored lines'
           WHEN p.data IS DISTINCT FROM n.data THEN 'header changed'
           WHEN n.data->>'status_name' NOT IN ('Completed','Cancelled') THEN 'live status'
           WHEN coalesce((n.data->>'ends_at')::timestamptz, now()) >= now() - interval '45 days' THEN 'ended/ends within 45d or open'
           WHEN (n.data->>'updated_at')::timestamptz >= now() - interval '60 days' THEN 'updated within 60d'
      END AS reason
    FROM n LEFT JOIN p ON p.id = n.id LEFT JOIN had ON had.id = n.id
    ORDER BY n.id DESC`
  const { rows: t } = await pool.query(targets, [run, prev])
  const want = t.filter((r) => r.reason)
  const why: Record<string, number> = {}
  for (const r of want) why[r.reason] = (why[r.reason] ?? 0) + 1
  console.log(`orders in run: ${t.length}; to fetch: ${want.length}`, why, `(~${Math.ceil(want.length * 1.2 / 60)} min at 1 request/order, more for multi-page orders)`)
  if (planOnly) { await pool.end(); return }

  const { rowCount: copied } = await pool.query(`SELECT 1 FROM rms_v2.incremental_done WHERE run_id = $1 AND opp_id = 0`, [run])
  if (!copied) {
    await pool.query('BEGIN')
    const r = await pool.query(
      `INSERT INTO raw_record (run_id, entity, current_id, data, pulled_at)
       SELECT $1, entity, current_id, data, pulled_at FROM raw_record WHERE run_id = $2 AND entity = 'opportunity_items'
       ON CONFLICT (run_id, entity, current_id) DO NOTHING`, [run, prev])
    await pool.query(`INSERT INTO rms_v2.incremental_done (run_id, opp_id) VALUES ($1, 0)`, [run])
    await pool.query('COMMIT')
    console.log(`copied ${r.rowCount} line rows from run ${prev}`)
  }
  const { rows: done } = await pool.query(`SELECT opp_id FROM rms_v2.incremental_done WHERE run_id = $1`, [run])
  const have = new Set(done.map((r) => Number(r.opp_id)))
  const limit = Number(arg('--limit') ?? Infinity)
  const todo = want.filter((r) => !have.has(Number(r.id))).slice(0, limit)
  console.log(`${todo.length} left after resume`)

  const client = currentClient()
  let lines = 0
  for (const [n, { id }] of todo.entries()) {
    const items = await client.getAll(`opportunities/${id}/opportunity_items`, 'opportunity_items', '&include[]=item_assets')
    const rows = items.length ? items : [{ id: -id, opportunity_id: id, marker: 'no lines' }] // marker: zero-line orders
    await pool.query('BEGIN')
    // Replace this order's lines wholesale, so lines removed in Current disappear.
    await pool.query(`DELETE FROM raw_record WHERE run_id = $1 AND entity = 'opportunity_items' AND (data->>'opportunity_id')::bigint = $2`, [run, id])
    for (const r of rows) {
      await pool.query(
        `INSERT INTO raw_record (run_id, entity, current_id, data) VALUES ($1, 'opportunity_items', $2, $3)
         ON CONFLICT (run_id, entity, current_id) DO UPDATE SET data = EXCLUDED.data, pulled_at = now()`,
        [run, r.id, JSON.stringify({ ...r, opportunity_id: r.opportunity_id ?? id })])
    }
    await pool.query(`INSERT INTO rms_v2.incremental_done (run_id, opp_id, lines) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [run, id, items.length])
    await pool.query('COMMIT')
    lines += items.length
    if ((n + 1) % 25 === 0) console.log(`  ${new Date().toISOString()} ${n + 1}/${todo.length} orders, ${lines} lines, ${client.requests()} requests`)
  }
  await pool.query(`UPDATE pull_run SET request_count = request_count + $2 WHERE id = $1`, [run, client.requests()])
  console.log(`done: ${todo.length} orders, ${lines} lines, ${client.requests()} Current API requests`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
