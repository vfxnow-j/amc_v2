/**
 * Sales pass: Current sale evidence per AMC unit (unit_sale) and sale lines nothing explains
 * (sale_hole). Reads staging + AMC through the read-only role. Report only.
 *   npx tsx scripts/current-rms/derive-sales.ts [--window-days 45]
 * Run after derive.ts (uses unit_match for the Current ↔ AMC pairing).
 */
import { amcReadonlyPool, assertV2Schema, stagingPool } from './lib/staging'
import { findSales, type Opp, type OppLine, type SellTxn, type StockUnit, type AmcRef, type SaleEvidence } from './lib/sales'
import { unitDisposal, dispositionLabels } from '../../src/lib/utils/disposal'
import type { Grade } from './lib/grade'
import { lastSeen } from './lib/lastseen'

type J = Record<string, any>
const ACTIVE = ['AVAILABLE', 'CHECKED_OUT', 'MAINTENANCE', 'RESERVED']
const LOOSE = ['UNSPECIFIED', 'OTHER'] // retirement that says nothing about where it went
const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null)
const KIND_LABEL: Record<SaleEvidence['kind'], string> = { sale_line_asset: 'on a Current sale line', sell_txn: 'Current Sell movement', buyout: 'buyout of a rental', text_mention: 'barcode in sale order text' }

