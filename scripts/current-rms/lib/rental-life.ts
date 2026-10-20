/**
 * A unit's rental life in Current RMS: every rental booking its asset number
 * was allocated to, valued three ways so package pricing can be judged.
 *
 * Current often prices a package (Group) on one line — e.g. a workstation line
 * carries $9,237 while the 4 GPUs inside it show $0. So a GPU's rent sits in
 * its workstation's price. Only such packages count as a bundle: a priced
 * group with at least one $0 asset line. Groups whose assets are all priced
 * are just headings ("Dell Workstations") and stay as recorded.
 * Valuations per booking:
 *   asRecorded  — the booking line's own charge ÷ its quantity (Current as-is).
 *                 Fleet totals are right; per-unit, package parts read $0.
 *   evenSplit   — package charge ÷ assets allocated in the package.
 *   rateSplit   — package charge shared by each asset's standalone rate: what
 *                 that item fetched when rented on its own, top-level, in
 *                 Current (median). Null when any asset in the package has no
 *                 standalone history.
 * Bookings outside a priced package get the same value in all three.
 */
import type { Pool } from 'pg'

export type BookingBasis =
  | 'own line'          // priced on its own line
  | 'bundle price'      // carries the price of a bundle with $0 parts
  | 'bundle part'       // $0 part inside a priced bundle
  | 'rode with order'   // $0 line; the order's other lines carry the rent (e.g. GPU inside a workstation price)
  | 'no charge'         // the whole order has no rental charge

export const BASIS_LABEL: Record<BookingBasis, string> = {
  'own line': 'Priced on its own line',
  'bundle price': 'Carries a bundle price',
  'bundle part': '$0 part of a priced bundle',
  'rode with order': '$0 — value in other lines on the order (e.g. GPU priced into a workstation)',
  'no charge': '$0 order',
}

