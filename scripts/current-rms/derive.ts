/**
 * Rebuild unit_match / po_line_link / current_only (staging schema rms_v2) from the latest pull and live v2 (read-only).
 *   npx tsx scripts/current-rms/derive.ts [--window-days 60]
 */
import { amcReadonlyPool, assertV2Schema, stagingPool } from './lib/staging'
import { linkPos, matchIdentity, type AmcUnit, type PoLine, type StockItem } from './lib/link'
import { BULK_DAY_MIN, IMPORT_STAMPS, gradeCost, gradeDate, gradeStatus, worst, type CurrentState, type Grade } from './lib/grade'
import { combined, costScore, dateScore, identityScore, linkScore } from './lib/confidence'

type J = Record<string, any> // raw Current JSON
async function main() {
  const wi = process.argv.indexOf('--window-days')
  const windowDays = wi > 0 ? Number(process.argv[wi + 1]) : 60
  const EXCLUDED = /^(GPL|META)/i

  const staging = stagingPool()
  const amcPool = amcReadonlyPool()
  await assertV2Schema(staging)
  const { rows: [{ run }] } = await staging.query('SELECT max(id) AS run FROM pull_run WHERE finished_at IS NOT NULL')
  if (!run) throw new Error('no finished pull_run; run pull.ts first')
  const { rows: raw } = await staging.query('SELECT entity, data FROM raw_record WHERE run_id = $1', [run])
  const of = (e: string) => raw.filter((r) => r.entity === e).map((r) => r.data as J)

  // --- Current side
  const products = new Map(of('products').map((p) => [p.id as number, p]))
  const suppliers = new Map(of('members').map((m) => [m.id as number, m.name as string]))
  const txByStock = new Map<number, J[]>()
  for (const t of of('stock_transactions')) txByStock.set(t.stock_level_id, [...(txByStock.get(t.stock_level_id) ?? []), t])
  const OPENING = ['Opening Balance', 'Buy', 'Make']
  const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null)

  const stock: StockItem[] = of('stock_levels').filter((s) => s.stock_category_name === 'Serialised Stock').map((s) => {
    const tx = (txByStock.get(s.id) ?? []).sort((a, b) => String(a.transaction_at).localeCompare(String(b.transaction_at)))
    const opening = tx.find((t) => OPENING.includes(t.transaction_type_name))
    const firstMove = tx.find((t) => !OPENING.includes(t.transaction_type_name))
    const types = new Set(tx.map((t) => t.transaction_type_name))
    const state: CurrentState = types.has('Sell') ? 'sold' : types.has('Write Off') ? 'written_off' : Number(s.quantity_held) > 0 ? 'held' : 'not_held'
    return {
      id: s.id, itemId: s.item_id, itemName: s.item_name, assetNumber: String(s.asset_number ?? ''), serial: String(s.serial_number ?? ''),
      store: s.store_name, openingDate: day(opening?.transaction_at), firstMoveDate: day(firstMove?.transaction_at),
      poNumberRaw: String(s.custom_fields?.po_number ?? ''), state,
    }
  })
  const perDay = new Map<string, number>()
  for (const s of stock) if (s.openingDate) perDay.set(s.openingDate, (perDay.get(s.openingDate) ?? 0) + 1)
  const bulkDays = new Set([...perDay].filter(([, n]) => n >= BULK_DAY_MIN).map(([d]) => d))

  const pos = of('purchase_orders')
  const poNumber = (p: J) => (/\d/.test(String(p.number ?? '')) ? `PO-${String(parseInt(String(p.number).replace(/\D/g, ''), 10)).padStart(6, '0')}` : `(no number) #${p.id}`)
  const lines: PoLine[] = pos.flatMap((p) => (p.purchase_order_items ?? []).map((i: J) => ({
    id: i.id, poId: p.id, poNumber: poNumber(p), orderedAt: day(p.ordered_at) ?? day(p.created_at)!, supplier: suppliers.get(p.member_id) ?? null,
    subject: p.subject ?? '', name: String(i.name ?? '').replace(/\s+/g, ' ').trim(), qty: Number(i.quantity) || 0, price: Number(i.price) || 0,
    total: Number(i.charge_total) || 0, itemId: i.item_id, serialisedProduct: products.get(i.item_id)?.stock_method_name === 'Serialised',
  })))

  // --- AMC side (read-only role)
  const { rows: amcRows } = await amcPool.query(`
    SELECT u.barcode, u."serialNumber" AS serial, a.name AS asset_name, u.status::text AS status,
           to_char(u."purchaseDate", 'YYYY-MM-DD') AS purchase_date, u."purchasePrice"::float8 AS purchase_price,
           (coalesce(u.notes, '') ~* 'estimated (from|by)') AS estimated
    FROM asset_units u JOIN assets a ON a.id = u."assetId"`)
  const amc: AmcUnit[] = amcRows.filter((r) => !EXCLUDED.test(r.barcode)).map((r) => ({
    barcode: r.barcode, serial: r.serial, assetName: r.asset_name, status: r.status, purchaseDate: r.purchase_date,
    purchasePrice: r.purchase_price, estimated: r.estimated,
  }))

  // --- Match + link
  const { pairs, currentOnly } = matchIdentity(stock, amc)
  const link = linkPos(lines, pairs, windowDays)

  await staging.query('BEGIN')
  await staging.query('TRUNCATE unit_match, po_line_link, current_only')
  const counts: Record<Grade, number> = { none: 0, green: 0, yellow: 0, orange: 0 }
  for (const [bc, p] of pairs) {
    const l = link.units.get(bc)
    const identity: Grade = p.method === 'serial' && p.stock.assetNumber.trim() ? 'orange' : 'none'
    const d = gradeDate({ amc: p.unit.purchaseDate, poDate: l?.orderedAt ?? null, openingDate: p.stock.openingDate, openingIsBulkDay: !!p.stock.openingDate && bulkDays.has(p.stock.openingDate) })
    const c = gradeCost({ amc: p.unit.purchasePrice, current: l?.cost ?? null, estimated: p.unit.estimated })
    const st = gradeStatus({ amcStatus: p.unit.status, state: p.stock.state })
    const linkGrade: Grade = l?.grade ?? 'none'
    const grade = worst(identity, d.grade, c.grade, linkGrade, st.grade)
    counts[grade]++
    // Match % per proposed field (null = nothing proposed). See lib/confidence.ts.
    const idPct = identityScore(p.method, identity === 'orange')
    const lk = l ? linkScore(l.kind, l.flags) : null
    const near = (x: string | null, y: string | null) => !!x && !!y && Math.abs(Date.parse(x) - Date.parse(y)) <= 3 * 864e5
    const datePct = d.candidate && d.source ? combined(idPct, dateScore({
      agrees: d.grade === 'green', source: d.source, link: lk, bulkDay: !!p.stock.openingDate && bulkDays.has(p.stock.openingDate),
      amcIsStamp: IMPORT_STAMPS.includes(p.unit.purchaseDate ?? ''), amcIsInStockDate: near(p.unit.purchaseDate, p.stock.openingDate),
    })) : null
    const costPct = l?.cost != null && lk != null ? combined(idPct, costScore({ agrees: c.grade === 'green', amcBlank: !p.unit.purchasePrice, link: lk, amcIsEstimate: p.unit.estimated })) : null
    const reasons = [identity === 'orange' ? `serial match; Current barcode ${p.stock.assetNumber}` : null, d.reason, c.reason, l?.reason, st.reason, ...(link.notes.get(bc) ?? [])].filter(Boolean).join('; ')
    await staging.query(
      `INSERT INTO unit_match (barcode, match_method, current_stock_id, current_asset_number, current_serial, candidate_date, date_source,
         current_cost, cost_basis, po_number, supplier, current_status, identity_grade, date_grade, cost_grade, link_grade, status_grade, grade, reasons,
         link_kind, identity_pct, date_pct, cost_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [bc, p.method, p.stock.id, p.stock.assetNumber, p.stock.serial, d.candidate, d.source === 'po' ? l!.poNumber : d.source === 'opening' ? 'Opening Balance' : null,
       l?.cost ?? null, l?.basis ?? null, l?.poNumber ?? null, l?.supplier ?? null, p.stock.state.replace('_', ' '),
       identity, d.grade, c.grade, linkGrade, st.grade, grade, reasons, l?.kind ?? null, idPct, datePct, costPct])
  }
  const lineById = new Map(lines.map((l) => [l.id, l]))
  for (const [id, ll] of link.lines) {
    const l = lineById.get(id)!
    await staging.query(
      `INSERT INTO po_line_link (row_key, po_id, po_number, ordered_at, supplier, subject, line_name, quantity, unit_price, line_total, line_group, core_kind, build_key, linked_barcodes, grade, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [`L${id}`, l.poId, l.poNumber, l.orderedAt, l.supplier, l.subject, l.name, l.qty, l.price, l.total, ll.group, ll.kind, ll.buildKey, ll.barcodes.join(', '), ll.grade, ll.reason])
  }
  for (const p of pos.filter((p) => !(p.purchase_order_items ?? []).length)) {
    await staging.query(
      `INSERT INTO po_line_link (row_key, po_id, po_number, ordered_at, supplier, subject, line_total, grade, reasons) VALUES ($1,$2,$3,$4,$5,$6,$7,'none','PO has no lines in Current')`,
      [`P${p.id}`, p.id, poNumber(p), day(p.ordered_at), suppliers.get(p.member_id) ?? null, p.subject, Number(p.charge_total) || 0])
  }
  for (const { stock: s, note } of currentOnly) {
    await staging.query(
      `INSERT INTO current_only (stock_id, asset_number, serial_number, product, store, opening_date, current_status, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.id, s.assetNumber, s.serial, s.itemName, s.store, s.openingDate, s.state.replace('_', ' '), note])
  }
  await staging.query('COMMIT')

  console.log(`run ${run}, window ${windowDays}d, bulk days: ${[...bulkDays].sort().join(', ')}`)
  console.log(`AMC units considered ${amc.length} (excluded GPL/META ${amcRows.length - amc.length}); matched ${pairs.size}; Current-only ${currentOnly.length}`)
  console.log(`unit grades`, counts, `| linked to a PO: ${link.units.size}, with a cost: ${[...link.units.values()].filter((u) => u.cost != null).length}`)
  console.log(`PO lines ${lines.length} → rows ${link.lines.size}; POs without lines ${pos.filter((p) => !(p.purchase_order_items ?? []).length).length}`)
  await staging.end(); await amcPool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