async function main() {
  const wi = process.argv.indexOf('--window-days')
  const windowDays = wi > 0 ? Number(process.argv[wi + 1]) : 45
  const st = stagingPool()
  const amcPool = amcReadonlyPool()
  await assertV2Schema(st)
  const { rows: [{ run }] } = await st.query('SELECT max(id) AS run FROM pull_run WHERE finished_at IS NOT NULL')
  const { rows: raw } = await st.query(`SELECT entity, current_id, data FROM raw_record WHERE run_id = $1 AND entity IN ('stock_transactions','stock_levels','opportunities','opportunity_items','members')`, [run])
  const of = (e: string) => raw.filter((r) => r.entity === e && Number(r.current_id) > 0).map((r) => r.data as J)
  const members = new Map(of('members').map((m) => [Number(m.id), String(m.name)]))
  const stockItem = new Map(of('stock_levels').map((s) => [Number(s.id), s]))

  const sells: SellTxn[] = of('stock_transactions').filter((t) => t.transaction_type_name === 'Sell' && stockItem.get(Number(t.stock_level_id))?.stock_category_name === 'Serialised Stock')
    .map((t) => ({ stockId: Number(t.stock_level_id), date: day(t.transaction_at)!, sourceType: String(t.source_type), sourceId: Number(t.source_id),
      by: t.source_type === 'Member' ? members.get(Number(t.source_id)) ?? null : null }))
  const opps: Opp[] = of('opportunities').map((o) => ({
    id: Number(o.id), number: String(o.number), subject: String(o.subject ?? ''), memberId: o.member_id != null ? Number(o.member_id) : null,
    starts: day(o.starts_at), ends: day(o.ends_at), state: String(o.state_name), status: String(o.status_name),
    text: [o.subject, o.description, o.external_description, o.reference].filter(Boolean).join(' '), saleTotal: Number(o.sale_charge_total) || 0,
  }))
  const lines: OppLine[] = of('opportunity_items').map((l) => ({
    id: Number(l.id), oppId: Number(l.opportunity_id), name: String(l.name ?? ''), description: String(l.description ?? ''),
    txnType: String(l.transaction_type_name ?? ''), lineType: String(l.opportunity_item_type_name ?? ''), qty: Number(l.quantity) || 0, price: Number(l.price) || 0,
    assets: (l.item_assets ?? []).map((a: J) => ({ stockId: Number(a.stock_level_id), status: String(a.status_name), qtySold: Number(a.quantity_sold) || 0, qtyReturned: Number(a.quantity_returned) || 0 })),
  }))

  const { rows: amcRows } = await amcPool.query(`
    SELECT u.barcode, a.name AS asset_name, u.status::text AS status, u."retirementReason"::text AS "retirementReason", u."soldAt", u."retiredAt",
           u."soldPrice", u."retiredTo", u."soldNotes", u.notes
    FROM asset_units u JOIN assets a ON a.id = u."assetId"`)
  const amcInfo = new Map(amcRows.map((r) => [r.barcode as string, { ...r, disp: unitDisposal(r) }]))
  const bucket = (r: J) => (ACTIVE.includes(r.status) ? `ACTIVE ${r.status}` : r.status === 'SOLD' || r.disp.disposition === 'SOLD' ? 'SOLD' : `RETIRED ${/not in warehouse/i.test(r.retiredTo ?? '') ? 'Not in warehouse' : dispositionLabels[r.disp.disposition as keyof typeof dispositionLabels] ?? r.disp.disposition}`)
  const amc: AmcRef[] = amcRows.map((r) => ({ barcode: r.barcode, assetName: r.asset_name, bucket: bucket(amcInfo.get(r.barcode)!) }))
  const { rows: um } = await st.query('SELECT barcode, current_stock_id FROM unit_match')
  const stockUnits: StockUnit[] = um.map((m) => ({ stockId: Number(m.current_stock_id), barcode: m.barcode, assetName: amcInfo.get(m.barcode)?.asset_name ?? '', itemName: String(stockItem.get(Number(m.current_stock_id))?.item_name ?? '') }))

  const { evidence, holes } = findSales({ sells, opps, lines, stockUnits, amc, windowDays })
  const oppById = new Map(opps.map((o) => [o.id, o]))
  const lineById = new Map(lines.map((l) => [l.id, l]))

  await st.query('BEGIN')
  await st.query('TRUNCATE unit_sale, sale_hole, unit_last_seen')
  const seen = lastSeen(lines, opps, stockUnits)
  for (const v of seen.values()) {
    await st.query(`INSERT INTO unit_last_seen (barcode, order_number, client, starts, ends, order_status, asset_status, returned, orders) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [v.barcode, v.number, v.memberId != null ? members.get(v.memberId) ?? null : null, v.starts, v.ends, v.orderStatus, v.assetStatus, v.returned, v.orders])
  }
  const tally: Record<string, number> = {}
  for (const e of evidence.values()) {
    const a = amcInfo.get(e.barcode)
    if (!a) continue
    const d = a.disp
    const buyer = e.buyerId != null ? members.get(e.buyerId) ?? `member #${e.buyerId}` : null
    const reasons = [...e.reasons]
    if (e.date && e.date >= '2026-02-01') reasons.push('Current is the billing mirror since AMC go-live — the AMC sale order should match')
    let outcome: string, grade: Grade, markSold = false, setDate = false, setBuyer = false, setPrice = false
    if (ACTIVE.includes(a.status)) {
      outcome = 'possible missed sale'; grade = 'orange'; markSold = setDate = setBuyer = true; setPrice = e.price != null
    } else if (a.status === 'RETIRED' && d.disposition !== 'SOLD' && (LOOSE.includes(d.disposition) || /not in warehouse/i.test(a.retiredTo ?? ''))) {
      outcome = `Current shows sold (AMC retired: ${/not in warehouse/i.test(a.retiredTo ?? '') ? 'Not in warehouse' : dispositionLabels[d.disposition as keyof typeof dispositionLabels]})`
      grade = 'yellow'; markSold = setDate = setBuyer = true; setPrice = e.price != null
    } else if (a.status === 'RETIRED' && d.disposition !== 'SOLD') {
      outcome = `conflict: AMC says ${dispositionLabels[d.disposition as keyof typeof dispositionLabels]}`; grade = 'orange'
      reasons.push('not applied — AMC records a specific disposition')
    } else {
      // AMC already SOLD: only fill blanks; never overwrite a recorded sale.
      setPrice = d.salePrice == null && e.price != null
      setDate = !d.disposedAt && !!e.date
      setBuyer = !d.recipient && !!buyer
      const priceClash = d.salePrice != null && e.price != null && Math.abs(d.salePrice - e.price) > 1
      if (priceClash) reasons.push(`AMC price $${d.salePrice} kept; Current $${e.price}`)
      if (d.disposedAt && e.date && Math.abs(Date.parse(day(d.disposedAt)!) - Date.parse(e.date)) > 7 * 864e5) reasons.push(`AMC sale date ${day(d.disposedAt)} kept; Current ${e.date}`)
      outcome = setPrice || setDate || setBuyer ? `fills AMC sale ${[setPrice && 'price', setDate && 'date', setBuyer && 'buyer'].filter(Boolean).join(' + ')}` : priceClash ? 'sale price differs' : 'agrees with AMC sale'
      grade = priceClash ? 'orange' : setPrice || setDate || setBuyer ? 'yellow' : 'green'
    }
    tally[outcome.replace(/\(.*\)/, '').trim()] = (tally[outcome.replace(/\(.*\)/, '').trim()] ?? 0) + 1
    const o = e.oppId != null ? oppById.get(e.oppId) : undefined
    await st.query(
      `INSERT INTO unit_sale (barcode, asset_name, kind, sale_date, buyer, order_number, order_subject, line_name, price, sale_pct, price_pct,
         amc_status, amc_disposition, amc_disposed_on, amc_disposed_to, amc_sale_price, outcome, apply_mark_sold, apply_date, apply_buyer, apply_price, grade, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [e.barcode, a.asset_name, KIND_LABEL[e.kind], e.date, buyer, o?.number ?? null, o?.subject ?? null, e.lineId != null ? lineById.get(e.lineId)?.name ?? null : null,
       e.price, e.salePct, e.pricePct, a.status, d.disposition ? dispositionLabels[d.disposition as keyof typeof dispositionLabels] : null, day(d.disposedAt), d.recipient,
       d.salePrice, outcome, markSold, setDate, setBuyer, setPrice, grade, reasons.join('; ')])
  }
  for (const h of holes) {
    const note = h.opp.starts && h.opp.starts >= '2026-02-01' ? 'after AMC go-live: check the AMC sale order (Current is the billing mirror)' : ''
    await st.query(
      `INSERT INTO sale_hole (row_key, order_number, order_date, order_status, client, subject, line_name, quantity, unexplained, unit_price, candidates, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [`S${h.line.id}`, h.opp.number, h.opp.starts, h.opp.status, h.opp.memberId != null ? members.get(h.opp.memberId) ?? null : null, h.opp.subject, h.line.name,
       h.line.qty, h.unexplained, h.line.price, h.candidates.join(', '), note])
  }
  await st.query('COMMIT')
  const byKind = [...evidence.values()].reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {})
  console.log(`run ${run}: sells ${sells.length}, orders with a sale total ${opps.filter((o) => o.state === 'Order' && o.saleTotal > 0).length}, lines ${lines.length}`)
  console.log('evidence by kind', byKind)
  console.log('outcomes', tally)
  console.log(`last seen: ${seen.size} units on a rental, ${[...seen.values()].filter((v) => !v.returned).length} never returned per Current`)
  console.log(`holes: ${holes.length} sale lines, ${holes.reduce((a, h) => a + h.unexplained, 0)} units unexplained, $${Math.round(holes.reduce((a, h) => a + h.unexplained * h.line.price, 0)).toLocaleString('en-US')}`)
  await st.end(); await amcPool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