export type Booking = {
  basis: BookingBasis
  barcode: string
  oppId: number
  orderNumber: string
  client: string | null
  starts: string | null
  ends: string | null
  lineName: string
  inPackage: boolean
  packageName: string | null
  packageCharge: number | null
  assetsInPackage: number | null
  standaloneRate: number | null
  asRecorded: number
  evenSplit: number
  rateSplit: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function loadRentalLife(staging: Pool, barcodes: string[]): Promise<Booking[]> {
  const c = await staging.connect()
  try {
    await c.query('BEGIN')
    await c.query(`CREATE TEMP TABLE bc ON COMMIT DROP AS SELECT DISTINCT ltrim(b, '0') AS k, b FROM unnest($1::text[]) b`, [barcodes])
    // Every Current line, with its package path. Materialised once — the views are slow to re-scan.
    await c.query(`CREATE TEMP TABLE ln ON COMMIT DROP AS
      SELECT current_id AS id, (data->>'opportunity_id')::bigint AS opp_id, data->>'path' AS path,
             data->>'opportunity_item_type_name' AS line_type, data->>'transaction_type_name' AS txn,
             (data->>'item_id')::bigint AS item_id, data->>'name' AS name,
             NULLIF(data->>'quantity','')::numeric AS qty, NULLIF(data->>'price','')::numeric AS price,
             NULLIF(data->>'charge_total','')::numeric AS charge, data->'item_assets' AS assets
        FROM latest_raw WHERE entity = 'opportunity_items' AND current_id > 0`)
    await c.query(`CREATE TEMP TABLE la ON COMMIT DROP AS
      SELECT ln.id AS line_id, ln.opp_id, ln.path, ln.item_id, a.value->>'stock_level_asset_number' AS asset_number,
             a.value->>'status_name' AS status
        FROM ln, LATERAL jsonb_array_elements(COALESCE(ln.assets, '[]'::jsonb)) a(value)
       WHERE ln.txn = 'Rental'`)
    // Standalone monthly rate per product: top-level priced rental lines only.
    await c.query(`CREATE TEMP TABLE rate ON COMMIT DROP AS
      SELECT item_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS rate
        FROM ln WHERE txn = 'Rental' AND line_type = 'Principal' AND position('-' in path) = 0 AND price > 0
       GROUP BY item_id`)
    const { rows } = await c.query(`
      WITH mine AS (
        SELECT bc.b AS barcode, la.*, split_part(la.path, '-', 1) AS pkg_path, position('-' in la.path) > 0 AS nested
          FROM bc JOIN la ON ltrim(la.asset_number, '0') = bc.k
         WHERE la.status IS DISTINCT FROM 'Cancelled'
      ), pkg AS (
        SELECT DISTINCT m.opp_id, m.pkg_path FROM mine m WHERE m.nested
      ), pkg_info AS (
        SELECT p.opp_id, p.pkg_path, g.name AS pkg_name, g.charge AS pkg_charge,
               (SELECT count(*) FROM la x WHERE x.opp_id = p.opp_id AND x.path LIKE p.pkg_path || '-%' AND x.status IS DISTINCT FROM 'Cancelled') AS n_assets,
               (SELECT count(*) FROM la x JOIN ln y ON y.id = x.line_id
                 WHERE x.opp_id = p.opp_id AND x.path LIKE p.pkg_path || '-%' AND x.status IS DISTINCT FROM 'Cancelled'
                   AND COALESCE(y.charge, 0) = 0) AS n_zero,
               (SELECT sum(r.rate) FROM la x LEFT JOIN rate r ON r.item_id = x.item_id
                 WHERE x.opp_id = p.opp_id AND x.path LIKE p.pkg_path || '-%' AND x.status IS DISTINCT FROM 'Cancelled') AS rate_sum,
               (SELECT bool_and(r.rate IS NOT NULL) FROM la x LEFT JOIN rate r ON r.item_id = x.item_id
                 WHERE x.opp_id = p.opp_id AND x.path LIKE p.pkg_path || '-%' AND x.status IS DISTINCT FROM 'Cancelled') AS all_rated
          FROM pkg p JOIN ln g ON g.opp_id = p.opp_id AND g.path = p.pkg_path AND g.line_type = 'Group'
      )
      SELECT m.barcode, m.opp_id, o.data->>'number' AS order_number, o.data->>'status_name' AS opp_status,
             mem.data->>'name' AS client, o.data->>'starts_at' AS starts, o.data->>'ends_at' AS ends,
             l.name AS line_name, NULLIF(o.data->>'rental_charge_total','')::numeric AS order_rental, l.qty, l.charge, r.rate AS standalone_rate,
             pi.pkg_name, pi.pkg_charge, pi.n_assets, pi.n_zero, pi.rate_sum, pi.all_rated
        FROM mine m
        JOIN ln l ON l.id = m.line_id
        JOIN latest_raw o ON o.entity = 'opportunities' AND o.current_id = m.opp_id
        LEFT JOIN latest_raw mem ON mem.entity = 'members' AND mem.current_id = (o.data->>'member_id')::bigint
        LEFT JOIN rate r ON r.item_id = m.item_id
        LEFT JOIN pkg_info pi ON m.nested AND pi.opp_id = m.opp_id AND pi.pkg_path = m.pkg_path
       WHERE o.data->>'status_name' IS DISTINCT FROM 'Cancelled'
       ORDER BY m.barcode, starts`)
    await c.query('COMMIT')
    return rows.map((x) => {
      const own = Number(x.charge) > 0 && Number(x.qty) > 0 ? Number(x.charge) / Number(x.qty) : 0
      const pkgCharge = x.pkg_charge != null ? Number(x.pkg_charge) : null
      const inPackage = pkgCharge != null && pkgCharge > 0 && Number(x.n_zero) > 0
      const n = Number(x.n_assets) || 0
      const rate = x.standalone_rate != null ? Number(x.standalone_rate) : null
      const basis: BookingBasis = inPackage ? (own > 0 ? 'bundle price' : 'bundle part')
        : own > 0 ? 'own line' : Number(x.order_rental) > 0 ? 'rode with order' : 'no charge'
      return {
        basis,
        barcode: x.barcode,
        oppId: Number(x.opp_id),
        orderNumber: x.order_number,
        client: x.client,
        starts: x.starts ? String(x.starts).slice(0, 10) : null,
        ends: x.ends ? String(x.ends).slice(0, 10) : null,
        lineName: x.line_name,
        inPackage,
        packageName: inPackage ? x.pkg_name : null,
        packageCharge: inPackage ? pkgCharge : null,
        assetsInPackage: inPackage ? n : null,
        standaloneRate: rate,
        asRecorded: r2(own),
        evenSplit: r2(inPackage && n ? pkgCharge! / n : own),
        rateSplit: !inPackage ? r2(own)
          : x.all_rated && rate != null && Number(x.rate_sum) > 0 ? r2(pkgCharge! * rate / Number(x.rate_sum)) : null,
      }
    })
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}
